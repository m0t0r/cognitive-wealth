import { can, isRole, type Permission } from "./access";

const PERMISSIONS: Permission[] = [
  "organization:update",
  "organization:delete",
  "member:create",
  "member:update",
  "member:delete",
  "invitation:create",
  "invitation:cancel",
];

const granted = (role: string) => PERMISSIONS.filter((permission) => can(role, permission));

describe("can", () => {
  it("matches Better Auth's default organization roles", () => {
    expect(granted("owner")).toEqual(PERMISSIONS);
    expect(granted("admin")).toEqual(PERMISSIONS.filter((p) => p !== "organization:delete"));
    expect(granted("member")).toEqual([]);
  });

  it("grants nothing to unknown or missing roles", () => {
    for (const role of ["superuser", "owner,admin", "", "Owner", "__proto__", "constructor"]) {
      expect(granted(role)).toEqual([]);
    }
    expect(can(null, "member:delete")).toBe(false);
    expect(can(undefined, "member:delete")).toBe(false);
  });

  it("refuses permissions that don't exist", () => {
    for (const permission of ["team:create", "member:toString", "__proto__", "member"]) {
      // Deliberately outside the type, as untyped callers could pass.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      expect(can("owner", permission as Permission)).toBe(false);
    }
  });
});

describe("isRole", () => {
  it("accepts only the three roles", () => {
    expect(["owner", "admin", "member"].every(isRole)).toBe(true);
    expect(isRole("guest")).toBe(false);
    expect(isRole(1)).toBe(false);
  });
});
