// Client-safe access control, shared by the server config (Better Auth's organization plugin) and
// the UI (`can()` decides which controls to show; the server still enforces every action).
import { createAccessControl } from "better-auth/plugins/access";

/**
 * Better Auth's default organization statements, minus `team` (teams are off) and `ac` (no
 * dynamic roles). Better Auth checks these names itself, so keep them as they are.
 */
export const statements = {
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
} as const;

export const ac = createAccessControl(statements);

// The same grants as Better Auth's default roles for the statements above.
export const roles = {
  owner: ac.newRole({
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
  }),
  admin: ac.newRole({
    organization: ["update"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
  }),
  member: ac.newRole({ organization: [], member: [], invitation: [] }),
};

export type Role = keyof typeof roles;

export const ROLES = ["owner", "admin", "member"] as const satisfies readonly Role[];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

type Statements = typeof statements;
export type Permission = {
  [R in keyof Statements]: `${R}:${Statements[R][number]}`;
}[keyof Statements];

// Each role's grants as `resource:action` strings, so a lookup can't hit an inherited property.
const GRANTS: Record<Role, ReadonlySet<string>> = {
  owner: grantsOf(roles.owner.statements),
  admin: grantsOf(roles.admin.statements),
  member: grantsOf(roles.member.statements),
};

function grantsOf(granted: Record<string, readonly string[]>): ReadonlySet<string> {
  return new Set(
    Object.entries(granted).flatMap(([resource, actions]) =>
      actions.map((a) => `${resource}:${a}`),
    ),
  );
}

/** Whether `role` grants `permission` (e.g. `"invitation:create"`). Unknown roles grant nothing. */
export function can(role: string | null | undefined, permission: Permission): boolean {
  return isRole(role) && GRANTS[role].has(permission);
}
