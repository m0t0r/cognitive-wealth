import { can, ROLES, type Role } from "@repo/auth/access";

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

/** "Ana invited you as an admin." */
export const INVITED_YOU_AS: Record<Role, (inviter: string) => string> = {
  owner: (inviter) => `${inviter} invited you as an owner.`,
  admin: (inviter) => `${inviter} invited you as an admin.`,
  member: (inviter) => `${inviter} invited you as a member.`,
};

/** "Make Ana an owner?", the title of the dialog that confirms an owner's role change. */
export const MAKE_ROLE_TITLE: Record<Role, (name: string) => string> = {
  owner: (name) => `Make ${name} an owner?`,
  admin: (name) => `Make ${name} an admin?`,
  member: (name) => `Make ${name} a member?`,
};

/** The confirm button for a role change. */
export const MAKE_ROLE_LABEL: Record<Role, string> = {
  owner: "Make owner",
  admin: "Make admin",
  member: "Make member",
};

/**
 * What `viewerRole` may do to a member whose role is `memberRole`, for the UI (the server
 * enforces the same rules): only owners act on owners.
 */
export function memberActionsFor(viewerRole: Role, memberRole: Role) {
  const protectedOwner = memberRole === "owner" && viewerRole !== "owner";
  return {
    changeRole: can(viewerRole, "member:update") && !protectedOwner,
    remove: can(viewerRole, "member:delete") && !protectedOwner,
  };
}

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
