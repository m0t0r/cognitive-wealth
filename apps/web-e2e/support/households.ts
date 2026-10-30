import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Role } from "@repo/auth/access";
import type { Database } from "@repo/db";
import { withFirm } from "@repo/db/firm";
import {
  accountRole,
  custodialAccount,
  household,
  householdMember,
  member,
  organization,
  person,
} from "@repo/db/schema";
import { WORLD_FIRM_SLUG } from "@repo/db/seed-data";
import { endAccountRole, endHouseholdMembership } from "@repo/households";
import { seedDevWorld } from "@repo/households/seed";
import { and, eq } from "drizzle-orm";
import { ingestDelivery, localFeedSource } from "@repo/portfolio";
import type { SeededUser } from "./seed";

const REPO = join(import.meta.dirname, "../../..");
// The Custodian's two example Deliveries for world file v0, 2 and 6 March 2026.
const FEED = localFeedSource(join(REPO, "apps/custodian/fixtures/feed"));
const AS_OFS = ["2026-03-02", "2026-03-06"];

type SeedIngestedWorldArgs = {
  /** Joins the world's Firm, Larkspur, or the second dev Firm, Globex. */
  advisor: { user: SeededUser; firm: "larkspur" | "globex"; role: Role };
};

/**
 * What `pnpm db:seed` and `pnpm custodian:ingest` give: world file v0's Household in Larkspur,
 * with both example Deliveries ingested, plus `advisor` as a member of one Firm. Returns the
 * Household's `publicId`.
 */
export async function seedIngestedWorld(
  db: Database,
  { advisor }: SeedIngestedWorldArgs,
): Promise<string> {
  await seedDevWorld(db, JSON.parse(readFileSync(join(REPO, "world/v0.json"), "utf8")));
  const firms = await db
    .select({ id: organization.id, slug: organization.slug })
    .from(organization);
  const firmId = (slug: string) => {
    const firm = firms.find((row) => row.slug === slug);
    if (!firm) throw new Error(`The seed made no Firm with the slug '${slug}'`);
    return firm.id;
  };
  await db.insert(member).values({
    organizationId: firmId(advisor.firm),
    userId: advisor.user.id,
    role: advisor.role,
  });
  for (const asOf of AS_OFS) {
    // oxlint-disable-next-line no-await-in-loop -- in order: each Delivery builds on the one before
    const result = await ingestDelivery(db, { firmId: firmId("larkspur"), asOf, source: FEED });
    if (result.status !== "ingested") throw new Error(`Ingesting ${asOf} gave ${result.status}`);
  }
  // World file v0 has one Household, in Larkspur.
  const households = await withFirm(db, {
    firmId: firmId("larkspur"),
    query: (tx) => tx.select({ publicId: household.publicId }).from(household),
  });
  const [reyes, ...others] = households;
  if (!reyes || others.length > 0) {
    throw new Error(`Expected 1 seeded Household, not ${households.length}`);
  }
  return reyes.publicId;
}

/**
 * After `seedIngestedWorld`, Jordan Reyes left the Household, and stopped being the Beneficiary on
 * Dana's IRA, the day before the latest As-of date. Both go through the domain functions, so this
 * works as `app` too (`cw verify start --seed`). Jordan stays a joint owner of CW-000001.
 */
export async function seedJordanLeftReyes(db: Database): Promise<void> {
  const [larkspur] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, WORLD_FIRM_SLUG));
  if (!larkspur) throw new Error(`Seed the world first: no Firm '${WORLD_FIRM_SLUG}'`);
  const firmId = larkspur.id;
  const [ids] = await withFirm(db, {
    firmId,
    query: (tx) =>
      tx
        .select({
          householdPublicId: household.publicId,
          personPublicId: person.publicId,
          rolePublicId: accountRole.publicId,
        })
        .from(accountRole)
        .innerJoin(person, eq(person.id, accountRole.personId))
        .innerJoin(householdMember, eq(householdMember.personId, person.id))
        .innerJoin(household, eq(household.id, householdMember.householdId))
        .where(and(eq(person.seedKey, "jordan-reyes"), eq(accountRole.role, "beneficiary"))),
  });
  if (!ids) throw new Error("Seed the world first: no Beneficiary role of 'jordan-reyes'");
  const actor = { system: "seed" };
  const endsOn = "2026-03-05";
  const role = await endAccountRole(db, { firmId, actor, publicId: ids.rolePublicId, endsOn });
  const membership = await endHouseholdMembership(db, {
    firmId,
    actor,
    householdPublicId: ids.householdPublicId,
    personPublicId: ids.personPublicId,
    endsOn,
  });
  if (role.status !== "ended" || membership.status !== "ended") {
    throw new Error(`Ending gave ${role.status} and ${membership.status}`);
  }
}

/**
 * After `seedIngestedWorld`, a second Larkspur Household, which the world file doesn't have: Jordan
 * Reyes's mother Grace, owning a Traditional IRA (CW-000003) that names Jordan as its Beneficiary,
 * so the Reyes overview has a Named-on Account to show. Returns her Household's `publicId`.
 */
export async function seedHouseholdOfGrace(db: Database): Promise<string> {
  // The world file's People are all Larkspur's. Written through `withFirm`, as the app writes
  // them, so this works as `app` too (`cw verify start --seed`), under row-level
  // security (ADR 0020).
  const [larkspur] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, WORLD_FIRM_SLUG));
  if (!larkspur) throw new Error(`Seed the world first: no Firm '${WORLD_FIRM_SLUG}'`);
  const firmId = larkspur.id;

  return withFirm(db, {
    firmId,
    query: async (tx) => {
      const [jordan] = await tx
        .select({ id: person.id })
        .from(person)
        .where(eq(person.seedKey, "jordan-reyes"));
      if (!jordan) throw new Error("Seed the world first: no Person 'jordan-reyes'");

      const [hers] = await tx
        .insert(household)
        .values({ firmId, name: "The Grace Reyes Household", relationshipStatus: "client" })
        .returning();
      const [grace] = await tx
        .insert(person)
        .values({ firmId, firstName: "Grace", lastName: "Reyes", bornOn: "1952-01-20" })
        .returning();
      await tx.insert(householdMember).values({
        firmId,
        householdId: hers!.id,
        personId: grace!.id,
        role: "primary",
        startsOn: "2020-01-02",
      });
      const [ira] = await tx
        .insert(custodialAccount)
        .values({ firmId, accountNumber: "CW-000003", registrationType: "traditional_ira" })
        .returning();
      await tx.insert(accountRole).values([
        { firmId, personId: grace!.id, accountId: ira!.id, role: "owner", startsOn: "2020-01-02" },
        {
          firmId,
          personId: jordan.id,
          accountId: ira!.id,
          role: "beneficiary",
          startsOn: "2020-01-02",
        },
      ]);
      return hers!.publicId;
    },
  });
}
