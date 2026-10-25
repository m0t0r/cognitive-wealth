import { sql } from "drizzle-orm";
import { test } from "./testing";
import { user } from "./schema";

const INSUFFICIENT_PRIVILEGE = { cause: { code: "42501" } };

describe("the real-Postgres test database", () => {
  test("signs app in with its password, and app can't change the schema", async ({ orm }) => {
    expect([...(await orm.execute(sql`select current_user as role`))]).toEqual([{ role: "app" }]);

    await expect(orm.execute(sql`create table scratch (id int)`)).rejects.toMatchObject(
      INSUFFICIENT_PRIVILEGE,
    );
  });

  test("lets migrator change the schema", async ({ migratorOrm }) => {
    await migratorOrm.execute(sql`create table scratch (id int)`);

    const owner = sql`select tableowner as owner from pg_tables where tablename = 'scratch'`;
    expect([...(await migratorOrm.execute(owner))]).toEqual([{ owner: "migrator" }]);
  });

  test("shows one connection's committed row to another", async ({ connect }) => {
    const first = connect("app");
    const second = connect("app");
    // Two pools, so two server processes, not one connection reused.
    const backend = sql`select pg_backend_pid() as pid`;
    const [firstBackend] = await first.execute(backend);
    const [secondBackend] = await second.execute(backend);
    expect(firstBackend?.pid).not.toBe(secondBackend?.pid);

    await first.insert(user).values({ name: "Ada", email: "ada@example.com" });

    expect(await second.select({ email: user.email }).from(user)).toEqual([
      { email: "ada@example.com" },
    ]);
  });
});

// Both insert the same unique email at once: each passes only on its own database.
describe.concurrent("each test's own database", () => {
  test.for(["first", "second"])("keeps the %s test's rows to itself", async (_name, { orm }) => {
    await orm.insert(user).values({ name: "Ada", email: "ada@example.com" });

    expect(await orm.select({ email: user.email }).from(user)).toEqual([
      { email: "ada@example.com" },
    ]);
  });
});
