import { sql } from "drizzle-orm";
import { bigint, customType, timestamp, uuid } from "drizzle-orm/pg-core";

export const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const createdAt = () => timestamptz("created_at").notNull().defaultNow();
export const updatedAt = () =>
  timestamptz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
export const accessedAt = () => timestamptz("accessed_at").notNull().defaultNow();

export const timestamps = {
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  accessedAt: accessedAt(),
};

/** Internal primary key. Never sent to the browser; expose `publicId` instead. */
export const id = () => bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity();

/** The ID users can see. A UUIDv7, so it reveals when the row was created. */
export const publicId = () =>
  uuid("public_id")
    .notNull()
    .unique()
    .default(sql`uuidv7()`);

/**
 * A `bigint` column read and written as a JS string, for ID columns Better Auth treats as plain
 * strings (it only converts fields declared as references), such as `session.activeOrganizationId`.
 */
export const bigintString = customType<{ data: string; driverData: string | number | bigint }>({
  dataType: () => "bigint",
  toDriver: (value) => value,
  fromDriver: (value) => String(value),
});
