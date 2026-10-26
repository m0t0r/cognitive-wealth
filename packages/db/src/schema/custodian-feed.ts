// What Ingestion (#40) writes from the Custodian feed (GLOSSARY.md, "Custodian feed"): each
// Delivery it loaded, the Security master, and the Delivery's Transactions, Positions and prices,
// kept as the Custodian reported them. Firm-scoped like households.ts, with every link a foreign
// key on (firm_id, id). Every row of a Delivery keeps `arrived_at`, the moment it reached
// Cognitive Wealth, beside the dates it happened and settled (ADR 0009). Amounts are `numeric` at
// their type's scale, read and written as strings (ADR 0013). An Account or Security with rows here
// can't be deleted, so its history can't go with it; only deleting the Firm removes them.
import {
  SecurityKind as SecurityKindSchema,
  TransactionKind as TransactionKindSchema,
} from "@repo/custodian-client/schemas";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  unique,
} from "drizzle-orm/pg-core";
import { firmId, firmIsolation, knownValue, nonEmpty } from "./_domain";
import { createdAt, id, publicId, timestamptz, updatedAt } from "./_helpers";
import { custodialAccount } from "./households";

/** GLOSSARY.md, "Security": the contract's `SecurityKind`. */
export const SECURITY_KINDS = nonEmpty(SecurityKindSchema.options);
/** GLOSSARY.md, "Transaction": the contract's `TransactionKind`, the eight kinds and a Reversal. */
export const TRANSACTION_KINDS = nonEmpty(TransactionKindSchema.options);

export type SecurityKind = (typeof SECURITY_KINDS)[number];
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

// Money is whole cents and Shares six places (ADR 0013); a Price keeps the scale it was quoted at,
// so its column has none.
const money = (name: string) => numeric(name, { precision: 20, scale: 2, mode: "string" });
const shares = (name: string) => numeric(name, { precision: 24, scale: 6, mode: "string" });
const price = (name: string) => numeric(name, { mode: "string" });

// When the row reached Cognitive Wealth. Ingestion writes a Delivery in one database transaction,
// and `now()` is that transaction's start, so every row of a Delivery has the same moment.
const arrivedAt = () => timestamptz("arrived_at").notNull().defaultNow();
const deliveryId = () => bigint("delivery_id", { mode: "number" }).notNull();

/**
 * A Delivery Ingestion loaded (GLOSSARY.md, "Delivery"), one per Firm and As-of date. The
 * Manifest's Content hash tells a Redelivery (the same hash: nothing to do) from a Restatement (a
 * different one, refused until phase 2). Only Ingestion reads it, so it has no `public_id`.
 */
export const custodianDelivery = pgTable(
  "custodian_delivery",
  {
    id: id(),
    firmId: firmId(),
    asOfDate: date("as_of_date", { mode: "string" }).notNull(),
    manifestSha256: text("manifest_sha256").notNull(),
    arrivedAt: arrivedAt(),
  },
  (t) => [
    firmIsolation(),
    unique("custodian_delivery_firm_id_id_unique").on(t.firmId, t.id),
    unique("custodian_delivery_firm_id_as_of_date_unique").on(t.firmId, t.asOfDate),
  ],
);

/**
 * A Security from the Security master (GLOSSARY.md), found again by its identifier. Every Delivery
 * sends the whole master, so Ingestion adds the new ones and brings the rest up to date.
 */
export const security = pgTable(
  "security",
  {
    id: id(),
    publicId: publicId(),
    firmId: firmId(),
    identifier: text("identifier").notNull(),
    name: text("name").notNull(),
    kind: text("kind", { enum: SECURITY_KINDS }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    firmIsolation(),
    unique("security_firm_id_id_unique").on(t.firmId, t.id),
    unique("security_firm_id_identifier_unique").on(t.firmId, t.identifier),
    check("security_kind_check", knownValue(t.kind, SECURITY_KINDS)),
  ],
);

/**
 * A Transaction as the Custodian posted it (GLOSSARY.md), from the `transactions.csv` of the
 * Delivery for its Posting date. `transaction_id` is the Custodian's own ID (ADR 0017): unique in
 * the Firm, so the database itself refuses a Transaction loaded twice.
 */
export const custodialTransaction = pgTable(
  "custodial_transaction",
  {
    id: id(),
    publicId: publicId(),
    firmId: firmId(),
    deliveryId: deliveryId(),
    transactionId: text("transaction_id").notNull(),
    accountId: bigint("account_id", { mode: "number" }).notNull(),
    kind: text("kind", { enum: TRANSACTION_KINDS }).notNull(),
    // For a Reversal, the `transaction_id` it undoes. Not a foreign key: the original may be in a
    // Delivery not yet ingested.
    reverses: text("reverses"),
    securityId: bigint("security_id", { mode: "number" }),
    shares: shares("shares"),
    amount: money("amount").notNull(),
    tradeDate: date("trade_date", { mode: "string" }).notNull(),
    settlementDate: date("settlement_date", { mode: "string" }).notNull(),
    // The As-of date of the Delivery that carried it, even for a Correction to an earlier day.
    postingDate: date("posting_date", { mode: "string" }).notNull(),
    arrivedAt: arrivedAt(),
  },
  (t) => [
    firmIsolation(),
    foreignKey({
      name: "custodial_transaction_delivery_fk",
      columns: [t.firmId, t.deliveryId],
      foreignColumns: [custodianDelivery.firmId, custodianDelivery.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "custodial_transaction_account_fk",
      columns: [t.firmId, t.accountId],
      foreignColumns: [custodialAccount.firmId, custodialAccount.id],
    }),
    foreignKey({
      name: "custodial_transaction_security_fk",
      columns: [t.firmId, t.securityId],
      foreignColumns: [security.firmId, security.id],
    }),
    unique("custodial_transaction_firm_id_transaction_id_unique").on(t.firmId, t.transactionId),
    index("custodial_transaction_account_id_trade_date_idx").on(t.accountId, t.tradeDate),
    index("custodial_transaction_delivery_id_idx").on(t.deliveryId),
    check("custodial_transaction_kind_check", knownValue(t.kind, TRANSACTION_KINDS)),
  ],
);

/**
 * A Custodian-reported Position: the shares of one Security in one Account at the end of the
 * Delivery's As-of date, as the Custodian counted them, kept for Reconciliation (phase 2). `price`
 * and `market_value` are null when the Security had no price yet (ADR 0016).
 */
export const custodialPosition = pgTable(
  "custodial_position",
  {
    id: id(),
    publicId: publicId(),
    firmId: firmId(),
    deliveryId: deliveryId(),
    asOfDate: date("as_of_date", { mode: "string" }).notNull(),
    accountId: bigint("account_id", { mode: "number" }).notNull(),
    securityId: bigint("security_id", { mode: "number" }).notNull(),
    shares: shares("shares").notNull(),
    price: price("price"),
    marketValue: money("market_value"),
    arrivedAt: arrivedAt(),
  },
  (t) => [
    firmIsolation(),
    foreignKey({
      name: "custodial_position_delivery_fk",
      columns: [t.firmId, t.deliveryId],
      foreignColumns: [custodianDelivery.firmId, custodianDelivery.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "custodial_position_account_fk",
      columns: [t.firmId, t.accountId],
      foreignColumns: [custodialAccount.firmId, custodialAccount.id],
    }),
    foreignKey({
      name: "custodial_position_security_fk",
      columns: [t.firmId, t.securityId],
      foreignColumns: [security.firmId, security.id],
    }),
    unique("custodial_position_account_id_security_id_as_of_date_unique").on(
      t.accountId,
      t.securityId,
      t.asOfDate,
    ),
    index("custodial_position_delivery_id_idx").on(t.deliveryId),
  ],
);

/** A Security's price on the Delivery's As-of date, from its `prices.csv`. */
export const securityPrice = pgTable(
  "security_price",
  {
    id: id(),
    firmId: firmId(),
    deliveryId: deliveryId(),
    asOfDate: date("as_of_date", { mode: "string" }).notNull(),
    securityId: bigint("security_id", { mode: "number" }).notNull(),
    price: price("price").notNull(),
    arrivedAt: arrivedAt(),
  },
  (t) => [
    firmIsolation(),
    foreignKey({
      name: "security_price_delivery_fk",
      columns: [t.firmId, t.deliveryId],
      foreignColumns: [custodianDelivery.firmId, custodianDelivery.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "security_price_security_fk",
      columns: [t.firmId, t.securityId],
      foreignColumns: [security.firmId, security.id],
    }),
    unique("security_price_security_id_as_of_date_unique").on(t.securityId, t.asOfDate),
    index("security_price_delivery_id_idx").on(t.deliveryId),
  ],
);
