// A Deactivated Firm from its members' side (ADR 0022): `pnpm org:deactivate`'s function, then the
// tenant API on sessions that were signed in before it ran and are never touched by it.
import { deactivateOrganization, reactivateOrganization } from "@repo/db/cli/organizations";
import { auditEvent, invitation, organization, session, user } from "@repo/db/schema";
import { eq } from "drizzle-orm";
import {
  acceptInvitation,
  getInvitation,
  getViewer,
  inviteMember,
  listMyInvitations,
  removeMember,
  requireTenant,
  switchOrganization,
} from "./tenant";
import { authTest, internalIdKeys, type TestAuth } from "./testing";

/**
 * Acme: Ada (owner), Cy (member). Globex: Ada (owner). Ada joined Acme last, so her sessions
 * start there; Acme is Cy's only Firm. Both are signed in.
 */
async function seedWorld(t: TestAuth) {
  const ada = await t.seedUser({ email: "ada@example.com", name: "Ada" });
  const cy = await t.seedUser({ email: "cy@example.com", name: "Cy" });
  const globex = await t.seedOrganization({
    name: "Globex",
    slug: "globex",
    members: [{ userId: ada.id, role: "owner", createdAt: new Date("2026-01-01") }],
  });
  const acme = await t.seedOrganization({
    name: "Acme",
    slug: "acme",
    members: [
      { userId: ada.id, role: "owner", createdAt: new Date("2026-02-01") },
      { userId: cy.id, role: "member" },
    ],
  });
  return {
    acme,
    globex,
    users: { ada, cy },
    cyInAcme: acme.members[1]!,
    as: { ada: await t.signInAs("ada@example.com"), cy: await t.signInAs("cy@example.com") },
  };
}

const test = authTest.extend("world", ({ t }) => seedWorld(t));

const deactivate = (t: TestAuth, slug = "acme") =>
  deactivateOrganization(t.auth.$deps.db, { slug, reason: "Left Cognitive Wealth" });

describe("getViewer after a deactivation", () => {
  test("leaves a single-Firm member with no tenant, and says which Firm went", async ({
    t,
    world,
  }) => {
    const { at } = await deactivate(t);

    for (const _ of [1, 2]) {
      // oxlint-disable-next-line no-await-in-loop -- the moving request, then a later one
      const viewer = await getViewer(t.auth, world.as.cy);
      expect(viewer?.tenant).toBeNull();
      expect(viewer?.memberships).toEqual([]);
      expect(viewer?.deactivatedFirms).toEqual([
        { publicId: world.acme.publicId, name: "Acme", deactivatedAt: at },
      ]);
    }
    expect(await requireTenant(t.auth, world.as.cy)).toEqual({ ok: false, error: "no_tenant" });
  });

  test("moves a two-Firm member to their other Firm, and says which Firm went", async ({
    t,
    world,
  }) => {
    const { at } = await deactivate(t);

    for (const _ of [1, 2]) {
      // oxlint-disable-next-line no-await-in-loop -- the moving request, then a later one
      const viewer = await getViewer(t.auth, world.as.ada);
      expect(viewer?.tenant?.organization.publicId).toBe(world.globex.publicId);
      expect(viewer?.memberships.map((m) => m.organization.slug)).toEqual(["globex"]);
      expect(viewer?.deactivatedFirms).toEqual([
        { publicId: world.acme.publicId, name: "Acme", deactivatedAt: at },
      ]);
      const { internal: _internal, ...visible } = viewer!;
      expect(internalIdKeys(visible)).toEqual([]);
    }
    const [row] = await t.auth.$deps.db
      .select({ activeOrganizationId: session.activeOrganizationId })
      .from(session)
      .where(eq(session.userId, world.users.ada.id));
    expect(row?.activeOrganizationId).toBe(String(world.globex.id));
  });

  test("refuses a tenant mutation on the Firm, even as the first request after", async ({
    t,
    world,
  }) => {
    await deactivate(t);

    expect(
      await removeMember(t.auth, {
        headers: world.as.ada,
        organizationPublicId: world.acme.publicId,
        memberPublicId: world.cyInAcme.publicId,
      }),
    ).toEqual({ ok: false, error: "tenant_changed" });
    expect(
      await inviteMember(t.auth, {
        headers: world.as.cy,
        organizationPublicId: world.acme.publicId,
        email: "new@example.com",
        role: "member",
      }),
    ).toEqual({ ok: false, error: "no_tenant" });
    // The refused request moved them off the Firm; the next one still says why.
    expect((await getViewer(t.auth, world.as.ada))?.deactivatedFirms).toHaveLength(1);
    expect((await getViewer(t.auth, world.as.cy))?.deactivatedFirms).toHaveLength(1);
  });

  test("won't switch to the Firm", async ({ t, world }) => {
    await deactivate(t);
    expect(
      await switchOrganization(t.auth, {
        headers: world.as.ada,
        organizationPublicId: world.acme.publicId,
      }),
    ).toEqual({ ok: false, error: "not_found" });
  });

  test("signs nobody out", async ({ t, world }) => {
    const db = t.auth.$deps.db;
    const sessions = await db.select({ token: session.token }).from(session);

    await deactivate(t);

    expect(await db.select({ token: session.token }).from(session)).toEqual(sessions);
    expect(await db.$count(auditEvent, eq(auditEvent.action, "auth.sessions_revoked"))).toBe(0);
    expect((await getViewer(t.auth, world.as.cy))?.user.email).toBe("cy@example.com");
  });

  test("gives the Firm back on reactivation", async ({ t, world }) => {
    await deactivate(t);
    await getViewer(t.auth, world.as.cy);

    await reactivateOrganization(t.auth.$deps.db, { slug: "acme", reason: "Back" });

    const viewer = await getViewer(t.auth, world.as.cy);
    expect(viewer?.tenant?.organization.publicId).toBe(world.acme.publicId);
    expect(viewer?.deactivatedFirms).toEqual([]);
  });
});

describe("invitations into a Deactivated Firm", () => {
  // `org:deactivate` cancels them, so these stand for one created in a race with it: the Firm is
  // marked deactivated by hand and its invitation left pending.
  const invited = test.extend("invitation", async ({ t, world }) => {
    const [row] = await t.auth.$deps.db
      .insert(invitation)
      .values({
        organizationId: world.acme.id,
        email: "grace@example.com",
        role: "member",
        inviterId: world.users.ada.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      .returning({ publicId: invitation.publicId });
    await t.auth.$deps.db
      .update(organization)
      .set({ deactivatedAt: new Date() })
      .where(eq(organization.id, world.acme.id));
    return row!;
  });

  // Destructured so the fixture runs: Vitest sets up only the fixtures a test names.
  invited("make no address eligible to sign in", async ({ t, invitation: _pending }) => {
    await t.fetchAuth("/sign-in/magic-link", { body: { email: "grace@example.com" } });
    await t.settle();
    expect(t.mailer.messages.filter((m) => m.to === "grace@example.com")).toEqual([]);
    expect(await t.auth.$deps.db.$count(user, eq(user.email, "grace@example.com"))).toBe(0);
  });

  invited("aren't listed, shown or accepted", async ({ t, invitation: pending }) => {
    // Grace is a user already (of no Firm), so she can sign in and look.
    await t.seedUser({ email: "grace@example.com", name: "Grace" });
    const grace = await t.signInAs("grace@example.com");
    const viewer = await getViewer(t.auth, grace);

    expect(await listMyInvitations(t.auth, viewer!)).toEqual([]);
    expect(
      await getInvitation(t.auth, { headers: grace, invitationPublicId: pending.publicId }),
    ).toEqual({ ok: false, error: "not_found" });
    expect(
      await acceptInvitation(t.auth, { headers: grace, invitationPublicId: pending.publicId }),
    ).toEqual({ ok: false, error: "not_found" });
    expect((await getViewer(t.auth, grace))?.memberships).toEqual([]);
  });
});
