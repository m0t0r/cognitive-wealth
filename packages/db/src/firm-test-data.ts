// Test data for the Firm-scoped tables, shared by the integration tests that need every one of them.
// Only tests import it.
import { eq } from "drizzle-orm";
import type { Database } from "./index";
import {
  accountRole,
  custodialAccount,
  custodialPosition,
  custodialTransaction,
  custodianDelivery,
  household,
  householdMember,
  organization,
  person,
  security,
  securityPrice,
  worldSeed,
} from "./schema";

/**
 * Every table with a `firm_id` column. `firm-isolation.integration.test.ts`'s catalog test fails
 * when one is missing.
 */
export const FIRM_SCOPED_TABLES = [
  "account_role",
  "custodial_account",
  "custodial_account_history",
  "custodial_position",
  "custodial_transaction",
  "custodian_delivery",
  "household",
  "household_member",
  "person",
  "security",
  "security_history",
  "security_price",
  "world_seed",
];

/** One row in every Firm-scoped table for the Firm `slug`, written as the tables' owner. */
export async function seedFirm(owner: Database, slug: string): Promise<number> {
  const [firm] = await owner.insert(organization).values({ name: slug, slug }).returning();
  const firmId = firm!.id;
  const [home] = await owner
    .insert(household)
    .values({ firmId, name: `${slug} Household`, relationshipStatus: "client" })
    .returning();
  const [someone] = await owner
    .insert(person)
    .values({ firmId, firstName: "Ada", lastName: slug, bornOn: "1980-01-01" })
    .returning();
  await owner
    .insert(householdMember)
    .values({ firmId, householdId: home!.id, personId: someone!.id, role: "primary" });
  const [account] = await owner
    .insert(custodialAccount)
    .values({ firmId, accountNumber: "CW-000001" })
    .returning();
  await owner.insert(accountRole).values({
    firmId,
    personId: someone!.id,
    accountId: account!.id,
    role: "owner",
    startsOn: "2026-01-01",
  });
  await owner.insert(worldSeed).values({ firmId, worldHash: "0".repeat(64) });
  const [delivery] = await owner
    .insert(custodianDelivery)
    .values({ firmId, asOfDate: "2026-03-02", manifestSha256: "0".repeat(64) })
    .returning();
  const [fund] = await owner
    .insert(security)
    .values({ firmId, identifier: "VTI", name: "Total Market", kind: "fund" })
    .returning();
  // Changed as the tables' owner, so each history table gets a row, `migrator`'s (ADR 0025).
  await owner
    .update(custodialAccount)
    .set({ registrationType: "individual" })
    .where(eq(custodialAccount.id, account!.id));
  await owner.update(security).set({ name: "Total Stock Market" }).where(eq(security.id, fund!.id));
  const day = { firmId, deliveryId: delivery!.id, securityId: fund!.id };
  await owner.insert(custodialTransaction).values({
    ...day,
    transactionId: "T-1",
    accountId: account!.id,
    kind: "buy",
    shares: "1",
    amount: "-100.00",
    tradeDate: "2026-03-02",
    settlementDate: "2026-03-03",
    postingDate: "2026-03-02",
  });
  await owner.insert(custodialPosition).values({
    ...day,
    asOfDate: "2026-03-02",
    accountId: account!.id,
    shares: "1",
  });
  await owner.insert(securityPrice).values({ ...day, asOfDate: "2026-03-02", price: "100" });
  return firmId;
}
