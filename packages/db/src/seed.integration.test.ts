import { readFile } from "node:fs/promises";
import { asc, count, eq } from "drizzle-orm";
import { WORLD_FIRM_SLUG, seedDevData } from "./cli/seed-data";
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

  test("creates the documented users, organizations and roles", async ({ orm }) => {
    await seedDevData(orm);

    const rows = await orm
      .select({ email: user.email, slug: organization.slug, role: member.role })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .orderBy(asc(organization.slug), asc(user.email));
    expect(rows).toEqual([
      { email: "owner@cognitive-wealth.test", slug: "globex", role: "owner" },
      { email: "admin@cognitive-wealth.test", slug: "larkspur", role: "admin" },
      { email: "member@cognitive-wealth.test", slug: "larkspur", role: "member" },
      { email: "owner@cognitive-wealth.test", slug: "larkspur", role: "owner" },
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
      { name: "Globex", slug: "globex" },
      { name: "Larkspur Wealth Partners", slug: "larkspur" },
    ]);
  });

  test("names the world file's Firm by its slug", async ({ orm }) => {
    await seedDevData(orm);

    const world: unknown = JSON.parse(
      await readFile(new URL("../../../world/v0.json", import.meta.url), "utf8"),
    );
    const [firm] = await orm
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.slug, WORLD_FIRM_SLUG));
    expect(firm).toBeDefined();
    expect(world).toMatchObject({ crm: { firm: { name: firm!.name } } });
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
