// A Removal told through a notice on the removed member's session (ADR 0023): `getViewer` stores
// the Firm it moves the session off, and the notice lasts until it's no longer needed.
import { deactivateOrganization } from "@repo/db/cli/organizations";
import { member, session } from "@repo/db/schema";
import { eq } from "drizzle-orm";
import {
  acceptInvitation,
  dismissRemovalNotice,
  getViewer,
  inviteMember,
  removeMember,
  switchOrganization,
  updateProfileName,
} from "./tenant";
import { authTest, internalIdKeys, type TestAuth } from "./testing";

/**
 * Olga owns Acme, Globex and Initech. Mo is a member of all three and joined Acme last, then
 * Globex, then Initech, so his session starts in Acme and falls back to Globex, then Initech. Cy
 * is a member of Acme only. Everyone is signed in.
 */
async function seedWorld(t: TestAuth) {
  const olga = await t.seedUser({ email: "olga@example.com", name: "Olga" });
  const mo = await t.seedUser({ email: "mo@example.com", name: "Mo" });
  const cy = await t.seedUser({ email: "cy@example.com", name: "Cy" });
  const owner = { userId: olga.id, role: "owner" } as const;
  const initech = await t.seedOrganization({
    name: "Initech",
    slug: "initech",
    members: [owner, { userId: mo.id, role: "member", createdAt: new Date("2026-01-01") }],
  });
  const globex = await t.seedOrganization({
    name: "Globex",
    slug: "globex",
    members: [owner, { userId: mo.id, role: "member", createdAt: new Date("2026-02-01") }],
  });
  const acme = await t.seedOrganization({
    name: "Acme",
    slug: "acme",
    members: [
      owner,
      { userId: mo.id, role: "member", createdAt: new Date("2026-03-01") },
      { userId: cy.id, role: "member" },
    ],
  });
  return {
    acme,
    globex,
    initech,
    users: { olga, mo, cy },
    as: {
      olga: await t.signInAs("olga@example.com"),
      mo: await t.signInAs("mo@example.com"),
      cy: await t.signInAs("cy@example.com"),
    },
  };
}

type World = Awaited<ReturnType<typeof seedWorld>>;

const test = authTest.extend("world", ({ t }) => seedWorld(t));

/** Olga switches to `org`, so the tenant API acts on it there. */
async function asOlgaIn(t: TestAuth, { world, org }: { world: World; org: { publicId: string } }) {
  const switched = await switchOrganization(t.auth, {
    headers: world.as.olga,
    organizationPublicId: org.publicId,
  });
  if (!switched.ok) throw new Error(switched.error);
  return world.as.olga;
}

/** Olga removes `who` from `firm`, as the app does: in that workspace. */
type RemoveArgs = { world: World; who: "mo" | "cy"; firm: "acme" | "globex" };

async function remove(t: TestAuth, { world, who, firm: slug }: RemoveArgs) {
  const org = world[slug];
  const row = org.members.find((m) => m.userId === world.users[who].id)!;
  const removed = await removeMember(t.auth, {
    headers: await asOlgaIn(t, { world, org }),
    organizationPublicId: org.publicId,
    memberPublicId: row.publicId,
  });
  expect(removed).toEqual({ ok: true, data: null });
}

/** What the session rows of `userId` hold, read from Postgres. */
async function storedNotices(t: TestAuth, userId: number) {
  const rows = await t.auth.$deps.db
    .select({ removedFrom: session.removedFromOrganizationId })
    .from(session)
    .where(eq(session.userId, userId));
  return rows.map((row) => row.removedFrom);
}

const firm = (org: { publicId: string; name: string }) => ({
  publicId: org.publicId,
  name: org.name,
});

describe("getViewer after a Removal", () => {
  test("moves a two-Firm member to their other Firm and reports the one they left", async ({
    t,
    world,
  }) => {
    await remove(t, { world, who: "mo", firm: "acme" });

    for (const _ of [1, 2]) {
      // oxlint-disable-next-line no-await-in-loop -- the moving request, then a later one
      const viewer = await getViewer(t.auth, world.as.mo);
      expect(viewer?.tenant?.organization.publicId).toBe(world.globex.publicId);
      expect(viewer?.removedFrom).toEqual(firm(world.acme));
      const { internal: _internal, ...visible } = viewer!;
      expect(internalIdKeys(visible)).toEqual([]);
    }
    expect(await storedNotices(t, world.users.mo.id)).toEqual([String(world.acme.id)]);
  });

  test("reports it from the cached session and, without one, from Postgres", async ({
    t,
    world,
  }) => {
    await remove(t, { world, who: "mo", firm: "acme" });
    await getViewer(t.auth, world.as.mo);

    // Postgres no longer has it, so only the cache can say it.
    await t.auth.$deps.db.update(session).set({ removedFromOrganizationId: null });
    expect((await getViewer(t.auth, world.as.mo))?.removedFrom).toEqual(firm(world.acme));

    // And the other way round: the cache lost the session, so Better Auth reads the row.
    await t.auth.$deps.db.update(session).set({ removedFromOrganizationId: String(world.acme.id) });
    for (const key of t.storage.keys().filter((k) => !k.startsWith("active-sessions-"))) {
      // oxlint-disable-next-line no-await-in-loop
      await t.storage.delete(key);
    }
    expect((await getViewer(t.auth, world.as.mo))?.removedFrom).toEqual(firm(world.acme));
  });

  test("leaves a single-Firm member with no tenant and the notice", async ({ t, world }) => {
    await remove(t, { world, who: "cy", firm: "acme" });

    for (const _ of [1, 2]) {
      // oxlint-disable-next-line no-await-in-loop -- the moving request, then a later one
      const viewer = await getViewer(t.auth, world.as.cy);
      expect(viewer?.tenant).toBeNull();
      expect(viewer?.removedFrom).toEqual(firm(world.acme));
    }
  });

  test("stores nothing for a session's first pick of a Firm", async ({ t, world }) => {
    await t.seedUser({ email: "dee@example.com", name: "Dee" });
    const dee = await t.signInAs("dee@example.com");
    const deeId = (await getViewer(t.auth, dee))!.internal.userId;
    await t.auth.$deps.db
      .insert(member)
      .values({ organizationId: world.globex.id, userId: deeId, role: "member" });

    const viewer = await getViewer(t.auth, dee);
    expect(viewer?.tenant?.organization.publicId).toBe(world.globex.publicId);
    expect(viewer?.removedFrom).toBeNull();
    expect(await storedNotices(t, deeId)).toEqual([null]);
  });

  test("replaces the notice when a second move follows the first", async ({ t, world }) => {
    await remove(t, { world, who: "mo", firm: "acme" });
    await getViewer(t.auth, world.as.mo);
    await remove(t, { world, who: "mo", firm: "globex" });

    const viewer = await getViewer(t.auth, world.as.mo);
    expect(viewer?.tenant?.organization.publicId).toBe(world.initech.publicId);
    expect(viewer?.removedFrom).toEqual(firm(world.globex));
  });

  test("reports a Removal from a Firm that was then deactivated", async ({ t, world }) => {
    await remove(t, { world, who: "mo", firm: "acme" });
    await deactivateOrganization(t.auth.$deps.db, { slug: "acme", reason: "Left" });

    const viewer = await getViewer(t.auth, world.as.mo);
    expect(viewer?.removedFrom).toEqual(firm(world.acme));
    expect(viewer?.deactivatedFirms).toEqual([]);
  });

  test("stores nothing for a move off a Deactivated Firm the member is still in", async ({
    t,
    world,
  }) => {
    await deactivateOrganization(t.auth.$deps.db, { slug: "acme", reason: "Left" });

    const viewer = await getViewer(t.auth, world.as.mo);
    expect(viewer?.tenant?.organization.publicId).toBe(world.globex.publicId);
    expect(viewer?.removedFrom).toBeNull();
  });

  test("reports a move made by a Server Action on the next page", async ({ t, world }) => {
    await remove(t, { world, who: "mo", firm: "acme" });
    // The first request after the Removal is an action, which renders no page.
    expect(await updateProfileName(t.auth, { headers: world.as.mo, name: "Mo B" })).toMatchObject({
      ok: true,
    });

    expect((await getViewer(t.auth, world.as.mo))?.removedFrom).toEqual(firm(world.acme));
  });
});

describe("clearing the notice", () => {
  test("dismissing clears it from the session", async ({ t, world }) => {
    await remove(t, { world, who: "mo", firm: "acme" });
    await getViewer(t.auth, world.as.mo);

    expect(await dismissRemovalNotice(t.auth, world.as.mo)).toEqual({ ok: true, data: null });

    expect((await getViewer(t.auth, world.as.mo))?.removedFrom).toBeNull();
    expect(await storedNotices(t, world.users.mo.id)).toEqual([null]);
  });

  test("switching workspace clears it", async ({ t, world }) => {
    await remove(t, { world, who: "mo", firm: "acme" });
    await getViewer(t.auth, world.as.mo);

    const switched = await switchOrganization(t.auth, {
      headers: world.as.mo,
      organizationPublicId: world.initech.publicId,
    });
    expect(switched.ok).toBe(true);

    const viewer = await getViewer(t.auth, world.as.mo);
    expect(viewer?.tenant?.organization.publicId).toBe(world.initech.publicId);
    expect(viewer?.removedFrom).toBeNull();
  });

  test("rejoining the Firm clears it, without moving the session", async ({ t, world }) => {
    await remove(t, { world, who: "mo", firm: "acme" });
    await getViewer(t.auth, world.as.mo);
    await t.auth.$deps.db
      .insert(member)
      .values({ organizationId: world.acme.id, userId: world.users.mo.id, role: "member" });

    const viewer = await getViewer(t.auth, world.as.mo);
    expect(viewer?.tenant?.organization.publicId).toBe(world.globex.publicId);
    expect(viewer?.removedFrom).toBeNull();
    expect(await storedNotices(t, world.users.mo.id)).toEqual([null]);
  });

  test("a session with no Firm keeps it until it has one", async ({ t, world }) => {
    await remove(t, { world, who: "cy", firm: "acme" });
    await getViewer(t.auth, world.as.cy);
    expect((await getViewer(t.auth, world.as.cy))?.removedFrom).toEqual(firm(world.acme));

    const invited = await inviteMember(t.auth, {
      headers: await asOlgaIn(t, { world, org: world.globex }),
      organizationPublicId: world.globex.publicId,
      email: "cy@example.com",
      role: "member",
    });
    if (!invited.ok) throw new Error(invited.error);
    expect(
      await acceptInvitation(t.auth, {
        headers: world.as.cy,
        invitationPublicId: invited.data.publicId,
      }),
    ).toMatchObject({ ok: true });

    const viewer = await getViewer(t.auth, world.as.cy);
    expect(viewer?.tenant?.organization.publicId).toBe(world.globex.publicId);
    expect(viewer?.removedFrom).toBeNull();
  });

  test("a session with no Firm loses it once getViewer picks a new one", async ({ t, world }) => {
    await remove(t, { world, who: "cy", firm: "acme" });
    await getViewer(t.auth, world.as.cy);
    await t.auth.$deps.db
      .insert(member)
      .values({ organizationId: world.globex.id, userId: world.users.cy.id, role: "member" });

    const viewer = await getViewer(t.auth, world.as.cy);
    expect(viewer?.tenant?.organization.publicId).toBe(world.globex.publicId);
    expect(viewer?.removedFrom).toBeNull();
  });

  test("dismissing touches only the viewer's own session", async ({ t, world }) => {
    const moElsewhere = await t.signInAs("mo@example.com");
    await remove(t, { world, who: "mo", firm: "acme" });
    await remove(t, { world, who: "cy", firm: "acme" });
    for (const headers of [world.as.mo, moElsewhere, world.as.cy]) {
      // oxlint-disable-next-line no-await-in-loop -- each session is moved by its own request
      await getViewer(t.auth, headers);
    }

    await dismissRemovalNotice(t.auth, world.as.mo);

    expect((await getViewer(t.auth, world.as.mo))?.removedFrom).toBeNull();
    expect((await getViewer(t.auth, moElsewhere))?.removedFrom).toEqual(firm(world.acme));
    expect((await getViewer(t.auth, world.as.cy))?.removedFrom).toEqual(firm(world.acme));
  });

  test("dismissing without a session is refused", async ({ t }) => {
    expect(await dismissRemovalNotice(t.auth, new Headers())).toEqual({
      ok: false,
      error: "unauthenticated",
    });
  });
});
