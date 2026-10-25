import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import type { ZodType } from "zod";
import {
  AccountRow,
  Manifest,
  PositionRow,
  PriceRow,
  SecurityRow,
  TransactionRow,
} from "./index.ts";

// Two Deliveries as the custodian's writer writes them; its integration tests keep them current.
const DELIVERIES = join(import.meta.dirname, "../../../apps/custodian/fixtures/feed");

const SCHEMAS: Record<string, ZodType> = {
  "accounts.csv": AccountRow,
  "positions.csv": PositionRow,
  "prices.csv": PriceRow,
  "securities.csv": SecurityRow,
  "transactions.csv": TransactionRow,
};

/** A CSV file's rows keyed by its header, with an empty value read as null, as the feed writes None. */
function rowsOf(path: string): Record<string, string | null>[] {
  const rows: Record<string, string>[] = parse(readFileSync(path), { columns: true });
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, value === "" ? null : value]),
    ),
  );
}

const deliveries = readdirSync(DELIVERIES);
const files = deliveries.flatMap((day) =>
  Object.keys(SCHEMAS).map((name) => ({ day, name, path: join(DELIVERIES, day, name) })),
);

const reversal = () => {
  const friday = rowsOf(join(DELIVERIES, "2026-03-06", "transactions.csv"));
  const row = friday.find((transaction) => transaction.kind === "reversal");
  if (!row) throw new Error("Friday's Delivery has no Reversal");
  return row;
};

describe("the Custodian feed's Zod schemas", () => {
  it("has both example Deliveries to read", () => {
    expect(deliveries).toEqual(["2026-03-02", "2026-03-06"]);
  });

  it.each(files)("parse every row of $day/$name", ({ name, path }) => {
    const schema = SCHEMAS[name];
    const rows = rowsOf(path);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(() => schema?.parse(row)).not.toThrow();
  });

  it.each(deliveries)("parse the Manifest of %s", (day) => {
    const manifest: unknown = JSON.parse(
      readFileSync(join(DELIVERIES, day, "manifest.json"), "utf8"),
    );

    expect(() => Manifest.parse(manifest)).not.toThrow();
  });

  it("give a row's fields camelCase names, with the values unchanged", () => {
    // The wire is snake_case, as the custodian writes it; our code reads camelCase.
    const [row] = rowsOf(join(DELIVERIES, "2026-03-02", "positions.csv"));

    expect(PositionRow.parse(row)).toEqual({
      accountNumber: "CW-000001",
      security: "LKBF",
      shares: "300.000000",
      price: "10.00",
      marketValue: "3000.00",
    });
  });

  it("give the Manifest's fields camelCase names", () => {
    const manifest: unknown = JSON.parse(
      readFileSync(join(DELIVERIES, "2026-03-02", "manifest.json"), "utf8"),
    );

    expect(Manifest.parse(manifest)).toMatchObject({ formatVersion: 1, asOfDate: "2026-03-02" });
  });

  it("still read the snake_case names off the wire, not camelCase ones", () => {
    const [row] = rowsOf(join(DELIVERIES, "2026-03-02", "positions.csv"));

    expect(
      PositionRow.safeParse({ ...row, account_number: undefined, accountNumber: "CW-000001" })
        .success,
    ).toBe(false);
  });

  it("reject an amount sent as a JSON number", () => {
    // It has been through a float, so it may no longer be the amount that was meant.
    expect(TransactionRow.safeParse({ ...reversal(), amount: -9 }).success).toBe(false);
  });

  it.each(["-9e0", "", "nine"])("reject the amount %j, which isn't a decimal string", (amount) => {
    expect(TransactionRow.safeParse({ ...reversal(), amount }).success).toBe(false);
  });

  // Money is whole cents and Shares six places (ADR 0013); the custodian always sends exactly
  // that many, so another number of places means the value isn't one it wrote.
  it.each(["10.123", "-9.0", "-9"])("reject the amount %j, which isn't whole cents", (amount) => {
    expect(TransactionRow.safeParse({ ...reversal(), amount }).success).toBe(false);
  });

  it.each(["40.0", "40", "40.0000001"])("reject shares of %j, not six places", (shares) => {
    expect(TransactionRow.safeParse({ ...reversal(), shares }).success).toBe(false);
  });

  it.each(["150.25", "10", "0.1234"])(
    "accept the price %j at whatever scale it's quoted",
    (price) => {
      expect(PriceRow.safeParse({ security: "LKSF", price }).success).toBe(true);
    },
  );

  it.each(["2026-3-3", "03/03/2026", "2026-02-30"])("reject the malformed date %j", (date) => {
    expect(TransactionRow.safeParse({ ...reversal(), trade_date: date }).success).toBe(false);
  });

  it("reject a column the contract doesn't name", () => {
    expect(TransactionRow.safeParse({ ...reversal(), memo: "hello" }).success).toBe(false);
  });

  it("reject a Manifest that doesn't say its format version", () => {
    expect(Manifest.safeParse({ as_of_date: "2026-03-02", files: [] }).success).toBe(false);
    expect(
      Manifest.safeParse({ format_version: 2, as_of_date: "2026-03-02", files: [] }).success,
    ).toBe(false);
  });
});
