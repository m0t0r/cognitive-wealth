import { auditEvent, invitation, member } from "@repo/db/schema";
import { parseInvitationEmail } from "@repo/testing/mailpit";
import { and, asc, eq } from "drizzle-orm";
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
  listMyInvitations,
  removeMember,
  requireTenant,
  revokeUserSessions,
  switchOrganization,
  updateProfileName,
} from "./tenant";
import { consumeRateLimit } from "./rate-limit";
import { INVITE_LIMIT } from "./tenant";
import { authTest, internalIdKeys as internalKeys, type TestAuth } from "./testing";

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

const test = authTest.extend("world", ({ t }) => seedWorld(t));

/** The verified tenant viewer the reads take; fails the test without one. */
async function tenantViewer(t: TestAuth, headers: Headers) {
  const result = await requireTenant(t.auth, headers);
  if (!result.ok) throw new Error(`No tenant: ${result.error}`);
  return result.data;
}

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
      await removeMember(t.auth, {
        headers: world.as.ada,
        organizationPublicId: world.acme.publicId,
        memberPublicId: world.members.cy.publicId,
      }),
    ).toEqual({
      ok: true,
      data: null,
    });

    const viewer = await getViewer(t.auth, world.as.cy);
    expect(viewer?.tenant).toBeNull();
    expect(viewer?.memberships).toEqual([]);
    expect(await requireTenant(t.auth, world.as.cy)).toEqual({ ok: false, error: "no_tenant" });
  });

  test("falls back to another membership and updates the session", async ({ t, world }) => {
    // Ada leaves Acme by another owner's hand; she keeps Globex.
    await t.auth.$deps.db
      .update(member)
      .set({ role: "owner" })
      .where(eq(member.id, world.members.bob.id));
    await removeMember(t.auth, {
      headers: world.as.bob,
      organizationPublicId: world.acme.publicId,
      memberPublicId: world.members.ada.publicId,
    });

    const viewer = await getViewer(t.auth, world.as.ada);
    expect(viewer?.tenant?.organization.publicId).toBe(world.globex.publicId);

    // Rejoining Acme makes it her newest membership. She stays in Globex only if the fallback
    // was saved to the session; otherwise the session would still point at Acme.
    await t.auth.$deps.db
      .insert(member)
      .values({ organizationId: world.acme.id, userId: world.users.ada.id, role: "member" });
    const later = await getViewer(t.auth, world.as.ada);
    expect(later?.tenant?.organization.publicId).toBe(world.globex.publicId);
  });
});

describe("switchOrganization", () => {
  test("switches to another of the viewer's organizations", async ({ t, world }) => {
    const result = await switchOrganization(t.auth, {
      headers: world.as.ada,
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
      await switchOrganization(t.auth, {
        headers: world.as.bob,
        organizationPublicId: world.globex.publicId,
      }),
    ).toEqual({ ok: false, error: "not_found" });
    expect((await getViewer(t.auth, world.as.bob))?.tenant?.organization.slug).toBe("acme");
  });

  test("refuses a malformed or unknown publicId", async ({ t, world }) => {
    for (const organizationPublicId of ["1", "not-a-uuid", crypto.randomUUID()]) {
      // Sequential on purpose: each step depends on the ones before.
      // oxlint-disable-next-line no-await-in-loop
      const result = await switchOrganization(t.auth, {
        headers: world.as.ada,
        organizationPublicId,
      });
      expect(result).toEqual({ ok: false, error: "not_found" });
    }
  });

  test("lists memberships", async ({ t, world }) => {
    const viewer = await getViewer(t.auth, world.as.ada);
    expect(listMemberships(viewer!).map((m) => m.organization.slug)).toEqual(["acme", "globex"]);
  });
});

describe("revokeUserSessions", () => {
  test("signs the user out at once, though their session is cached in storage", async ({
    t,
    world,
  }) => {
    expect(await getViewer(t.auth, world.as.cy)).not.toBeNull();
    const cacheKey = `active-sessions-${world.users.cy.id}`;
    expect(t.storage.keys()).toContain(cacheKey);

    expect(await revokeUserSessions(t.auth, world.users.cy.publicId)).toEqual({
      ok: true,
      data: null,
    });

    expect(await getViewer(t.auth, world.as.cy)).toBeNull();
    expect(t.storage.keys()).not.toContain(cacheKey);
    expect(await getViewer(t.auth, world.as.bob)).not.toBeNull();
    const [event] = await t.auth.$deps.db
      .select({ action: auditEvent.action, targetId: auditEvent.targetId })
      .from(auditEvent)
      .where(eq(auditEvent.action, "auth.sessions_revoked"));
    expect(event).toEqual({ action: "auth.sessions_revoked", targetId: world.users.cy.publicId });
  });
});

describe("revokeUserSessions without the cached session list", () => {
  test("still signs out a session the list lost (eviction, or two sign-ins racing)", async ({
    t,
    world,
  }) => {
    expect(await getViewer(t.auth, world.as.cy)).not.toBeNull();
    // Better Auth finds cached sessions through this list; Redis may evict it, or two
    // concurrent sign-ins may each write it without the other's session.
    await t.storage.delete(`active-sessions-${world.users.cy.id}`);

    expect(await revokeUserSessions(t.auth, world.users.cy.publicId)).toEqual({
      ok: true,
      data: null,
    });

    expect(await getViewer(t.auth, world.as.cy)).toBeNull();
  });
});

describe("members", () => {
  test("lists the tenant's members only", async ({ t, world }) => {
    const members = await listMembers(t.auth, await tenantViewer(t, world.as.cy));
    expect(members.map((m) => [m.user.email, m.role])).toEqual([
      ["ada@example.com", "owner"],
      ["bob@example.com", "admin"],
      ["cy@example.com", "member"],
    ]);
    expect(internalKeys(members)).toEqual([]);
  });

  test("an admin changes a member's role", async ({ t, world }) => {
    const result = await changeMemberRole(t.auth, {
      headers: world.as.bob,
      organizationPublicId: world.acme.publicId,
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
      await changeMemberRole(t.auth, {
        headers: world.as.cy,
        organizationPublicId: world.acme.publicId,
        memberPublicId: world.members.bob.publicId,
        role: "member",
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      await removeMember(t.auth, {
        headers: world.as.cy,
        organizationPublicId: world.acme.publicId,
        memberPublicId: world.members.bob.publicId,
      }),
    ).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  test("an admin can't remove or demote an owner, or promote to owner", async ({ t, world }) => {
    expect(
      await removeMember(t.auth, {
        headers: world.as.bob,
        organizationPublicId: world.acme.publicId,
        memberPublicId: world.members.ada.publicId,
      }),
    ).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(
      await changeMemberRole(t.auth, {
        headers: world.as.bob,
        organizationPublicId: world.acme.publicId,
        memberPublicId: world.members.ada.publicId,
        role: "member",
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      await changeMemberRole(t.auth, {
        headers: world.as.bob,
        organizationPublicId: world.acme.publicId,
        memberPublicId: world.members.cy.publicId,
        role: "owner",
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(await t.auth.$deps.db.$count(member, eq(member.role, "owner"))).toBe(2);
  });

  test("the last owner can't leave or step down", async ({ t, world }) => {
    expect(
      await removeMember(t.auth, {
        headers: world.as.ada,
        organizationPublicId: world.acme.publicId,
        memberPublicId: world.members.ada.publicId,
      }),
    ).toEqual({
      ok: false,
      error: "last_owner",
    });
    expect(
      await changeMemberRole(t.auth, {
        headers: world.as.ada,
        organizationPublicId: world.acme.publicId,
        memberPublicId: world.members.ada.publicId,
        role: "admin",
      }),
    ).toEqual({ ok: false, error: "last_owner" });
  });

  test("can't reach a member of another organization by publicId", async ({ t, world }) => {
    const [adaInGlobex] = world.globex.members;
    // Bob is an admin of Acme only; Ada's Globex membership is outside his tenant.
    expect(
      await removeMember(t.auth, {
        headers: world.as.bob,
        organizationPublicId: world.acme.publicId,
        memberPublicId: adaInGlobex!.publicId,
      }),
    ).toEqual({
      ok: false,
      error: "not_found",
    });
    // Even Ada can't, while Acme is her tenant: the publicId must belong to the active org.
    expect(
      await changeMemberRole(t.auth, {
        headers: world.as.ada,
        organizationPublicId: world.acme.publicId,
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
      await changeMemberRole(t.auth, {
        headers: world.as.ada,
        organizationPublicId: world.acme.publicId,
        memberPublicId: world.members.cy.publicId,
        role: "admin",
      }),
    ).toEqual({ ok: false, error: "reauth_required" });
    expect(
      await removeMember(t.auth, {
        headers: world.as.ada,
        organizationPublicId: world.acme.publicId,
        memberPublicId: world.members.cy.publicId,
      }),
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
    const invited = await inviteMember(t.auth, {
      headers: world.as.bob,
      organizationPublicId: world.acme.publicId,
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

    const email = await t.waitForEmail({ to: "dee@example.com" });
    expect(email.idempotencyKey).toBe(`invitation/${invited.data.publicId}`);
    expect(email.tags).toEqual({ category: "invitation" });
    expect(parseInvitationEmail(email.text).url).toBe(
      `http://localhost:3000/invite/${invited.data.publicId}`,
    );

    const dee = await t.signInAs("dee@example.com");
    expect((await getViewer(t.auth, dee))?.tenant).toBeNull();
    expect(
      await getInvitation(t.auth, { headers: dee, invitationPublicId: invited.data.publicId }),
    ).toMatchObject({
      ok: true,
      data: {
        publicId: invited.data.publicId,
        organization: { slug: "acme" },
        inviter: { name: "Bob" },
      },
    });

    expect(
      await acceptInvitation(t.auth, { headers: dee, invitationPublicId: invited.data.publicId }),
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
    const invited = await inviteMember(t.auth, {
      headers: world.as.ada,
      organizationPublicId: world.acme.publicId,
      email: "dee@example.com",
      role: "admin",
    });
    if (!invited.ok) throw new Error("invite failed");
    const input = { invitationPublicId: invited.data.publicId };

    // Cy is signed in, but as someone else.
    expect(await getInvitation(t.auth, { headers: world.as.cy, ...input })).toEqual({
      ok: false,
      error: "wrong_recipient",
    });
    expect(await acceptInvitation(t.auth, { headers: world.as.cy, ...input })).toEqual({
      ok: false,
      error: "wrong_recipient",
    });
    expect(await declineInvitation(t.auth, { headers: world.as.cy, ...input })).toEqual({
      ok: false,
      error: "wrong_recipient",
    });
    expect(await getInvitation(t.auth, { headers: new Headers(), ...input })).toEqual({
      ok: false,
      error: "unauthenticated",
    });
    expect(await t.auth.$deps.db.$count(member, eq(member.role, "admin"))).toBe(1);
  });

  test("an unknown invitation reads as not found", async ({ t, world }) => {
    for (const invitationPublicId of [crypto.randomUUID(), "nope"]) {
      // Sequential on purpose: each step depends on the ones before.
      // oxlint-disable-next-line no-await-in-loop
      expect(await getInvitation(t.auth, { headers: world.as.cy, invitationPublicId })).toEqual({
        ok: false,
        error: "not_found",
      });
    }
  });

  test("the invitee can decline", async ({ t, world }) => {
    const invited = await inviteMember(t.auth, {
      headers: world.as.ada,
      organizationPublicId: world.acme.publicId,
      email: "dee@example.com",
      role: "member",
    });
    if (!invited.ok) throw new Error("invite failed");
    const dee = await t.signInAs("dee@example.com");

    expect(
      await declineInvitation(t.auth, { headers: dee, invitationPublicId: invited.data.publicId }),
    ).toEqual({
      ok: true,
      data: null,
    });
    expect(
      await acceptInvitation(t.auth, { headers: dee, invitationPublicId: invited.data.publicId }),
    ).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  test("a member can't invite", async ({ t, world }) => {
    expect(
      await inviteMember(t.auth, {
        headers: world.as.cy,
        organizationPublicId: world.acme.publicId,
        email: "dee@example.com",
        role: "member",
      }),
    ).toEqual({
      ok: false,
      error: "forbidden",
    });
    await t.settle();
    expect(t.mailer.messages.filter((m) => m.to === "dee@example.com")).toEqual([]);
  });

  test("an admin can't invite an owner", async ({ t, world }) => {
    expect(
      await inviteMember(t.auth, {
        headers: world.as.bob,
        organizationPublicId: world.acme.publicId,
        email: "dee@example.com",
        role: "owner",
      }),
    ).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  test("refuses bad input and existing members", async ({ t, world }) => {
    expect(
      await inviteMember(t.auth, {
        headers: world.as.ada,
        organizationPublicId: world.acme.publicId,
        email: "not an email",
        role: "member",
      }),
    ).toEqual({
      ok: false,
      error: "invalid_input",
    });
    // An untyped caller could pass anything.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const superuser = "superuser" as "member";
    expect(
      await inviteMember(t.auth, {
        headers: world.as.ada,
        organizationPublicId: world.acme.publicId,
        email: "dee@example.com",
        role: superuser,
      }),
    ).toEqual({ ok: false, error: "invalid_input" });
    expect(
      await inviteMember(t.auth, {
        headers: world.as.ada,
        organizationPublicId: world.acme.publicId,
        email: "cy@example.com",
        role: "member",
      }),
    ).toEqual({
      ok: false,
      error: "already_member",
    });
  });

  test("a stale session must re-authenticate to invite an owner or admin, not a member", async ({
    t,
    world,
  }) => {
    makeSessionsStale();
    const emailsBefore = t.mailer.messages.length;
    for (const [as, role] of [
      [world.as.ada, "owner"],
      [world.as.ada, "admin"],
      [world.as.bob, "admin"],
    ] as const) {
      // Sequential on purpose: each case checks the database afterwards.
      // oxlint-disable-next-line no-await-in-loop
      const result = await inviteMember(t.auth, {
        headers: as,
        organizationPublicId: world.acme.publicId,
        email: "dee@example.com",
        role,
      });
      expect(result).toEqual({ ok: false, error: "reauth_required" });
    }
    expect(await t.auth.$deps.db.$count(invitation)).toBe(0);
    expect(t.mailer.messages).toHaveLength(emailsBefore);
    expect(await auditActions(t)).toEqual([]);

    expect(
      await inviteMember(t.auth, {
        headers: world.as.bob,
        organizationPublicId: world.acme.publicId,
        email: "dee@example.com",
        role: "member",
      }),
    ).toMatchObject({ ok: true });
  });

  test("an invite that's refused doesn't spend the hourly limit", async ({ t, world }) => {
    for (let i = 0; i < 25; i++) {
      // Sequential on purpose: each attempt would count against the limit.
      // oxlint-disable-next-line no-await-in-loop
      const result = await inviteMember(t.auth, {
        headers: world.as.bob,
        organizationPublicId: world.acme.publicId,
        email: i % 2 === 0 ? "cy@example.com" : "dee@example.com",
        // An admin can't invite an owner; Cy is already a member.
        role: i % 2 === 0 ? "member" : "owner",
      });
      expect(result).toMatchObject({ ok: false });
    }

    expect(
      await inviteMember(t.auth, {
        headers: world.as.bob,
        organizationPublicId: world.acme.publicId,
        email: "dee@example.com",
        role: "member",
      }),
    ).toMatchObject({ ok: true });
  });

  test("keeps and records an invitation whose email failed, and says so", async ({ t, world }) => {
    const first = await inviteMember(t.auth, {
      headers: world.as.ada,
      organizationPublicId: world.acme.publicId,
      email: "dee@example.com",
      role: "member",
    });
    if (!first.ok) throw new Error(first.error);
    vi.spyOn(t.mailer, "send").mockRejectedValueOnce(new Error("SMTP is down"));

    expect(
      await inviteMember(t.auth, {
        headers: world.as.ada,
        organizationPublicId: world.acme.publicId,
        email: "dee@example.com",
        role: "member",
      }),
    ).toEqual({ ok: false, error: "email_failed" });

    // Better Auth replaced the first invitation before the send failed: both are on record.
    const pending = await listInvitations(t.auth, await tenantViewer(t, world.as.ada));
    expect(pending).toHaveLength(1);
    expect(pending[0]!.publicId).not.toBe(first.data.publicId);
    expect(await auditActions(t)).toEqual([
      { action: "org.invitation.created", targetType: "invitation", targetId: first.data.publicId },
      {
        action: "org.invitation.created",
        targetType: "invitation",
        targetId: pending[0]!.publicId,
      },
      {
        action: "org.invitation.cancelled",
        targetType: "invitation",
        targetId: first.data.publicId,
      },
    ]);

    // Sending again works, and replaces it.
    expect(
      await inviteMember(t.auth, {
        headers: world.as.ada,
        organizationPublicId: world.acme.publicId,
        email: "dee@example.com",
        role: "member",
      }),
    ).toMatchObject({ ok: true });
  });

  test("limits invitations to 20 per hour per user", async ({ t, world }) => {
    for (let i = 0; i < 20; i++) {
      // Sequential on purpose: each step depends on the ones before.
      // oxlint-disable-next-line no-await-in-loop
      const result = await inviteMember(t.auth, {
        headers: world.as.ada,
        organizationPublicId: world.acme.publicId,
        email: `p${i}@example.com`,
        role: "member",
      });
      expect(result.ok).toBe(true);
    }
    expect(
      await inviteMember(t.auth, {
        headers: world.as.ada,
        organizationPublicId: world.acme.publicId,
        email: "p20@example.com",
        role: "member",
      }),
    ).toEqual({
      ok: false,
      error: "rate_limited",
    });
  });

  test("lists and cancels the tenant's pending invitations", async ({ t, world }) => {
    const invited = await inviteMember(t.auth, {
      headers: world.as.ada,
      organizationPublicId: world.acme.publicId,
      email: "dee@example.com",
      role: "member",
    });
    if (!invited.ok) throw new Error("invite failed");
    const listed = await listInvitations(t.auth, await tenantViewer(t, world.as.cy));
    expect(listed.map((i) => i.email)).toEqual(["dee@example.com"]);
    expect(internalKeys(listed)).toEqual([]);

    expect(
      await cancelInvitation(t.auth, {
        headers: world.as.cy,
        organizationPublicId: world.acme.publicId,
        invitationPublicId: invited.data.publicId,
      }),
    ).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(
      await cancelInvitation(t.auth, {
        headers: world.as.bob,
        organizationPublicId: world.acme.publicId,
        invitationPublicId: invited.data.publicId,
      }),
    ).toEqual({
      ok: true,
      data: null,
    });
    expect(await listInvitations(t.auth, await tenantViewer(t, world.as.ada))).toEqual([]);
  });

  test("can't cancel another organization's invitation", async ({ t, world }) => {
    await switchOrganization(t.auth, {
      headers: world.as.ada,
      organizationPublicId: world.globex.publicId,
    });
    const invited = await inviteMember(t.auth, {
      headers: world.as.ada,
      organizationPublicId: world.globex.publicId,
      email: "dee@example.com",
      role: "member",
    });
    if (!invited.ok) throw new Error("invite failed");
    expect(invited.data.organization.slug).toBe("globex");

    expect(
      await cancelInvitation(t.auth, {
        headers: world.as.bob,
        organizationPublicId: world.acme.publicId,
        invitationPublicId: invited.data.publicId,
      }),
    ).toEqual({
      ok: false,
      error: "not_found",
    });
    const [row] = await t.auth.$deps.db.select({ status: invitation.status }).from(invitation);
    expect(row).toEqual({ status: "pending" });
  });

  test("a stale session must re-authenticate to cancel", async ({ t, world }) => {
    const invited = await inviteMember(t.auth, {
      headers: world.as.ada,
      organizationPublicId: world.acme.publicId,
      email: "dee@example.com",
      role: "member",
    });
    if (!invited.ok) throw new Error("invite failed");
    makeSessionsStale();
    expect(
      await cancelInvitation(t.auth, {
        headers: world.as.ada,
        organizationPublicId: world.acme.publicId,
        invitationPublicId: invited.data.publicId,
      }),
    ).toEqual({
      ok: false,
      error: "reauth_required",
    });
  });
});

// Tab A shows Acme; tab B (the same session) switches it to Globex. Tab A's next mutation names
// Acme, the workspace it showed, and must be refused before anything happens.
async function switchInAnotherTab({
  t,
  headers,
  organizationPublicId,
}: {
  t: TestAuth;
  headers: Headers;
  organizationPublicId: string;
}) {
  expect((await switchOrganization(t.auth, { headers, organizationPublicId })).ok).toBe(true);
}

/** Moves an invitation past its expiry. */
async function expire(t: TestAuth, invitationPublicId: string) {
  await t.auth.$deps.db
    .update(invitation)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(invitation.publicId, invitationPublicId));
}

describe("a page showing another workspace (tenant_changed)", () => {
  test("refuses an invite with no invitation, email, rate-limit hit or audit row", async ({
    t,
    world,
  }) => {
    await switchInAnotherTab({
      t,
      headers: world.as.ada,
      organizationPublicId: world.globex.publicId,
    });

    expect(
      await inviteMember(t.auth, {
        headers: world.as.ada,
        organizationPublicId: world.acme.publicId,
        email: "dee@example.com",
        role: "member",
      }),
    ).toEqual({ ok: false, error: "tenant_changed" });

    await t.settle();
    expect(await t.auth.$deps.db.$count(invitation)).toBe(0);
    expect(t.mailer.messages.filter((m) => m.to === "dee@example.com")).toEqual([]);
    expect(t.storage.keys().filter((key) => key.includes("invite:"))).toEqual([]);
    expect((await auditActions(t)).map((row) => row.action)).toEqual(["org.switched"]);
  });

  test("refuses role changes, removals and cancellations with nothing changed", async ({
    t,
    world,
  }) => {
    const invited = await inviteMember(t.auth, {
      headers: world.as.ada,
      organizationPublicId: world.acme.publicId,
      email: "dee@example.com",
      role: "member",
    });
    if (!invited.ok) throw new Error("invite failed");
    await switchInAnotherTab({
      t,
      headers: world.as.ada,
      organizationPublicId: world.globex.publicId,
    });
    const stale = { organizationPublicId: world.acme.publicId };

    expect(
      await changeMemberRole(t.auth, {
        headers: world.as.ada,
        ...stale,
        memberPublicId: world.members.cy.publicId,
        role: "admin",
      }),
    ).toEqual({ ok: false, error: "tenant_changed" });
    expect(
      await removeMember(t.auth, {
        headers: world.as.ada,
        ...stale,
        memberPublicId: world.members.cy.publicId,
      }),
    ).toEqual({ ok: false, error: "tenant_changed" });
    expect(
      await cancelInvitation(t.auth, {
        headers: world.as.ada,
        ...stale,
        invitationPublicId: invited.data.publicId,
      }),
    ).toEqual({ ok: false, error: "tenant_changed" });

    const [cy] = await t.auth.$deps.db
      .select({ role: member.role })
      .from(member)
      .where(eq(member.id, world.members.cy.id));
    expect(cy).toEqual({ role: "member" });
    const [row] = await t.auth.$deps.db.select({ status: invitation.status }).from(invitation);
    expect(row).toEqual({ status: "pending" });
    expect((await auditActions(t)).map((r) => r.action)).toEqual([
      "org.invitation.created",
      "org.switched",
    ]);
  });

  test("comes before every other check", async ({ t, world }) => {
    await switchInAnotherTab({
      t,
      headers: world.as.ada,
      organizationPublicId: world.globex.publicId,
    });
    makeSessionsStale();
    const stale = { organizationPublicId: world.acme.publicId };
    // A stale session would be `reauth_required`, bad input `invalid_input`, and a publicId from
    // the old page `not_found`: none of them may say why before the tenant check does.
    expect(
      await removeMember(t.auth, { headers: world.as.ada, ...stale, memberPublicId: "nope" }),
    ).toEqual({
      ok: false,
      error: "tenant_changed",
    });
    expect(
      await inviteMember(t.auth, {
        headers: world.as.ada,
        ...stale,
        email: "not an email",
        role: "member",
      }),
    ).toEqual({ ok: false, error: "tenant_changed" });
  });

  test("still acts on the workspace the page shows", async ({ t, world }) => {
    await switchInAnotherTab({
      t,
      headers: world.as.ada,
      organizationPublicId: world.globex.publicId,
    });
    const invited = await inviteMember(t.auth, {
      headers: world.as.ada,
      organizationPublicId: world.globex.publicId,
      email: "dee@example.com",
      role: "member",
    });
    expect(invited).toMatchObject({ ok: true, data: { organization: { slug: "globex" } } });
  });
});

describe("inviting an address again", () => {
  test("replaces an expired invitation with a new one", async ({ t, world }) => {
    const input = {
      organizationPublicId: world.acme.publicId,
      email: "dee@example.com",
      role: "admin" as const,
    };
    const first = await inviteMember(t.auth, { headers: world.as.ada, ...input });
    if (!first.ok) throw new Error("invite failed");
    await expire(t, first.data.publicId);
    const listedExpired = await listInvitations(t.auth, await tenantViewer(t, world.as.ada));
    expect(listedExpired.map((i) => i.publicId)).toEqual([first.data.publicId]);

    const second = await inviteMember(t.auth, { headers: world.as.ada, ...input });
    if (!second.ok) throw new Error("re-invite failed");

    expect(second.data).toMatchObject({ email: "dee@example.com", role: "admin" });
    expect(second.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const listed = await listInvitations(t.auth, await tenantViewer(t, world.as.ada));
    expect(listed.map((i) => i.publicId)).toEqual([second.data.publicId]);
    const [old] = await t.auth.$deps.db
      .select({ status: invitation.status })
      .from(invitation)
      .where(eq(invitation.publicId, first.data.publicId));
    expect(old).toEqual({ status: "canceled" });
    await t.settle();
    // One email per invitation: the new link goes out, under the new invitation's key.
    expect(
      t.mailer.messages.filter((m) => m.to === "dee@example.com").map((m) => m.idempotencyKey),
    ).toEqual([`invitation/${first.data.publicId}`, `invitation/${second.data.publicId}`]);
    expect(await auditActions(t)).toEqual([
      { action: "org.invitation.created", targetType: "invitation", targetId: first.data.publicId },
      {
        action: "org.invitation.created",
        targetType: "invitation",
        targetId: second.data.publicId,
      },
      {
        action: "org.invitation.cancelled",
        targetType: "invitation",
        targetId: first.data.publicId,
      },
    ]);
  });

  test("replaces an unexpired invitation too", async ({ t, world }) => {
    const input = {
      organizationPublicId: world.acme.publicId,
      email: "dee@example.com",
      role: "member" as const,
    };
    const first = await inviteMember(t.auth, { headers: world.as.ada, ...input });
    const second = await inviteMember(t.auth, { headers: world.as.ada, ...input });
    if (!first.ok || !second.ok) throw new Error("invite failed");
    const listed = await listInvitations(t.auth, await tenantViewer(t, world.as.ada));
    expect(listed.map((i) => i.publicId)).toEqual([second.data.publicId]);
  });

  test("counts against the same hourly invite limit", async ({ t, world }) => {
    const first = await inviteMember(t.auth, {
      headers: world.as.ada,
      organizationPublicId: world.acme.publicId,
      email: "dee@example.com",
      role: "member",
    });
    if (!first.ok) throw new Error("invite failed");
    await expire(t, first.data.publicId);
    // Spend the rest of Ada's hour.
    for (let i = 1; i < INVITE_LIMIT.max; i++) {
      // Sequential on purpose: each step depends on the ones before.
      // oxlint-disable-next-line no-await-in-loop
      await consumeRateLimit({
        storage: t.storage,
        key: `invite:${world.users.ada.id}`,
        rule: INVITE_LIMIT,
      });
    }

    expect(
      await inviteMember(t.auth, {
        headers: world.as.ada,
        organizationPublicId: world.acme.publicId,
        email: "dee@example.com",
        role: "member",
      }),
    ).toEqual({ ok: false, error: "rate_limited" });
    const [old] = await t.auth.$deps.db
      .select({ status: invitation.status })
      .from(invitation)
      .where(eq(invitation.publicId, first.data.publicId));
    expect(old).toEqual({ status: "pending" });
  });
});

describe("an inviter who leaves or loses the role", () => {
  test("removing them cancels the invitations they sent", async ({ t, world }) => {
    await t.seedUser({ email: "dee@example.com", name: "Dee" });
    const invited = await inviteMember(t.auth, {
      headers: world.as.bob,
      organizationPublicId: world.acme.publicId,
      email: "dee@example.com",
      role: "admin",
    });
    if (!invited.ok) throw new Error(invited.error);

    await removeMember(t.auth, {
      headers: world.as.ada,
      organizationPublicId: world.acme.publicId,
      memberPublicId: world.members.bob.publicId,
    });

    expect(await listInvitations(t.auth, await tenantViewer(t, world.as.ada))).toEqual([]);
    const dee = await t.signInAs("dee@example.com");
    expect(
      await acceptInvitation(t.auth, { headers: dee, invitationPublicId: invited.data.publicId }),
    ).toEqual({ ok: false, error: "not_found" });
    expect(await auditActions(t)).toContainEqual({
      action: "org.invitation.cancelled",
      targetType: "invitation",
      targetId: invited.data.publicId,
    });
  });

  test("demoting an owner cancels only the invitations they can no longer send", async ({
    t,
    world,
  }) => {
    await changeMemberRole(t.auth, {
      headers: world.as.ada,
      organizationPublicId: world.acme.publicId,
      memberPublicId: world.members.bob.publicId,
      role: "owner",
    });
    const asOwner = await inviteMember(t.auth, {
      headers: world.as.bob,
      organizationPublicId: world.acme.publicId,
      email: "dee@example.com",
      role: "owner",
    });
    const asMember = await inviteMember(t.auth, {
      headers: world.as.bob,
      organizationPublicId: world.acme.publicId,
      email: "eve@example.com",
      role: "member",
    });
    if (!asOwner.ok || !asMember.ok) throw new Error("invite failed");

    await changeMemberRole(t.auth, {
      headers: world.as.ada,
      organizationPublicId: world.acme.publicId,
      memberPublicId: world.members.bob.publicId,
      role: "admin",
    });

    const pending = await listInvitations(t.auth, await tenantViewer(t, world.as.ada));
    expect(pending.map((i) => i.publicId)).toEqual([asMember.data.publicId]);
  });

  test("an invitation left pending by a departed inviter can't be read, listed or accepted", async ({
    t,
    world,
  }) => {
    const invited = await inviteMember(t.auth, {
      headers: world.as.bob,
      organizationPublicId: world.acme.publicId,
      email: "dee@example.com",
      role: "admin",
    });
    if (!invited.ok) throw new Error(invited.error);
    const dee = await t.signInAs("dee@example.com");
    // Not through `removeMember` (which cancels it): any other way the membership ends.
    await t.auth.$deps.db.delete(member).where(eq(member.id, world.members.bob.id));

    const viewer = await getViewer(t.auth, dee);
    expect(await listMyInvitations(t.auth, viewer!)).toEqual([]);
    expect(
      await getInvitation(t.auth, { headers: dee, invitationPublicId: invited.data.publicId }),
    ).toEqual({ ok: false, error: "not_found" });
    expect(
      await acceptInvitation(t.auth, { headers: dee, invitationPublicId: invited.data.publicId }),
    ).toEqual({ ok: false, error: "not_found" });
    expect(await t.auth.$deps.db.$count(member, eq(member.organizationId, world.acme.id))).toBe(2);
  });

  test("an owner invitation from someone no longer an owner can't be accepted", async ({
    t,
    world,
  }) => {
    const invited = await inviteMember(t.auth, {
      headers: world.as.ada,
      organizationPublicId: world.acme.publicId,
      email: "dee@example.com",
      role: "owner",
    });
    if (!invited.ok) throw new Error(invited.error);
    const dee = await t.signInAs("dee@example.com");
    await t.auth.$deps.db
      .update(member)
      .set({ role: "admin" })
      .where(eq(member.id, world.members.ada.id));

    expect(
      await acceptInvitation(t.auth, { headers: dee, invitationPublicId: invited.data.publicId }),
    ).toEqual({ ok: false, error: "not_found" });
    expect((await getViewer(t.auth, dee))?.tenant).toBeNull();
  });
});

describe("listMyInvitations", () => {
  test("lists only the viewer's own invitations they can still answer", async ({ t, world }) => {
    const toDee = (organizationPublicId: string) =>
      inviteMember(t.auth, {
        headers: world.as.ada,
        organizationPublicId,
        email: "Dee@Example.com",
        role: "member",
      });
    const acme = await toDee(world.acme.publicId);
    const other = await inviteMember(t.auth, {
      headers: world.as.ada,
      organizationPublicId: world.acme.publicId,
      email: "eve@example.com",
      role: "admin",
    });
    await switchOrganization(t.auth, {
      headers: world.as.ada,
      organizationPublicId: world.globex.publicId,
    });
    const globex = await toDee(world.globex.publicId);
    if (!acme.ok || !other.ok || !globex.ok) throw new Error("invite failed");
    const dee = await t.signInAs("dee@example.com");
    const viewer = await getViewer(t.auth, dee);
    if (viewer === null) throw new Error("not signed in");

    const listed = await listMyInvitations(t.auth, viewer);
    expect(listed.map((i) => [i.organization.slug, i.email, i.inviter.name])).toEqual([
      ["globex", "dee@example.com", "Ada"],
      ["acme", "dee@example.com", "Ada"],
    ]);
    expect(internalKeys(listed)).toEqual([]);

    // Expired, cancelled and answered ones drop out.
    await t.auth.$deps.db
      .update(invitation)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitation.publicId, globex.data.publicId));
    await declineInvitation(t.auth, { headers: dee, invitationPublicId: acme.data.publicId });
    expect(await listMyInvitations(t.auth, viewer)).toEqual([]);
    expect(
      await t.auth.$deps.db.$count(
        invitation,
        and(eq(invitation.email, "eve@example.com"), eq(invitation.status, "pending")),
      ),
    ).toBe(1);
  });

  test("never lists someone else's invitations", async ({ t, world }) => {
    await inviteMember(t.auth, {
      headers: world.as.ada,
      organizationPublicId: world.acme.publicId,
      email: "dee@example.com",
      role: "member",
    });
    for (const headers of [world.as.ada, world.as.bob, world.as.cy]) {
      // oxlint-disable-next-line no-await-in-loop
      const viewer = await getViewer(t.auth, headers);
      // oxlint-disable-next-line no-await-in-loop
      expect(await listMyInvitations(t.auth, viewer!)).toEqual([]);
    }
  });
});

describe("profile", () => {
  test("updates the name", async ({ t, world }) => {
    expect(
      await updateProfileName(t.auth, { headers: world.as.cy, name: "  Cy Young " }),
    ).toMatchObject({
      ok: true,
      data: { name: "Cy Young", email: "cy@example.com" },
    });
  });

  test("refuses empty, long, multi-line or direction-changing names", async ({ t, world }) => {
    for (const name of [
      "",
      "   ",
      "x".repeat(101),
      "Cy\nYoung",
      // C1 control (NEL), line separator, and a bidi override that reverses what follows.
      "Cy\u0085Young",
      "Cy\u2028Young",
      "Support \u202Emoc.live",
    ]) {
      // Sequential on purpose: each step depends on the ones before.
      // oxlint-disable-next-line no-await-in-loop
      expect(await updateProfileName(t.auth, { headers: world.as.cy, name })).toEqual({
        ok: false,
        error: "invalid_input",
      });
    }
  });
});

describe("audit", () => {
  test("records each organization event with its target's publicId", async ({ t, world }) => {
    await switchOrganization(t.auth, {
      headers: world.as.ada,
      organizationPublicId: world.globex.publicId,
    });
    await switchOrganization(t.auth, {
      headers: world.as.ada,
      organizationPublicId: world.acme.publicId,
    });
    const first = await inviteMember(t.auth, {
      headers: world.as.ada,
      organizationPublicId: world.acme.publicId,
      email: "dee@example.com",
      role: "member",
    });
    const second = await inviteMember(t.auth, {
      headers: world.as.ada,
      organizationPublicId: world.acme.publicId,
      email: "eve@example.com",
      role: "member",
    });
    const third = await inviteMember(t.auth, {
      headers: world.as.ada,
      organizationPublicId: world.acme.publicId,
      email: "fay@example.com",
      role: "member",
    });
    if (!first.ok || !second.ok || !third.ok) throw new Error("invite failed");
    const dee = await t.signInAs("dee@example.com");
    await acceptInvitation(t.auth, { headers: dee, invitationPublicId: first.data.publicId });
    const eve = await t.signInAs("eve@example.com");
    await declineInvitation(t.auth, { headers: eve, invitationPublicId: second.data.publicId });
    await cancelInvitation(t.auth, {
      headers: world.as.ada,
      organizationPublicId: world.acme.publicId,
      invitationPublicId: third.data.publicId,
    });
    await changeMemberRole(t.auth, {
      headers: world.as.ada,
      organizationPublicId: world.acme.publicId,
      memberPublicId: world.members.cy.publicId,
      role: "admin",
    });
    await removeMember(t.auth, {
      headers: world.as.ada,
      organizationPublicId: world.acme.publicId,
      memberPublicId: world.members.cy.publicId,
    });
    await updateProfileName(t.auth, { headers: world.as.bob, name: "Robert" });

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
    await inviteMember(t.auth, {
      headers: world.as.cy,
      organizationPublicId: world.acme.publicId,
      email: "dee@example.com",
      role: "member",
    });
    await removeMember(t.auth, {
      headers: world.as.bob,
      organizationPublicId: world.acme.publicId,
      memberPublicId: world.members.ada.publicId,
    });
    expect(await auditActions(t)).toEqual([]);
  });
});
