import {
  cancelInvitation,
  changeMemberRole,
  inviteMember,
  removeMember,
  requireTenant,
  type PublicInvitation,
  type PublicMember,
} from "@repo/auth";
import { refresh } from "next/cache";
import { headers } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAuth } from "@/lib/auth/server";
import {
  cancelInvitationAction,
  changeRoleAction,
  inviteMemberAction,
  removeMemberAction,
  resendInvitationAction,
} from "./actions";

// The boundary: `@repo/auth` owns sessions, permissions and the rules (integration tests). These
// actions only parse input, pass the request's headers on and map the result.
vi.mock("@repo/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/auth")>()),
  cancelInvitation: vi.fn(),
  changeMemberRole: vi.fn(),
  inviteMember: vi.fn(),
  removeMember: vi.fn(),
  requireTenant: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => ({ getAuth: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

const AUTH = { stand: "in" };
const HEADERS = new Headers({ cookie: "cw.session_token=x" });
const MEMBER = "0192f0c4-0000-7000-8000-000000000001";
const INVITATION = "0192f0c4-0000-7000-8000-000000000002";
// The workspace the page showed; every action passes it on for `@repo/auth` to check.
const ORG = "0192f0c4-0000-7000-8000-000000000004";
// What the calls return on success; the actions must drop it (no DTOs to the client).
const MEMBER_DTO: PublicMember = {
  publicId: MEMBER,
  role: "admin",
  user: {
    publicId: "0192f0c4-0000-7000-8000-000000000003",
    name: "Mia",
    email: "mia@example.com",
    image: null,
  },
  createdAt: new Date("2026-10-01"),
};
const INVITATION_DTO: PublicInvitation = {
  publicId: INVITATION,
  email: "new@example.com",
  role: "member",
  status: "pending",
  expiresAt: new Date("2026-10-29"),
  organization: {
    publicId: "0192f0c4-0000-7000-8000-000000000004",
    name: "Acme",
    slug: "acme",
    logo: null,
  },
  inviter: { name: "Olivia" },
};

beforeEach(() => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  vi.mocked(getAuth).mockReturnValue(AUTH as unknown as ReturnType<typeof getAuth>);
  vi.mocked(headers).mockResolvedValue(HEADERS);
  vi.mocked(inviteMember).mockResolvedValue({ ok: true, data: INVITATION_DTO });
  vi.mocked(changeMemberRole).mockResolvedValue({ ok: true, data: MEMBER_DTO });
  vi.mocked(removeMember).mockResolvedValue({ ok: true, data: null });
  vi.mocked(cancelInvitation).mockResolvedValue({ ok: true, data: null });
});

function inviteForm(fields: Record<string, string>) {
  const formData = new FormData();
  formData.set("organizationPublicId", ORG);
  for (const [name, value] of Object.entries(fields)) formData.set(name, value);
  return formData;
}

describe("inviteMemberAction", () => {
  it("normalizes the email and invites with the request's headers, then refreshes", async () => {
    expect(
      await inviteMemberAction(inviteForm({ email: "  New@Example.COM ", role: "admin" })),
    ).toEqual({ ok: true });
    expect(inviteMember).toHaveBeenCalledExactlyOnceWith(AUTH, HEADERS, {
      organizationPublicId: ORG,
      email: "new@example.com",
      role: "admin",
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it.for([
    ["a malformed email", { email: "not-an-email", role: "member" }],
    ["a missing email", { role: "member" }],
    ["an overlong email", { email: `${"a".repeat(250)}@example.com`, role: "member" }],
    ["an unknown role", { email: "new@example.com", role: "superuser" }],
    ["a missing role", { email: "new@example.com" }],
    [
      "a malformed workspace",
      { organizationPublicId: "1", email: "new@example.com", role: "member" },
    ],
  ] as const)("refuses %s as invalid_input without calling auth", async ([, fields]) => {
    expect(await inviteMemberAction(inviteForm(fields))).toEqual({
      ok: false,
      error: "invalid_input",
    });
    expect(inviteMember).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("ignores a file where the email should be", async () => {
    const formData = inviteForm({ role: "member" });
    formData.set("email", new Blob(["new@example.com"]), "email.txt");
    expect(await inviteMemberAction(formData)).toEqual({ ok: false, error: "invalid_input" });
  });
});

describe("changeRoleAction", () => {
  it("changes the role, then refreshes", async () => {
    expect(
      await changeRoleAction({ organizationPublicId: ORG, memberPublicId: MEMBER, role: "member" }),
    ).toEqual({
      ok: true,
    });
    expect(changeMemberRole).toHaveBeenCalledExactlyOnceWith(AUTH, HEADERS, {
      organizationPublicId: ORG,
      memberPublicId: MEMBER,
      role: "member",
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it.for<[string, { organizationPublicId: string; memberPublicId: string; role: string }]>([
    ["a malformed publicId", { organizationPublicId: ORG, memberPublicId: "1", role: "admin" }],
    ["an unknown role", { organizationPublicId: ORG, memberPublicId: MEMBER, role: "superuser" }],
    ["a malformed workspace", { organizationPublicId: "", memberPublicId: MEMBER, role: "admin" }],
  ])("refuses %s as invalid_input", async ([, input]) => {
    expect(await changeRoleAction(input)).toEqual({ ok: false, error: "invalid_input" });
    expect(changeMemberRole).not.toHaveBeenCalled();
  });
});

describe.for([
  [
    "removeMemberAction",
    () => removeMemberAction({ organizationPublicId: ORG, memberPublicId: "not-a-uuid" }),
  ],
  [
    "cancelInvitationAction",
    () => cancelInvitationAction({ organizationPublicId: ORG, invitationPublicId: "not-a-uuid" }),
  ],
] as const)("%s", ([, refuse]) => {
  it("answers a malformed publicId as not_found, like an unknown one", async () => {
    expect(await refuse()).toEqual({ ok: false, error: "not_found" });
    expect(removeMember).not.toHaveBeenCalled();
    expect(cancelInvitation).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("removeMemberAction and cancelInvitationAction", () => {
  it("remove the member or invitation with the request's headers, then refresh", async () => {
    expect(await removeMemberAction({ organizationPublicId: ORG, memberPublicId: MEMBER })).toEqual(
      { ok: true },
    );
    expect(removeMember).toHaveBeenCalledExactlyOnceWith(AUTH, HEADERS, {
      organizationPublicId: ORG,
      memberPublicId: MEMBER,
    });
    expect(
      await cancelInvitationAction({ organizationPublicId: ORG, invitationPublicId: INVITATION }),
    ).toEqual({ ok: true });
    expect(cancelInvitation).toHaveBeenCalledExactlyOnceWith(AUTH, HEADERS, {
      organizationPublicId: ORG,
      invitationPublicId: INVITATION,
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

describe("error mapping", () => {
  it.for(["forbidden", "reauth_required", "last_owner", "not_found", "rate_limited"] as const)(
    "passes %s on without refreshing or leaking anything else",
    async (error) => {
      vi.mocked(removeMember).mockResolvedValue({ ok: false, error });
      vi.mocked(changeMemberRole).mockResolvedValue({ ok: false, error });
      vi.mocked(inviteMember).mockResolvedValue({ ok: false, error });
      vi.mocked(cancelInvitation).mockResolvedValue({ ok: false, error });

      const results = await Promise.all([
        removeMemberAction({ organizationPublicId: ORG, memberPublicId: MEMBER }),
        changeRoleAction({ organizationPublicId: ORG, memberPublicId: MEMBER, role: "admin" }),
        inviteMemberAction(inviteForm({ email: "new@example.com", role: "member" })),
        cancelInvitationAction({ organizationPublicId: ORG, invitationPublicId: INVITATION }),
      ]);
      expect(results).toEqual(Array.from({ length: 4 }, () => ({ ok: false, error })));
      expect(refresh).not.toHaveBeenCalled();
    },
  );
});

describe("resendInvitationAction", () => {
  it("invites the same address and role again, then refreshes", async () => {
    expect(
      await resendInvitationAction({
        organizationPublicId: ORG,
        email: "New@Example.com",
        role: "admin",
      }),
    ).toEqual({ ok: true });
    expect(inviteMember).toHaveBeenCalledExactlyOnceWith(AUTH, HEADERS, {
      organizationPublicId: ORG,
      email: "new@example.com",
      role: "admin",
    });
    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe("tenant_changed", () => {
  it("names the workspace the session is in now, so the page can say so", async () => {
    vi.mocked(removeMember).mockResolvedValue({ ok: false, error: "tenant_changed" });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    vi.mocked(requireTenant).mockResolvedValue({
      ok: true,
      data: { tenant: { organization: { name: "Globex" } } },
    } as unknown as Awaited<ReturnType<typeof requireTenant>>);

    expect(await removeMemberAction({ organizationPublicId: ORG, memberPublicId: MEMBER })).toEqual(
      { ok: false, error: "tenant_changed", workspace: "Globex" },
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("leaves the name out when the session has no workspace any more", async () => {
    vi.mocked(cancelInvitation).mockResolvedValue({ ok: false, error: "tenant_changed" });
    vi.mocked(requireTenant).mockResolvedValue({ ok: false, error: "no_tenant" });
    expect(
      await cancelInvitationAction({ organizationPublicId: ORG, invitationPublicId: INVITATION }),
    ).toEqual({ ok: false, error: "tenant_changed" });
  });
});
