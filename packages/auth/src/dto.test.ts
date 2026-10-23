import { internalIdKeys } from "./testing";
import {
  toPublicInvitation,
  toPublicMember,
  toPublicMembership,
  toPublicOrganization,
  toPublicUser,
  toRole,
} from "./dto";

// Rows as Better Auth or a careless `select()` might hand them over: full of internal IDs.
const userRow = {
  id: 1,
  publicId: "0199f0a2-0000-7000-8000-000000000001",
  name: "Ada",
  email: "ada@example.com",
  emailVerified: true,
  image: null,
  userId: "1",
  createdAt: new Date("2026-01-01"),
};
const organizationRow = {
  id: "7",
  publicId: "0199f0a2-0000-7000-8000-000000000007",
  name: "Acme",
  slug: "acme",
  logo: "https://cdn.example/acme.png",
  metadata: '{"plan":"pro"}',
  organizationId: 7,
};

function expectNoInternalIds(dto: unknown) {
  expect(internalIdKeys(dto)).toEqual([]);
}

describe("internalIdKeys", () => {
  it("finds id and …Id keys at any depth, but not publicIds", () => {
    expect(
      internalIdKeys({
        id: 1,
        publicId: "p",
        a: [{ userId: 2, memberPublicId: "m" }],
        b: { organizationId: 3 },
      }),
    ).toEqual(["id", "userId", "organizationId"]);
  });
});

describe("DTO mappers", () => {
  it("maps a user", () => {
    const dto = toPublicUser(userRow);
    expect(dto).toEqual({
      publicId: userRow.publicId,
      name: "Ada",
      email: "ada@example.com",
      image: null,
    });
    expectNoInternalIds(dto);
  });

  it("maps an organization", () => {
    const dto = toPublicOrganization(organizationRow);
    expect(dto).toEqual({
      publicId: organizationRow.publicId,
      name: "Acme",
      slug: "acme",
      logo: "https://cdn.example/acme.png",
    });
    expectNoInternalIds(dto);
  });

  it("maps a member", () => {
    const dto = toPublicMember({
      id: 3,
      publicId: "0199f0a2-0000-7000-8000-000000000003",
      organizationId: 7,
      userId: 1,
      role: "admin",
      createdAt: new Date("2026-02-01"),
      user: userRow,
    } as Parameters<typeof toPublicMember>[0]);
    expect(dto).toEqual({
      publicId: "0199f0a2-0000-7000-8000-000000000003",
      role: "admin",
      user: toPublicUser(userRow),
      createdAt: new Date("2026-02-01"),
    });
    expectNoInternalIds(dto);
  });

  it("maps an invitation", () => {
    const dto = toPublicInvitation({
      id: 9,
      publicId: "0199f0a2-0000-7000-8000-000000000009",
      organizationId: 7,
      inviterId: 1,
      teamId: null,
      email: "grace@example.com",
      role: "member",
      status: "pending",
      expiresAt: new Date("2026-03-01"),
      organization: organizationRow,
      inviter: { ...userRow, name: "Ada" },
    } as Parameters<typeof toPublicInvitation>[0]);
    expect(dto).toEqual({
      publicId: "0199f0a2-0000-7000-8000-000000000009",
      email: "grace@example.com",
      role: "member",
      status: "pending",
      expiresAt: new Date("2026-03-01"),
      organization: toPublicOrganization(organizationRow),
      inviter: { name: "Ada" },
    });
    expectNoInternalIds(dto);
  });

  it("maps a membership", () => {
    const dto = toPublicMembership({
      role: "owner",
      organization: organizationRow,
      isActive: true,
      memberId: 3,
    } as Parameters<typeof toPublicMembership>[0]);
    expect(dto).toEqual({
      organization: toPublicOrganization(organizationRow),
      role: "owner",
      isActive: true,
    });
    expectNoInternalIds(dto);
  });

  it("reads unknown or combined roles as member", () => {
    expect(toRole("owner")).toBe("owner");
    expect(toRole("owner,admin")).toBe("member");
    expect(toRole("superuser")).toBe("member");
    expect(toRole(null)).toBe("member");
  });

  it("reads an unknown invitation status as canceled", () => {
    const dto = toPublicInvitation({
      publicId: "p",
      email: "e",
      role: null,
      status: "weird",
      expiresAt: new Date(0),
      organization: organizationRow,
      inviter: { name: "" },
    });
    expect(dto.status).toBe("canceled");
    expect(dto.role).toBe("member");
  });
});
