import { asc, count, eq } from "drizzle-orm";
import { describe, expect } from "vitest";
import { assertSeedTarget, seedDevData } from "./cli/seed-data";
import type { Database } from "./index";
import { member, organization, user } from "./schema";
import { test } from "./testing";

async function rowCounts(db: Database) {
  const [[users], [organizations], [memberships]] = await Promise.all([
    db.select({ n: count() }).from(user),
    db.select({ n: count() }).from(organization),
    db.select({ n: count() }).from(member),
  ]);
  return { users: users!.n, organizations: organizations!.n, memberships: memberships!.n };
}

describe("seedDevData", () => {
  test("is idempotent", async ({ orm }) => {
    expect(await seedDevData(orm)).toEqual({
      added: { users: 3, organizations: 2, memberships: 4 },
    });
    const first = await rowCounts(orm);

    expect(await seedDevData(orm)).toEqual({
      added: { users: 0, organizations: 0, memberships: 0 },
    });
    expect(await rowCounts(orm)).toEqual(first);
    expect(first).toEqual({ users: 3, organizations: 2, memberships: 4 });
  });

  test("creates the ADR's users, organizations and roles", async ({ orm }) => {
    await seedDevData(orm);

    const rows = await orm
      .select({ email: user.email, slug: organization.slug, role: member.role })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .orderBy(asc(organization.slug), asc(user.email));
    expect(rows).toEqual([
      { email: "admin@cognitive-wealth.test", slug: "acme", role: "admin" },
      { email: "member@cognitive-wealth.test", slug: "acme", role: "member" },
      { email: "owner@cognitive-wealth.test", slug: "acme", role: "owner" },
      { email: "owner@cognitive-wealth.test", slug: "globex", role: "owner" },
    ]);
    expect(
      await orm
        .select({ email: user.email, name: user.name, emailVerified: user.emailVerified })
        .from(user)
        .orderBy(asc(user.email)),
    ).toEqual([
      { email: "admin@cognitive-wealth.test", name: "Adam Admin", emailVerified: true },
      { email: "member@cognitive-wealth.test", name: "Mia Member", emailVerified: true },
      { email: "owner@cognitive-wealth.test", name: "Olivia Owner", emailVerified: true },
    ]);
    expect(
      await orm
        .select({ name: organization.name, slug: organization.slug })
        .from(organization)
        .orderBy(asc(organization.slug)),
    ).toEqual([
      { name: "Acme", slug: "acme" },
      { name: "Globex", slug: "globex" },
    ]);
  });

  test("adds what's missing and leaves existing rows alone", async ({ orm }) => {
    await orm
      .insert(user)
      .values({ email: "owner@cognitive-wealth.test", name: "Renamed", emailVerified: true });

    expect(await seedDevData(orm)).toEqual({
      added: { users: 2, organizations: 2, memberships: 4 },
    });
    expect(
      await orm
        .select({ name: user.name })
        .from(user)
        .where(eq(user.email, "owner@cognitive-wealth.test")),
    ).toEqual([{ name: "Renamed" }]);
  });
});

describe("assertSeedTarget", () => {
  test.for([
    "postgres://app@localhost:5432/cognitive_wealth",
    "postgres://app@LOCALHOST/cognitive_wealth",
    "postgresql://app@127.0.0.1:5432/cognitive_wealth",
    "postgres://app@[::1]:5432/cognitive_wealth",
    "postgres://app@db.localhost/cognitive_wealth",
    "postgres://app@localhost./cognitive_wealth",
  ])("allows %s", (url) => {
    expect(() => assertSeedTarget(url, "development")).not.toThrow();
    expect(() => assertSeedTarget(url, undefined)).not.toThrow();
  });

  test.for([
    "postgres://app@db.example.com/cognitive_wealth",
    "postgres://app@10.0.0.5:5432/cognitive_wealth",
    "postgres://app@127.0.0.2/cognitive_wealth",
    "postgres://app@localhost.example.com/cognitive_wealth",
    "postgres://app@localhost,db.example.com/cognitive_wealth",
    "postgres://app@[2001:db8::1]/cognitive_wealth",
  ])("refuses the non-local host in %s", (url) => {
    expect(() => assertSeedTarget(url, "development")).toThrow(/isn't local/);
  });

  // postgres.js decodes `%2C` to a comma and tries each host in the list.
  test("refuses an encoded host list that ends in .localhost", () => {
    expect(() =>
      assertSeedTarget("postgres://app@db.example.com%2C.localhost/cw", "development"),
    ).toThrow(/isn't local/);
  });

  test("refuses a missing or invalid DATABASE_URL", () => {
    expect(() => assertSeedTarget(undefined, "development")).toThrow(/DATABASE_URL is not set/);
    expect(() => assertSeedTarget("not a url", "development")).toThrow(/not a valid URL/);
  });

  test("refuses NODE_ENV=production even on localhost", () => {
    expect(() =>
      assertSeedTarget("postgres://app@localhost:5432/cognitive_wealth", "production"),
    ).toThrow(/NODE_ENV is production/);
  });
});
