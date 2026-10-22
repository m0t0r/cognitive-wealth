import { test as dbTest } from "@repo/db/testing";
import { auditEvent, invitation, member, session } from "@repo/db/schema";
import { parseInvitationEmail } from "@repo/testing/mailpit";
import { asc, eq } from "drizzle-orm";
import { describe, expect, onTestFinished, vi } from "vitest";
import {
  acceptInvitation,
  cancelInvitation,
  changeMemberRole,
  declineInvitation,
  getInvitation,
  getViewer,
  inviteMember,
  listInvitations,
  listMembers,
  listMemberships,
  removeMember,
  switchOrganization,
  updateProfileName,
} from "./tenant";
import { createTestAuth, internalIdKeys as internalKeys, type TestAuth } from "./testing";

/**
 * Acme: Ada (owner), Bob (admin), Cy (member). Globex: Ada (owner). Ada joined Acme last, so her
 * sessions start there. Everyone is signed in.
 */
async function seedWorld(t: TestAuth) {
  const ada = await t.seedUser({ email: "ada@example.com", name: "Ada" });
  const bob = await t.seedUser({ email: "bob@example.com", name: "Bob" });
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
      { userId: bob.id, role: "admin" },
      { userId: cy.id, role: "member" },
    ],
  });
  const [adaInAcme, bobInAcme, cyInAcme] = acme.members;
  return {
    acme,
    globex,
    users: { ada, bob, cy },
    members: { ada: adaInAcme!, bob: bobInAcme!, cy: cyInAcme! },
    as: {
      ada: await t.signInAs("ada@example.com"),
      bob: await t.signInAs("bob@example.com"),
      cy: await t.signInAs("cy@example.com"),
    },
  };
}

const test = dbTest
  .extend("t", ({ orm }) => createTestAuth({ orm }))
  .extend("world", ({ t }) => seedWorld(t));

/** Moves the clock past the fresh-session window (Date only; Postgres keeps real time). */
function makeSessionsStale() {
  vi.useFakeTimers({ toFake: ["Date"] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
}

async function auditActions(t: TestAuth) {
  const rows = await t.auth.$deps.db
    .select({
      action: auditEvent.action,
      targetType: auditEvent.targetType,
      targetId: auditEvent.targetId,
    })
    .from(auditEvent)
    .orderBy(asc(auditEvent.id));
  return rows.filter((row) => !row.action.startsWith("auth."));
}

describe("getViewer", () => {
  test("returns null without a session", async ({ t }) => {
    expect(await getViewer(t.auth, new Headers())).toBeNull();
  });

  test("returns the user, tenant and memberships without internal IDs leaking", async ({
    t,
    world,
  }) => {
    const viewer = await getViewer(t.auth, world.as.ada);
    expect(viewer).toMatchObject({
      user: { publicId: world.users.ada.publicId, name: "Ada", email: "ada@example.com" },
      session: { isFresh: true },
      tenant: {
        organization: { publicId: world.acme.publicId, name: "Acme", slug: "acme" },
        role: "owner",
        memberPublicId: world.members.ada.publicId,
      },
      internal: { userId: world.users.ada.id, organizationId: world.acme.id },
    });
    expect(viewer!.memberships.map((m) => [m.organization.slug, m.role, m.isActive])).toEqual([
      ["acme", "owner", true],
      ["globex", "owner", false],
    ]);
    const { internal: _, ...visible } = viewer!;
    expect(internalKeys(visible)).toEqual([]);
  });

  test("drops a tenant the moment the member is removed", async ({ t, world }) => {
    expect((await getViewer(t.auth, world.as.cy))?.tenant?.organization.slug).toBe("acme");
    expect(
      await removeMember(t.auth, world.as.ada, { memberPublicId: world.members.cy.publicId }),
    ).toEqual({
      ok: true,
      data: null,
    });

    const viewer = await getViewer(t.auth, world.as.cy);
    expect(viewer?.tenant).toBeNull();
    expect(viewer?.memberships).toEqual([]);
    expect(await listMembers(t.auth, world.as.cy)).toEqual({ ok: false, error: "no_tenant" });
  });

  test("falls back to another membership and updates the session", async ({ t, world }) => {
    // Ada leaves Acme by another owner's hand; she keeps Globex.
    await t.auth.$deps.db
      .update(member)
      .set({ role: "owner" })
      .where(eq(member.id, world.members.bob.id));
    await removeMember(t.auth, world.as.bob, { memberPublicId: world.members.ada.publicId });

    const viewer = await getViewer(t.auth, world.as.ada);
    expect(viewer?.tenant?.organization.slug).toBe("globex");
    const sessions = await t.auth.$deps.db
      .select({ activeOrganizationId: session.activeOrganizationId })
      .from(session)
      .where(eq(session.userId, world.users.ada.id));
    expect(sessions).toEqual([{ activeOrganizationId: String(world.globex.id) }]);
  });
});

describe("switchOrganization", () => {
  test("switches to another of the viewer's organizations", async ({ t, world }) => {
    const result = await switchOrganization(t.auth, world.as.ada, {
      organizationPublicId: world.globex.publicId,
    });
    expect(result).toEqual({
      ok: true,
      data: { publicId: world.globex.publicId, name: "Globex", slug: "globex", logo: null },
    });
    expect((await getViewer(t.auth, world.as.ada))?.tenant?.organization.slug).toBe("globex");
  });

  test("refuses an organization the viewer isn't in", async ({ t, world }) => {
    expect(
      await switchOrganization(t.auth, world.as.bob, {
        organizationPublicId: world.globex.publicId,
      }),
    ).toEqual({ ok: false, error: "not_found" });
    expect((await getViewer(t.auth, world.as.bob))?.tenant?.organization.slug).toBe("acme");
  });

  test("refuses a malformed or unknown publicId", async ({ t, world }) => {
    for (const organizationPublicId of ["1", "not-a-uuid", crypto.randomUUID()]) {
      // Sequential on purpose: each step depends on the ones before.
      // oxlint-disable-next-line no-await-in-loop
      expect(await switchOrganization(t.auth, world.as.ada, { organizationPublicId })).toEqual({
        ok: false,
        error: "not_found",
      });
    }
  });

  test("lists memberships", async ({ t, world }) => {
    const result = await listMemberships(t.auth, world.as.ada);
    expect(result.ok && result.data.map((m) => m.organization.slug)).toEqual(["acme", "globex"]);
  });
});

describe("members", () => {
  test("lists the tenant's members only", async ({ t, world }) => {
    const result = await listMembers(t.auth, world.as.cy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((m) => [m.user.email, m.role])).toEqual([
      ["ada@example.com", "owner"],
      ["bob@example.com", "admin"],
      ["cy@example.com", "member"],
    ]);
    expect(internalKeys(result.data)).toEqual([]);
  });

  test("an admin changes a member's role", async ({ t, world }) => {
    const result = await changeMemberRole(t.auth, world.as.bob, {
      memberPublicId: world.members.cy.publicId,
      role: "admin",
    });
    expect(result).toMatchObject({
      ok: true,
      data: { publicId: world.members.cy.publicId, role: "admin" },
    });
  });

  test("a member can't change roles or remove anyone", async ({ t, world }) => {
    expect(
      await changeMemberRole(t.auth, world.as.cy, {
        memberPublicId: world.members.bob.publicId,
        role: "member",
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      await removeMember(t.auth, world.as.cy, { memberPublicId: world.members.bob.publicId }),
    ).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  test("an admin can't remove or demote an owner, or promote to owner", async ({ t, world }) => {
    expect(
      await removeMember(t.auth, world.as.bob, { memberPublicId: world.members.ada.publicId }),
    ).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(
      await changeMemberRole(t.auth, world.as.bob, {
        memberPublicId: world.members.ada.publicId,
        role: "member",
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      await changeMemberRole(t.auth, world.as.bob, {
        memberPublicId: world.members.cy.publicId,
        role: "owner",
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(await t.auth.$deps.db.$count(member, eq(member.role, "owner"))).toBe(2);
  });

  test("the last owner can't leave or step down", async ({ t, world }) => {
    expect(
      await removeMember(t.auth, world.as.ada, { memberPublicId: world.members.ada.publicId }),
    ).toEqual({
      ok: false,
      error: "last_owner",
    });
    expect(
      await changeMemberRole(t.auth, world.as.ada, {
        memberPublicId: world.members.ada.publicId,
        role: "admin",
      }),
    ).toEqual({ ok: false, error: "last_owner" });
  });

  test("can't reach a member of another organization by publicId", async ({ t, world }) => {
    const [adaInGlobex] = world.globex.members;
    // Bob is an admin of Acme only; Ada's Globex membership is outside his tenant.
    expect(
      await removeMember(t.auth, world.as.bob, { memberPublicId: adaInGlobex!.publicId }),
    ).toEqual({
      ok: false,
      error: "not_found",
    });
    // Even Ada can't, while Acme is her tenant: the publicId must belong to the active org.
    expect(
      await changeMemberRole(t.auth, world.as.ada, {
        memberPublicId: adaInGlobex!.publicId,
        role: "admin",
      }),
    ).toEqual({ ok: false, error: "not_found" });
  });

  test("a stale session must re-authenticate to change roles or remove members", async ({
    t,
    world,
  }) => {
    makeSessionsStale();
    expect(
      await changeMemberRole(t.auth, world.as.ada, {
        memberPublicId: world.members.cy.publicId,
        role: "admin",
      }),
    ).toEqual({ ok: false, error: "reauth_required" });
    expect(
      await removeMember(t.auth, world.as.ada, { memberPublicId: world.members.cy.publicId }),
    ).toEqual({
      ok: false,
      error: "reauth_required",
    });
    expect((await getViewer(t.auth, world.as.ada))?.session.isFresh).toBe(false);
    expect(await t.auth.$deps.db.$count(member)).toBe(4);
  });
});

describe("invitations", () => {
  test("invite → the invitee signs in → accepts", async ({ t, world }) => {
    const invited = await inviteMember(t.auth, world.as.bob, {
      email: "Dee@Example.com",
      role: "member",
    });
    expect(invited).toMatchObject({
      ok: true,
      data: {
        email: "dee@example.com",
        role: "member",
        status: "pending",
        organization: { publicId: world.acme.publicId, name: "Acme" },
        inviter: { name: "Bob" },
      },
    });
    if (!invited.ok) return;
    expect(internalKeys(invited.data)).toEqual([]);

    const email = await t.waitForEmail("dee@example.com");
    expect(email.idempotencyKey).toBe(`invitation/${invited.data.publicId}`);
    expect(email.tags).toEqual({ category: "invitation" });
    expect(parseInvitationEmail(email.text).url).toBe(
      `http://localhost:3000/invite/${invited.data.publicId}`,
    );

    const dee = await t.signInAs("dee@example.com");
    expect((await getViewer(t.auth, dee))?.tenant).toBeNull();
    expect(
      await getInvitation(t.auth, dee, { invitationPublicId: invited.data.publicId }),
    ).toMatchObject({
      ok: true,
      data: {
        publicId: invited.data.publicId,
        organization: { slug: "acme" },
        inviter: { name: "Bob" },
      },
    });

    expect(
      await acceptInvitation(t.auth, dee, { invitationPublicId: invited.data.publicId }),
    ).toEqual({
      ok: true,
      data: {
        organization: { publicId: world.acme.publicId, name: "Acme", slug: "acme", logo: null },
      },
    });
    const viewer = await getViewer(t.auth, dee);
    expect(viewer?.tenant).toMatchObject({ organization: { slug: "acme" }, role: "member" });
  });

  test("only the invited address can read or accept an invitation", async ({ t, world }) => {
    const invited = await inviteMember(t.auth, world.as.ada, {
      email: "dee@example.com",
      role: "admin",
    });
    if (!invited.ok) throw new Error("invite failed");
    const input = { invitationPublicId: invited.data.publicId };

    // Cy is signed in, but as someone else.
    expect(await getInvitation(t.auth, world.as.cy, input)).toEqual({
      ok: false,
      error: "wrong_recipient",
    });
    expect(await acceptInvitation(t.auth, world.as.cy, input)).toEqual({
      ok: false,
      error: "wrong_recipient",
    });
    expect(await declineInvitation(t.auth, world.as.cy, input)).toEqual({
      ok: false,
      error: "wrong_recipient",
    });
    expect(await getInvitation(t.auth, new Headers(), input)).toEqual({
      ok: false,
      error: "unauthenticated",
    });
    expect(await t.auth.$deps.db.$count(member, eq(member.role, "admin"))).toBe(1);
  });

  test("an unknown invitation reads as not found", async ({ t, world }) => {
    for (const invitationPublicId of [crypto.randomUUID(), "nope"]) {
      // Sequential on purpose: each step depends on the ones before.
      // oxlint-disable-next-line no-await-in-loop
      expect(await getInvitation(t.auth, world.as.cy, { invitationPublicId })).toEqual({
        ok: false,
        error: "not_found",
      });
    }
  });

  test("the invitee can decline", async ({ t, world }) => {
    const invited = await inviteMember(t.auth, world.as.ada, {
      email: "dee@example.com",
      role: "member",
    });
    if (!invited.ok) throw new Error("invite failed");
    const dee = await t.signInAs("dee@example.com");

    expect(
      await declineInvitation(t.auth, dee, { invitationPublicId: invited.data.publicId }),
    ).toEqual({
      ok: true,
      data: null,
    });
    expect(
      await acceptInvitation(t.auth, dee, { invitationPublicId: invited.data.publicId }),
    ).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  test("a member can't invite", async ({ t, world }) => {
    expect(
      await inviteMember(t.auth, world.as.cy, { email: "dee@example.com", role: "member" }),
    ).toEqual({
      ok: false,
      error: "forbidden",
    });
    await t.settle();
    expect(t.mailer.messages.filter((m) => m.to === "dee@example.com")).toEqual([]);
  });

  test("an admin can't invite an owner", async ({ t, world }) => {
    expect(
      await inviteMember(t.auth, world.as.bob, { email: "dee@example.com", role: "owner" }),
    ).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  test("refuses bad input and existing members", async ({ t, world }) => {
    expect(
      await inviteMember(t.auth, world.as.ada, { email: "not an email", role: "member" }),
    ).toEqual({
      ok: false,
      error: "invalid_input",
    });
    // An untyped caller could pass anything.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const superuser = "superuser" as "member";
    expect(
      await inviteMember(t.auth, world.as.ada, { email: "dee@example.com", role: superuser }),
    ).toEqual({ ok: false, error: "invalid_input" });
    expect(
      await inviteMember(t.auth, world.as.ada, { email: "cy@example.com", role: "member" }),
    ).toEqual({
      ok: false,
      error: "already_member",
    });
  });

  test("limits invitations to 20 per hour per user", async ({ t, world }) => {
    for (let i = 0; i < 20; i++) {
      // Sequential on purpose: each step depends on the ones before.
      // oxlint-disable-next-line no-await-in-loop
      const result = await inviteMember(t.auth, world.as.ada, {
        email: `p${i}@example.com`,
        role: "member",
      });
      expect(result.ok).toBe(true);
    }
    expect(
      await inviteMember(t.auth, world.as.ada, { email: "p20@example.com", role: "member" }),
    ).toEqual({
      ok: false,
      error: "rate_limited",
    });
  });

  test("lists and cancels the tenant's pending invitations", async ({ t, world }) => {
    const invited = await inviteMember(t.auth, world.as.ada, {
      email: "dee@example.com",
      role: "member",
    });
    if (!invited.ok) throw new Error("invite failed");
    const listed = await listInvitations(t.auth, world.as.cy);
    expect(listed.ok && listed.data.map((i) => i.email)).toEqual(["dee@example.com"]);
    expect(internalKeys(listed)).toEqual([]);

    expect(
      await cancelInvitation(t.auth, world.as.cy, { invitationPublicId: invited.data.publicId }),
    ).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(
      await cancelInvitation(t.auth, world.as.bob, { invitationPublicId: invited.data.publicId }),
    ).toEqual({
      ok: true,
      data: null,
    });
    expect(await listInvitations(t.auth, world.as.ada)).toEqual({ ok: true, data: [] });
  });

  test("can't cancel another organization's invitation", async ({ t, world }) => {
    await switchOrganization(t.auth, world.as.ada, { organizationPublicId: world.globex.publicId });
    const invited = await inviteMember(t.auth, world.as.ada, {
      email: "dee@example.com",
      role: "member",
    });
    if (!invited.ok) throw new Error("invite failed");
    expect(invited.data.organization.slug).toBe("globex");

    expect(
      await cancelInvitation(t.auth, world.as.bob, { invitationPublicId: invited.data.publicId }),
    ).toEqual({
      ok: false,
      error: "not_found",
    });
    const [row] = await t.auth.$deps.db.select({ status: invitation.status }).from(invitation);
    expect(row).toEqual({ status: "pending" });
  });

  test("a stale session must re-authenticate to cancel", async ({ t, world }) => {
    const invited = await inviteMember(t.auth, world.as.ada, {
      email: "dee@example.com",
      role: "member",
    });
    if (!invited.ok) throw new Error("invite failed");
    makeSessionsStale();
    expect(
      await cancelInvitation(t.auth, world.as.ada, { invitationPublicId: invited.data.publicId }),
    ).toEqual({
      ok: false,
      error: "reauth_required",
    });
  });
});

describe("profile", () => {
  test("updates the name", async ({ t, world }) => {
    expect(await updateProfileName(t.auth, world.as.cy, { name: "  Cy Young " })).toMatchObject({
      ok: true,
      data: { name: "Cy Young", email: "cy@example.com" },
    });
  });

  test("refuses empty, long or multi-line names", async ({ t, world }) => {
    for (const name of ["", "   ", "x".repeat(101), "Cy\nYoung"]) {
      // Sequential on purpose: each step depends on the ones before.
      // oxlint-disable-next-line no-await-in-loop
      expect(await updateProfileName(t.auth, world.as.cy, { name })).toEqual({
        ok: false,
        error: "invalid_input",
      });
    }
  });
});

describe("audit", () => {
  test("records each organization event with its target's publicId", async ({ t, world }) => {
    await switchOrganization(t.auth, world.as.ada, { organizationPublicId: world.globex.publicId });
    await switchOrganization(t.auth, world.as.ada, { organizationPublicId: world.acme.publicId });
    const first = await inviteMember(t.auth, world.as.ada, {
      email: "dee@example.com",
      role: "member",
    });
    const second = await inviteMember(t.auth, world.as.ada, {
      email: "eve@example.com",
      role: "member",
    });
    const third = await inviteMember(t.auth, world.as.ada, {
      email: "fay@example.com",
      role: "member",
    });
    if (!first.ok || !second.ok || !third.ok) throw new Error("invite failed");
    const dee = await t.signInAs("dee@example.com");
    await acceptInvitation(t.auth, dee, { invitationPublicId: first.data.publicId });
    const eve = await t.signInAs("eve@example.com");
    await declineInvitation(t.auth, eve, { invitationPublicId: second.data.publicId });
    await cancelInvitation(t.auth, world.as.ada, { invitationPublicId: third.data.publicId });
    await changeMemberRole(t.auth, world.as.ada, {
      memberPublicId: world.members.cy.publicId,
      role: "admin",
    });
    await removeMember(t.auth, world.as.ada, { memberPublicId: world.members.cy.publicId });
    await updateProfileName(t.auth, world.as.bob, { name: "Robert" });

    expect(await auditActions(t)).toEqual([
      { action: "org.switched", targetType: "organization", targetId: world.globex.publicId },
      { action: "org.switched", targetType: "organization", targetId: world.acme.publicId },
      { action: "org.invitation.created", targetType: "invitation", targetId: first.data.publicId },
      {
        action: "org.invitation.created",
        targetType: "invitation",
        targetId: second.data.publicId,
      },
      { action: "org.invitation.created", targetType: "invitation", targetId: third.data.publicId },
      {
        action: "org.invitation.accepted",
        targetType: "invitation",
        targetId: first.data.publicId,
      },
      {
        action: "org.invitation.declined",
        targetType: "invitation",
        targetId: second.data.publicId,
      },
      {
        action: "org.invitation.cancelled",
        targetType: "invitation",
        targetId: third.data.publicId,
      },
      {
        action: "org.member.role_changed",
        targetType: "member",
        targetId: world.members.cy.publicId,
      },
      { action: "org.member.removed", targetType: "member", targetId: world.members.cy.publicId },
      { action: "user.profile_updated", targetType: "user", targetId: world.users.bob.publicId },
    ]);
  });

  test("refused actions write nothing", async ({ t, world }) => {
    await inviteMember(t.auth, world.as.cy, { email: "dee@example.com", role: "member" });
    await removeMember(t.auth, world.as.bob, { memberPublicId: world.members.ada.publicId });
    expect(await auditActions(t)).toEqual([]);
  });
});
