import { test as dbTest } from "@repo/db/testing";
import { describe, expect } from "vitest";
import { createTestAuth, internalIdKeys } from "./testing";

const test = dbTest.extend("t", ({ orm }) => createTestAuth({ orm }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("schema", () => {
  test("passes Better Auth's schema check", async ({ t }) => {
    const context = await t.auth.$context;
    expect(context.explicitSchemaCheck).toBeTypeOf("function");
    await expect(context.explicitSchemaCheck!()).resolves.toBeUndefined();
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
    const message = await t.waitForEmail("ada@example.com");
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
