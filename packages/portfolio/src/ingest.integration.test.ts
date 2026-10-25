import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "@repo/db";
import { organization } from "@repo/db/schema";
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
const MONDAY_MANIFEST_SHA256 = "20067846433cbe524c6aa4e5f748804f294f35e878fe318d0e6fd371e7f2b1d2";

/** The database `pnpm db:seed` gives: world file v0's Households and Accounts in its Firm. */
async function seededFirm(db: Database, slug = WORLD_FIRM_SLUG) {
  await seedDevWorld(db, JSON.parse(readFileSync(WORLD, "utf8")));
  const [firm] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, slug));
  return firm!.id;
}

const ingest = (db: Database, firmId: number, asOf: string, source: FeedSource = FEED) =>
  ingestDelivery(db, { firmId, asOf, source });

/** Monday's `name` with `from` replaced by `to`, which must be in it. */
async function mondaysWith(name: string, from: string, to: string) {
  const text = await textOf(FEED, `${MONDAY}/${name}`);
  if (!text.includes(from)) throw new Error(`${name} has no ${from}`);
  return text.replace(from, to);
}

describe("ingestDelivery", () => {
  test("loads 2 March's Delivery for world file v0", async ({ orm }) => {
    const firmId = await seededFirm(orm);

    const result = await ingest(orm, firmId, MONDAY);

    expect(result).toEqual({
      status: "ingested",
      asOf: MONDAY,
      manifestSha256: MONDAY_MANIFEST_SHA256,
      written: { securities: 3, accounts: 2, transactions: 4, positions: 5, prices: 3 },
    });
    const rows = await feedRows(orm);
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
    expect(rows.securities.map(({ identifier, kind }) => `${identifier} ${kind}`)).toEqual([
      "LKBF fund",
      "LKSF fund",
      "SWEEP cash_sweep",
    ]);
    expect(rows.prices.map(({ asOfDate, price }) => `${asOfDate} ${price}`)).toEqual([
      "2026-03-02 10.00",
      "2026-03-02 150.25",
      "2026-03-02 1.00",
    ]);
  });

  test("keeps each Transaction's Trade, Settlement and Posting dates", async ({ orm }) => {
    const firmId = await seededFirm(orm);

    await ingest(orm, firmId, MONDAY);

    const { transactions } = await feedRows(orm);
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

  test("stamps every row of a Delivery with the one moment it arrived", async ({ orm }) => {
    const firmId = await seededFirm(orm);
    const before = Date.now();

    await ingest(orm, firmId, MONDAY);

    const { deliveries, transactions, positions, prices } = await feedRows(orm);
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

  test("writes nothing the second time, and says so", async ({ orm }) => {
    const firmId = await seededFirm(orm);
    await ingest(orm, firmId, MONDAY);
    const once = await feedRows(orm);

    const again = await ingest(orm, firmId, MONDAY);

    expect(again).toEqual({
      status: "already_ingested",
      asOf: MONDAY,
      manifestSha256: MONDAY_MANIFEST_SHA256,
    });
    // Arrival times included: a rerun writes nothing, so nothing arrives again.
    expect(await feedRows(orm)).toEqual(once);
  });

  test("loads a later day's Delivery beside an earlier one", async ({ orm }) => {
    const firmId = await seededFirm(orm);
    await ingest(orm, firmId, MONDAY);

    const result = await ingest(orm, firmId, FRIDAY);

    // The Security master and the Accounts haven't changed since Monday, so they're left alone.
    expect(result).toMatchObject({
      status: "ingested",
      written: { securities: 0, accounts: 0, transactions: 3, positions: 5, prices: 3 },
    });
    const { deliveries, securities, transactions } = await feedRows(orm);
    expect(deliveries.map((row) => row.asOfDate)).toEqual([MONDAY, FRIDAY]);
    expect(securities).toHaveLength(3);
    // Friday's Reversal undoes Tuesday's dividend, a Delivery never ingested here.
    expect(transactions.find((row) => row.kind === "reversal")).toMatchObject({
      transactionId: "TX-000000009",
      reverses: "TX-000000005",
      tradeDate: "2026-03-03",
      postingDate: FRIDAY,
    });
  });

  test("stores a Position with no price yet as empty, not zero", async ({ orm }) => {
    const firmId = await seededFirm(orm);
    const source = await rewrittenDelivery(FEED, MONDAY, {
      "positions.csv": await mondaysWith(
        "positions.csv",
        "LKBF,300.000000,10.00,3000.00",
        "LKBF,300.000000,,",
      ),
    });

    await ingest(orm, firmId, MONDAY, source);

    const { positions } = await feedRows(orm);
    expect(positions[0]).toMatchObject({ shares: "300.000000", price: null, marketValue: null });
  });

  describe("refuses, writing nothing,", () => {
    test("a Delivery whose Manifest isn't there yet", async ({ orm }) => {
      const firmId = await seededFirm(orm);
      const before = await feedRows(orm);

      const result = await ingest(orm, firmId, "2026-03-03");

      expect(result).toMatchObject({ status: "refused", reason: "not_delivered" });
      expect(await feedRows(orm)).toEqual(before);
    });

    test("a file whose Content hash isn't the Manifest's", async ({ orm }) => {
      const firmId = await seededFirm(orm);
      const before = await feedRows(orm);
      // The primer's Part 4: the IRA's 6000.00 became 600.00, so the row count still matches.
      const source = editedFeedSource(FEED, {
        [`${MONDAY}/transactions.csv`]: await mondaysWith("transactions.csv", "6000.00", "600.00"),
      });

      const result = await ingest(orm, firmId, MONDAY, source);

      expect(result).toEqual({
        status: "refused",
        asOf: MONDAY,
        reason: "incomplete",
        message:
          "The Delivery for 2026-03-02 doesn't match its Manifest: " +
          "transactions.csv's Content hash isn't the Manifest's",
      });
      expect(await feedRows(orm)).toEqual(before);
    });

    test("a file cut short, naming the rows it's missing", async ({ orm }) => {
      const firmId = await seededFirm(orm);
      const before = await feedRows(orm);
      const transactions = await textOf(FEED, `${MONDAY}/transactions.csv`);
      const source = editedFeedSource(FEED, {
        [`${MONDAY}/transactions.csv`]: transactions.split("\n").slice(0, 4).join("\n") + "\n",
        [`${MONDAY}/prices.csv`]: null,
      });

      const result = await ingest(orm, firmId, MONDAY, source);

      expect(result).toMatchObject({ status: "refused", reason: "incomplete" });
      expect(result.status === "refused" && result.message).toBe(
        "The Delivery for 2026-03-02 doesn't match its Manifest: prices.csv is missing; " +
          "transactions.csv has 3 rows, the Manifest lists 4",
      );
      expect(await feedRows(orm)).toEqual(before);
    });

    test("a file with one invalid row, naming it", async ({ orm }) => {
      const firmId = await seededFirm(orm);
      const before = await feedRows(orm);
      const source = await rewrittenDelivery(FEED, MONDAY, {
        "transactions.csv": await mondaysWith("transactions.csv", ",6000.00,", ',"6,000.00",'),
      });

      const result = await ingest(orm, firmId, MONDAY, source);

      expect(result).toMatchObject({ status: "refused", reason: "invalid_rows" });
      expect(result.status === "refused" && result.message).toMatch(
        /^The Delivery for 2026-03-02 has invalid rows: transactions\.csv row 4: amount: /,
      );
      expect(await feedRows(orm)).toEqual(before);
    });

    test("a row naming a Security the Security master doesn't list", async ({ orm }) => {
      const firmId = await seededFirm(orm);
      const source = await rewrittenDelivery(FEED, MONDAY, {
        "prices.csv": await mondaysWith("prices.csv", "LKBF,", "LKXX,"),
      });

      const result = await ingest(orm, firmId, MONDAY, source);

      expect(result).toMatchObject({
        status: "refused",
        reason: "invalid_rows",
        message: expect.stringContaining("prices.csv row 2: Security LKXX isn't in securities.csv"),
      });
    });

    test("a Transaction posted on another day", async ({ orm }) => {
      const firmId = await seededFirm(orm);
      const source = await rewrittenDelivery(FEED, MONDAY, {
        "transactions.csv": await mondaysWith(
          "transactions.csv",
          "10000.00,2026-03-02,2026-03-02,2026-03-02",
          "10000.00,2026-03-02,2026-03-02,2026-03-03",
        ),
      });

      const result = await ingest(orm, firmId, MONDAY, source);

      expect(result).toMatchObject({
        status: "refused",
        reason: "invalid_rows",
        message: expect.stringContaining("row 2: posted on 2026-03-03, not on 2026-03-02"),
      });
    });

    test("an account number the Firm has no Account for, naming it", async ({ orm }) => {
      const firmId = await seededFirm(orm);
      const before = await feedRows(orm);
      const accounts = await textOf(FEED, `${MONDAY}/accounts.csv`);
      const source = await rewrittenDelivery(FEED, MONDAY, {
        "accounts.csv": `${accounts}CW-000099,individual,2026-03-02\n`,
      });

      const result = await ingest(orm, firmId, MONDAY, source);

      expect(result).toEqual({
        status: "refused",
        asOf: MONDAY,
        reason: "unknown_accounts",
        message:
          "The Firm has no Account numbered CW-000099; add it to a Household before ingesting",
      });
      expect(await feedRows(orm)).toEqual(before);
    });

    test("another Firm's Accounts", async ({ orm }) => {
      // Globex is seeded too, but the world's Accounts are Larkspur's.
      const globex = await seededFirm(orm, "globex");

      const result = await ingest(orm, globex, MONDAY);

      expect(result).toMatchObject({
        status: "refused",
        reason: "unknown_accounts",
        message: expect.stringContaining("CW-000001; CW-000002"),
      });
    });

    test("a different Delivery for a day already ingested", async ({ orm }) => {
      const firmId = await seededFirm(orm);
      await ingest(orm, firmId, MONDAY);
      const before = await feedRows(orm);
      const restated = await rewrittenDelivery(FEED, MONDAY, {
        "transactions.csv": await mondaysWith("transactions.csv", "6000.00", "6500.00"),
      });

      const result = await ingest(orm, firmId, MONDAY, restated);

      expect(result).toMatchObject({
        status: "refused",
        reason: "restatement",
        message: expect.stringContaining(
          "A different Delivery for 2026-03-02 was already ingested",
        ),
      });
      expect(await feedRows(orm)).toEqual(before);
    });

    test("a Transaction an earlier Delivery already carried", async ({ orm }) => {
      const firmId = await seededFirm(orm);
      await ingest(orm, firmId, MONDAY);
      const before = await feedRows(orm);
      const friday = await textOf(FEED, `${FRIDAY}/transactions.csv`);
      const source = await rewrittenDelivery(FEED, FRIDAY, {
        "transactions.csv": friday.replace("TX-000000011", "TX-000000003"),
      });

      const result = await ingest(orm, firmId, FRIDAY, source);

      expect(result).toEqual({
        status: "refused",
        asOf: FRIDAY,
        reason: "transactions_already_ingested",
        message: "An earlier Delivery already carried Transaction TX-000000003",
      });
      expect(await feedRows(orm)).toEqual(before);
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
      const source = await rewrittenDelivery(FEED, MONDAY, {}, (json) => ({ ...json, ...change }));

      const result = await ingest(orm, firmId, MONDAY, source);

      expect(result).toMatchObject({
        status: "refused",
        reason: "invalid_manifest",
        message: expect.stringContaining(message),
      });
    });
  });
});
