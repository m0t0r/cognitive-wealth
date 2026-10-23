import { createDatabaseTest } from "@repo/testing/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { migrationsFolder } from "./migrations-folder";
import { auditEvent, user } from "./schema";

const INSUFFICIENT_PRIVILEGE = { cause: { code: "42501" } };

// Recreates the roles from `docker/initdb/01-roles.sh` before migrating, so the guarded revoke in
// the audit migration runs: `app` gets DML on every table the migrations create, minus that revoke.
const test = createDatabaseTest(async (client) => {
  await client.exec(`
    create role app;
    grant usage on schema public to app;
    alter default privileges in schema public grant select, insert, update, delete on tables to app;
    alter default privileges in schema public grant usage, select on sequences to app;
  `);
  await migrate(drizzle({ client }), { migrationsFolder });
}).extend("orm", ({ db }) => drizzle({ client: db }));

describe("audit_event for the app role", () => {
  test("allows insert and select", async ({ orm }) => {
    await orm.execute(sql`set role app`);

    await orm.insert(auditEvent).values({ action: "auth.sign_in", metadata: { method: "otp" } });

    expect(await orm.select({ action: auditEvent.action }).from(auditEvent)).toEqual([
      { action: "auth.sign_in" },
    ]);
  });

  test("refuses update", async ({ orm }) => {
    await orm.insert(auditEvent).values({ action: "auth.sign_in" });
    await orm.execute(sql`set role app`);

    await expect(orm.update(auditEvent).set({ action: "auth.sign_out" })).rejects.toMatchObject(
      INSUFFICIENT_PRIVILEGE,
    );
  });

  test("refuses delete", async ({ orm }) => {
    await orm.insert(auditEvent).values({ action: "auth.sign_in" });
    await orm.execute(sql`set role app`);

    await expect(orm.delete(auditEvent)).rejects.toMatchObject(INSUFFICIENT_PRIVILEGE);
  });

  test("keeps full DML on other tables", async ({ orm }) => {
    const { rows } = await orm.execute(sql`
      select
        has_table_privilege('app', 'audit_event', 'update') as audit_update,
        has_table_privilege('app', 'audit_event', 'delete') as audit_delete,
        has_table_privilege('app', 'user', 'update') as user_update,
        has_table_privilege('app', 'user', 'delete') as user_delete
    `);
    expect(rows).toEqual([
      { audit_update: false, audit_delete: false, user_update: true, user_delete: true },
    ]);
  });

  // Foreign key actions run as the referencing table's owner, so the revoke doesn't block them.
  test("still lets app delete a user, nulling the event's actor", async ({ orm }) => {
    await orm.execute(sql`set role app`);
    const [u] = await orm
      .insert(user)
      .values({ name: "Ada", email: "ada@example.com" })
      .returning();
    await orm.insert(auditEvent).values({ action: "auth.sign_in", actorUserId: u!.id });

    await orm.delete(user).where(eq(user.id, u!.id));

    expect(await orm.select({ actorUserId: auditEvent.actorUserId }).from(auditEvent)).toEqual([
      { actorUserId: null },
    ]);
  });
});
