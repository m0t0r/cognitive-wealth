import { ROLES, type Role } from "@repo/auth/access";

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

/** "Ana is now an admin." Whole sentences per role, so each can be translated as one string. */
export const ROLE_CHANGED: Record<Role, (name: string) => string> = {
  owner: (name) => `${name} is now an owner.`,
  admin: (name) => `${name} is now an admin.`,
  member: (name) => `${name} is now a member.`,
};

/** The roles `viewerRole` may hand out: only owners can make someone an owner. */
export function assignableRoles(viewerRole: Role): Role[] {
  return ROLES.filter((role) => role !== "owner" || viewerRole === "owner");
}

/** "You're an admin of Acme." */
export const YOUR_ROLE: Record<Role, (organization: string) => string> = {
  owner: (organization) => `You're an owner of ${organization}.`,
  admin: (organization) => `You're an admin of ${organization}.`,
  member: (organization) => `You're a member of ${organization}.`,
};
