import { BETTER_AUTH_TABLES } from "@repo/db/better-auth-tables";
import * as schema from "@repo/db/schema";
import { getSchema } from "better-auth/db";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { authTest as test, internalIdKeys } from "./testing";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("schema", () => {
  test("passes Better Auth's schema check", async ({ t }) => {
    const context = await t.auth.$context;
    expect(context.explicitSchemaCheck).toBeTypeOf("function");
    await expect(context.explicitSchemaCheck!()).resolves.toBeUndefined();
  });

  // `@repo/db`'s never-rules exempt these tables by name; a Better Auth upgrade or a plugin that
  // adds, drops or renames one fails here rather than slipping past them.
  test("needs exactly BETTER_AUTH_TABLES", async ({ t }) => {
    // Better Auth's Drizzle adapter finds a model's table under its key in `schema`.
    const exports = new Map<string, unknown>(Object.entries(schema));
    const tables = Object.keys(getSchema(t.auth.options)).map((model) => {
      const table = exports.get(model);
      return is(table, PgTable) ? getTableName(table) : `${model} (no table in @repo/db/schema)`;
    });

    expect(tables.toSorted()).toEqual(BETTER_AUTH_TABLES);
  });
});

describe("ids", () => {
  test("Better Auth sees serial IDs as strings and publicIds as UUIDv7s", async ({ t }) => {
    const ada = await t.seedUser({ email: "ada@example.com" });
    const org = await t.seedOrganization({
      name: "Acme",
      slug: "acme",
      members: [{ userId: ada.id, role: "owner" }],
    });
    const headers = await t.signInAs("ada@example.com");

    const session = await t.auth.api.getSession({ headers });
    expect(session?.user.id).toBe(String(ada.id));
    expect(session?.user.publicId).toMatch(UUID);
    expect(session?.session.userId).toBe(String(ada.id));

    const full = await t.auth.api.getFullOrganization({ headers });
    expect(full?.id).toBe(String(org.id));
    expect(full?.publicId).toMatch(UUID);
    expect(full?.members[0]?.id).toBe(String(org.members[0]!.id));
    expect(full?.members[0]?.publicId).toMatch(UUID);
  });

  test("handler responses carry no IDs, tokens or user data", async ({ t }) => {
    await t.seedUser({ email: "ada@example.com" });
    const bodies: unknown[] = [];

    const request = await t.fetchAuth("/sign-in/magic-link", {
      body: { email: "ada@example.com" },
    });
    bodies.push(await request.json());
    const message = await t.waitForEmail({ to: "ada@example.com" });
    const token = new URLSearchParams(
      new URL(/Sign-in link: (\S+)/.exec(message.text)![1]!).hash.slice(1),
    ).get("token")!;
    const verify = await t.fetchAuth(`/magic-link/verify?token=${token}`);
    bodies.push(await verify.json());
    const signOut = await t.fetchAuth("/sign-out", {
      body: {},
      headers: { cookie: t.sessionHeaders(verify).get("cookie")! },
    });
    bodies.push(await signOut.json());

    expect(bodies).toEqual([{ status: true }, { ok: true }, { ok: true }]);
    expect(internalIdKeys(bodies)).toEqual([]);
    expect(JSON.stringify(bodies)).not.toMatch(/token|email|user/i);
  });
});
