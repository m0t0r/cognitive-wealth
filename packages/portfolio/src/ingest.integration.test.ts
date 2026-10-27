import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "@repo/db";
import { deactivateOrganization, reactivateOrganization } from "@repo/db/cli/organizations";
import { withFirm } from "@repo/db/firm";
import {
  custodialAccountHistory,
  custodianDelivery,
  organization,
  securityHistory,
} from "@repo/db/schema";
import { WORLD_FIRM_SLUG } from "@repo/db/seed-data";
import { test } from "@repo/db/testing";
import { seedDevWorld } from "@repo/households/seed";
import { eq } from "drizzle-orm";
import { type FeedSource, localFeedSource } from "./feed-source";
import { ingestDelivery } from "./ingest";
import { editedFeedSource, feedRows, rewrittenDelivery, textOf } from "./test-support";

// The two example Deliveries the custodian's writer writes for world file v0 (2 and 6 March); its
// integration tests keep them equal to what `feed:write` writes.
const FEED = localFeedSource(join(import.meta.dirname, "../../../apps/custodian/fixtures/feed"));
const WORLD = new URL("../../../world/v0.json", import.meta.url);
const MONDAY = "2026-03-02";
const FRIDAY = "2026-03-06";
// docs/learn/03-custodian-feed-and-ingestion.md, Part 5, quotes it.
const MONDAY_MANIFEST_SHA256 = "77f896ad0c060514b71c25e32efa41ea3b5f65c9d1a7cc2140f96b1f802a0ab1";

/** The database `pnpm db:seed` gives: world file v0's Households and Accounts in its Firm. */
async function seededFirm(db: Database, { slug = WORLD_FIRM_SLUG }: { slug?: string } = {}) {
  await seedDevWorld(db, JSON.parse(readFileSync(WORLD, "utf8")));
  const [firm] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, slug));
  return firm!.id;
}

const ingest = (
  db: Database,
  { firmId, asOf, source = FEED }: { firmId: number; asOf: string; source?: FeedSource },
) => ingestDelivery(db, { firmId, asOf, source });

/** Monday's `file` with `from` replaced by `to`, which must be in it. */
async function mondaysWith({ file, from, to }: { file: string; from: string; to: string }) {
  const text = await textOf({ source: FEED, key: `${MONDAY}/${file}` });
  if (!text.includes(from)) throw new Error(`${file} has no ${from}`);
  return text.replace(from, to);
}

describe("ingestDelivery", () => {
  test("loads 2 March's Delivery for world file v0", async ({ orm, migratorOrm }) => {
    const firmId = await seededFirm(orm);

    const result = await ingest(orm, { firmId, asOf: MONDAY });

    expect(result).toEqual({
      status: "ingested",
      asOf: MONDAY,
      manifestSha256: MONDAY_MANIFEST_SHA256,
      written: { securities: 19, accounts: 2, transactions: 4, positions: 5, prices: 3 },
    });
    const rows = await feedRows(migratorOrm);
    expect(rows.deliveries).toEqual([
      expect.objectContaining({ asOfDate: MONDAY, manifestSha256: MONDAY_MANIFEST_SHA256 }),
    ]);
    expect(
      rows.accounts.map(({ accountNumber, registrationType, openedOn }) => ({
        accountNumber,
        registrationType,
        openedOn,
      })),
    ).toEqual([
      { accountNumber: "CW-000001", registrationType: "joint", openedOn: "2026-02-26" },
      { accountNumber: "CW-000002", registrationType: "traditional_ira", openedOn: "2026-03-02" },
    ]);
    // The Security master sends the custodian's whole Security catalog, held or not.
    expect(rows.securities.map(({ identifier, kind }) => `${identifier} ${kind}`)).toEqual([
      "BRWP stock",
      "CPLN stock",
      "FNMB stock",
      "HVPW stock",
      "LKAG fund",
      "LKBF fund",
      "LKBL fund",
      "LKCB fund",
      "LKDF fund",
      "LKGF fund",
      "LKLT fund",
      "LKSC fund",
      "LKSF fund",
      "LKST fund",
      "LKSV fund",
      "LKVF fund",
      "QLNC stock",
      "SWEEP cash_sweep",
      "TMRE stock",
    ]);
    expect(rows.prices.map(({ asOfDate, price }) => `${asOfDate} ${price}`)).toEqual([
      "2026-03-02 10.00",
      "2026-03-02 150.25",
      "2026-03-02 1.00",
    ]);
  });

  // `orm` signs in as `app`, as `pnpm custodian:ingest` does, so the policies hold every write.
  test("writes the Delivery under its Firm's row-level security (ADR 0020)", async ({ orm }) => {
    const larkspur = await seededFirm(orm);
    const globex = await seededFirm(orm, { slug: "globex" });

    await ingest(orm, { firmId: larkspur, asOf: MONDAY });

    const deliveriesOf = (firmId: number) =>
      withFirm(orm, { firmId, query: async (tx) => (await feedRows(tx)).deliveries.length });
    expect(await deliveriesOf(larkspur)).toBe(1);
    expect(await deliveriesOf(globex)).toBe(0);
  });

  test("keeps each Transaction's Trade, Settlement and Posting dates", async ({
    orm,
    migratorOrm,
  }) => {
    const firmId = await seededFirm(orm);

    await ingest(orm, { firmId, asOf: MONDAY });

    const { transactions } = await feedRows(migratorOrm);
    // The buy settles the next Business day; the contribution the same day (primer 01, Part 5).
    expect(transactions.find((row) => row.transactionId === "TX-000000004")).toMatchObject({
      kind: "buy",
      shares: "40.000000",
      amount: "-6010.00",
      tradeDate: "2026-03-02",
      settlementDate: "2026-03-03",
      postingDate: MONDAY,
    });
    expect(transactions.find((row) => row.transactionId === "TX-000000003")).toMatchObject({
      kind: "contribution",
      securityId: null,
      shares: null,
      amount: "10000.00",
      settlementDate: "2026-03-02",
    });
  });

  test("stamps every row of a Delivery with the one moment it arrived", async ({
    orm,
    migratorOrm,
  }) => {
    const firmId = await seededFirm(orm);
    const before = Date.now();

    await ingest(orm, { firmId, asOf: MONDAY });

    const { deliveries, transactions, positions, prices } = await feedRows(migratorOrm);
    const arrivals = new Set(
      [...deliveries, ...transactions, ...positions, ...prices].map((row) =>
        row.arrivedAt.getTime(),
      ),
    );
    expect(arrivals.size).toBe(1);
    const [arrivedAt] = arrivals;
    expect(arrivedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(arrivedAt).toBeLessThanOrEqual(Date.now());
  });

  test("writes nothing the second time, and says so", async ({ orm, migratorOrm }) => {
    const firmId = await seededFirm(orm);
    await ingest(orm, { firmId, asOf: MONDAY });
    const once = await feedRows(migratorOrm);

    const again = await ingest(orm, { firmId, asOf: MONDAY });

    expect(again).toEqual({
      status: "already_ingested",
      asOf: MONDAY,
      manifestSha256: MONDAY_MANIFEST_SHA256,
    });
    // Arrival times included: a rerun writes nothing, so nothing arrives again.
    expect(await feedRows(migratorOrm)).toEqual(once);
  });

  test("refuses a Deactivated Firm, writing nothing, until it's reactivated", async ({
    orm,
    migratorOrm,
  }) => {
    const firmId = await seededFirm(orm);
    await deactivateOrganization(orm, { slug: WORLD_FIRM_SLUG, reason: "Left" });
    const before = await feedRows(migratorOrm);

    expect(await ingest(orm, { firmId, asOf: MONDAY })).toEqual({
      status: "refused",
      asOf: MONDAY,
      reason: "firm_deactivated",
      message: `Firm ${firmId} is deactivated: its records can't be read or written`,
    });
    expect(await feedRows(migratorOrm)).toEqual(before);

    await reactivateOrganization(orm, { slug: WORLD_FIRM_SLUG, reason: "Back" });
    expect(await ingest(orm, { firmId, asOf: MONDAY })).toMatchObject({ status: "ingested" });
  });

  test("loads a later day's Delivery beside an earlier one", async ({ orm, migratorOrm }) => {
    const firmId = await seededFirm(orm);
    await ingest(orm, { firmId, asOf: MONDAY });

    const result = await ingest(orm, { firmId, asOf: FRIDAY });

    // The Security master and the Accounts haven't changed since Monday, so they're left alone.
    expect(result).toMatchObject({
      status: "ingested",
      written: { securities: 0, accounts: 0, transactions: 3, positions: 5, prices: 3 },
    });
    const { deliveries, securities, transactions } = await feedRows(migratorOrm);
    expect(deliveries.map((row) => row.asOfDate)).toEqual([MONDAY, FRIDAY]);
    expect(securities).toHaveLength(19);
    // Friday's Reversal undoes Tuesday's dividend, a Delivery never ingested here.
    expect(transactions.find((row) => row.kind === "reversal")).toMatchObject({
      transactionId: "TX-000000009",
      reverses: "TX-000000005",
      tradeDate: "2026-03-03",
      postingDate: FRIDAY,
    });
  });

  // ADR 0025: the earlier details are kept, with the Delivery that replaced them.
  test("keeps an Account's and a Security's earlier details, naming the Delivery that changed them", async ({
    orm,
    migratorOrm,
  }) => {
    const firmId = await seededFirm(orm);
    await ingest(orm, { firmId, asOf: MONDAY });
    const friday = await textOf({ source: FEED, key: `${FRIDAY}/accounts.csv` });
    const securities = await textOf({ source: FEED, key: `${FRIDAY}/securities.csv` });
    const source = await rewrittenDelivery({
      base: FEED,
      asOf: FRIDAY,
      files: {
        "accounts.csv": friday.replace("CW-000002,traditional_ira", "CW-000002,roth_ira"),
        "securities.csv": securities.replace(
          "BRWP,Brightwell Pharmaceuticals,stock",
          "BRWP,Brightwell Pharma,stock",
        ),
      },
    });

    await ingest(orm, { firmId, asOf: FRIDAY, source });

    const [delivery] = await migratorOrm
      .select({ id: custodianDelivery.id })
      .from(custodianDelivery)
      .where(eq(custodianDelivery.asOfDate, FRIDAY));
    expect(
      await migratorOrm
        .select({
          accountNumber: custodialAccountHistory.accountNumber,
          registrationType: custodialAccountHistory.registrationType,
          openedOn: custodialAccountHistory.openedOn,
          operation: custodialAccountHistory.operation,
          validUntil: custodialAccountHistory.validUntil,
          deliveryId: custodialAccountHistory.changedByDeliveryId,
        })
        .from(custodialAccountHistory)
        .where(eq(custodialAccountHistory.changedByDeliveryId, delivery!.id)),
    ).toEqual([
      {
        accountNumber: "CW-000002",
        registrationType: "traditional_ira",
        openedOn: "2026-03-02",
        operation: "update",
        validUntil: expect.any(Date),
        deliveryId: delivery!.id,
      },
    ]);
    expect(
      await migratorOrm
        .select({
          identifier: securityHistory.identifier,
          name: securityHistory.name,
          kind: securityHistory.kind,
          operation: securityHistory.operation,
          deliveryId: securityHistory.changedByDeliveryId,
        })
        .from(securityHistory)
        .where(eq(securityHistory.changedByDeliveryId, delivery!.id)),
    ).toEqual([
      {
        identifier: "BRWP",
        name: "Brightwell Pharmaceuticals",
        kind: "stock",
        operation: "update",
        deliveryId: delivery!.id,
      },
    ]);
  });

  test("keeps no history when nothing changed", async ({ orm, migratorOrm }) => {
    const firmId = await seededFirm(orm);
    // Monday fills in the seed's empty Account details, which keeps their empty versions.
    await ingest(orm, { firmId, asOf: MONDAY });
    const history = async () => ({
      accounts: await migratorOrm.select().from(custodialAccountHistory),
      securities: await migratorOrm.select().from(securityHistory),
    });
    const afterMonday = await history();

    await ingest(orm, { firmId, asOf: MONDAY });
    await ingest(orm, { firmId, asOf: FRIDAY });

    expect(afterMonday.accounts.map((row) => row.registrationType)).toEqual([null, null]);
    expect(await history()).toEqual(afterMonday);
  });

  test("stores a Position with no price yet as empty, not zero", async ({ orm, migratorOrm }) => {
    const firmId = await seededFirm(orm);
    const source = await rewrittenDelivery({
      base: FEED,
      asOf: MONDAY,
      files: {
        "positions.csv": await mondaysWith({
          file: "positions.csv",
          from: "LKBF,300.000000,10.00,3000.00",
          to: "LKBF,300.000000,,",
        }),
      },
    });

    await ingest(orm, { firmId, asOf: MONDAY, source });

    const { positions } = await feedRows(migratorOrm);
    expect(positions[0]).toMatchObject({ shares: "300.000000", price: null, marketValue: null });
  });

  describe("refuses, writing nothing,", () => {
    test("a Delivery whose Manifest isn't there yet", async ({ orm, migratorOrm }) => {
      const firmId = await seededFirm(orm);
      const before = await feedRows(migratorOrm);

      const result = await ingest(orm, { firmId, asOf: "2026-03-03" });

      expect(result).toMatchObject({ status: "refused", reason: "not_delivered" });
      expect(await feedRows(migratorOrm)).toEqual(before);
    });

    test("a file whose Content hash isn't the Manifest's", async ({ orm, migratorOrm }) => {
      const firmId = await seededFirm(orm);
      const before = await feedRows(migratorOrm);
      // The primer's Part 4: the IRA's 6000.00 became 600.00, so the row count still matches.
      const source = editedFeedSource({
        base: FEED,
        edits: {
          [`${MONDAY}/transactions.csv`]: await mondaysWith({
            file: "transactions.csv",
            from: "6000.00",
            to: "600.00",
          }),
        },
      });

      const result = await ingest(orm, { firmId, asOf: MONDAY, source });

      expect(result).toEqual({
        status: "refused",
        asOf: MONDAY,
        reason: "incomplete",
        message:
          "The Delivery for 2026-03-02 doesn't match its Manifest: " +
          "transactions.csv's Content hash isn't the Manifest's",
      });
      expect(await feedRows(migratorOrm)).toEqual(before);
    });

    test("a file cut short, naming the rows it's missing", async ({ orm, migratorOrm }) => {
      const firmId = await seededFirm(orm);
      const before = await feedRows(migratorOrm);
      const transactions = await textOf({ source: FEED, key: `${MONDAY}/transactions.csv` });
      const source = editedFeedSource({
        base: FEED,
        edits: {
          [`${MONDAY}/transactions.csv`]: transactions.split("\n").slice(0, 4).join("\n") + "\n",
          [`${MONDAY}/prices.csv`]: null,
        },
      });

      const result = await ingest(orm, { firmId, asOf: MONDAY, source });

      expect(result).toMatchObject({ status: "refused", reason: "incomplete" });
      expect(result.status === "refused" && result.message).toBe(
        "The Delivery for 2026-03-02 doesn't match its Manifest: prices.csv is missing; " +
          "transactions.csv has 3 rows, the Manifest lists 4",
      );
      expect(await feedRows(migratorOrm)).toEqual(before);
    });

    test("a file with one invalid row, naming it", async ({ orm, migratorOrm }) => {
      const firmId = await seededFirm(orm);
      const before = await feedRows(migratorOrm);
      const source = await rewrittenDelivery({
        base: FEED,
        asOf: MONDAY,
        files: {
          "transactions.csv": await mondaysWith({
            file: "transactions.csv",
            from: ",6000.00,",
            to: ',"6,000.00",',
          }),
        },
      });

      const result = await ingest(orm, { firmId, asOf: MONDAY, source });

      expect(result).toMatchObject({ status: "refused", reason: "invalid_rows" });
      expect(result.status === "refused" && result.message).toMatch(
        /^The Delivery for 2026-03-02 has invalid rows: transactions\.csv row 4: amount: /,
      );
      expect(await feedRows(migratorOrm)).toEqual(before);
    });

    test("a row naming a Security the Security master doesn't list", async ({ orm }) => {
      const firmId = await seededFirm(orm);
      const source = await rewrittenDelivery({
        base: FEED,
        asOf: MONDAY,
        files: {
          "prices.csv": await mondaysWith({ file: "prices.csv", from: "LKBF,", to: "LKXX," }),
        },
      });

      const result = await ingest(orm, { firmId, asOf: MONDAY, source });

      expect(result).toMatchObject({
        status: "refused",
        reason: "invalid_rows",
        message: expect.stringContaining("prices.csv row 2: Security LKXX isn't in securities.csv"),
      });
    });

    test("a Transaction posted on another day", async ({ orm }) => {
      const firmId = await seededFirm(orm);
      const source = await rewrittenDelivery({
        base: FEED,
        asOf: MONDAY,
        files: {
          "transactions.csv": await mondaysWith({
            file: "transactions.csv",
            from: "10000.00,2026-03-02,2026-03-02,2026-03-02",
            to: "10000.00,2026-03-02,2026-03-02,2026-03-03",
          }),
        },
      });

      const result = await ingest(orm, { firmId, asOf: MONDAY, source });

      expect(result).toMatchObject({
        status: "refused",
        reason: "invalid_rows",
        message: expect.stringContaining("row 2: posted on 2026-03-03, not on 2026-03-02"),
      });
    });

    test("an account number the Firm has no Account for, naming it", async ({
      orm,
      migratorOrm,
    }) => {
      const firmId = await seededFirm(orm);
      const before = await feedRows(migratorOrm);
      const accounts = await textOf({ source: FEED, key: `${MONDAY}/accounts.csv` });
      const source = await rewrittenDelivery({
        base: FEED,
        asOf: MONDAY,
        files: { "accounts.csv": `${accounts}CW-000099,individual,2026-03-02\n` },
      });

      const result = await ingest(orm, { firmId, asOf: MONDAY, source });

      expect(result).toEqual({
        status: "refused",
        asOf: MONDAY,
        reason: "unknown_accounts",
        message:
          "The Firm has no Account numbered CW-000099; add it to a Household before ingesting",
      });
      expect(await feedRows(migratorOrm)).toEqual(before);
    });

    test("a Transaction for an account number the Firm has no Account for", async ({ orm }) => {
      const firmId = await seededFirm(orm);
      const source = await rewrittenDelivery({
        base: FEED,
        asOf: MONDAY,
        files: {
          "transactions.csv": await mondaysWith({
            file: "transactions.csv",
            from: "TX-000000012,CW-000002,",
            to: "TX-000000012,CW-000077,",
          }),
        },
      });

      const result = await ingest(orm, { firmId, asOf: MONDAY, source });

      expect(result).toMatchObject({
        status: "refused",
        reason: "unknown_accounts",
        message: expect.stringContaining("no Account numbered CW-000077;"),
      });
    });

    test("another Firm's Accounts", async ({ orm }) => {
      // Globex is seeded too, but the world's Accounts are Larkspur's.
      const globex = await seededFirm(orm, { slug: "globex" });

      const result = await ingest(orm, { firmId: globex, asOf: MONDAY });

      expect(result).toMatchObject({
        status: "refused",
        reason: "unknown_accounts",
        message: expect.stringContaining("CW-000001; CW-000002"),
      });
    });

    test("a different Delivery for a day already ingested", async ({ orm, migratorOrm }) => {
      const firmId = await seededFirm(orm);
      await ingest(orm, { firmId, asOf: MONDAY });
      const before = await feedRows(migratorOrm);
      const restated = await rewrittenDelivery({
        base: FEED,
        asOf: MONDAY,
        files: {
          "transactions.csv": await mondaysWith({
            file: "transactions.csv",
            from: "6000.00",
            to: "6500.00",
          }),
        },
      });

      const result = await ingest(orm, { firmId, asOf: MONDAY, source: restated });

      expect(result).toMatchObject({
        status: "refused",
        reason: "restatement",
        message: expect.stringContaining(
          "A different Delivery for 2026-03-02 was already ingested",
        ),
      });
      expect(await feedRows(migratorOrm)).toEqual(before);
    });

    test("a Transaction an earlier Delivery already carried", async ({ orm, migratorOrm }) => {
      const firmId = await seededFirm(orm);
      await ingest(orm, { firmId, asOf: MONDAY });
      const before = await feedRows(migratorOrm);
      const friday = await textOf({ source: FEED, key: `${FRIDAY}/transactions.csv` });
      const source = await rewrittenDelivery({
        base: FEED,
        asOf: FRIDAY,
        files: { "transactions.csv": friday.replace("TX-000000011", "TX-000000003") },
      });

      const result = await ingest(orm, { firmId, asOf: FRIDAY, source });

      expect(result).toEqual({
        status: "refused",
        asOf: FRIDAY,
        reason: "transactions_already_ingested",
        message: "An earlier Delivery already carried Transaction TX-000000003",
      });
      expect(await feedRows(migratorOrm)).toEqual(before);
    });

    test.for([
      {
        what: "a format version it doesn't read",
        change: { format_version: 2 },
        message: "format_version",
      },
      {
        what: "another day's date",
        change: { as_of_date: "2026-03-06" },
        message: "is for 2026-03-06",
      },
    ])("a Manifest with $what", async ({ change, message }, { orm }) => {
      const firmId = await seededFirm(orm);
      const source = await rewrittenDelivery({
        base: FEED,
        asOf: MONDAY,
        editManifest: (json) => ({ ...json, ...change }),
      });

      const result = await ingest(orm, { firmId, asOf: MONDAY, source });

      expect(result).toMatchObject({
        status: "refused",
        reason: "invalid_manifest",
        message: expect.stringContaining(message),
      });
    });
  });
});
