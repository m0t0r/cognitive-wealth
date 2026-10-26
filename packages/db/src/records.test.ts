import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { EXCLUDED_TABLES, RECORD_TABLES } from "./records";
import * as schema from "./schema";

const schemaTables = Object.values(schema)
  .filter((value) => is(value, PgTable))
  .map((table) => getTableName(table))
  .toSorted();

describe("the record-table lists", () => {
  it("name every schema table exactly once, exported or excluded", () => {
    const listed = [...RECORD_TABLES, ...EXCLUDED_TABLES].map(({ table }) => table);
    expect(listed.toSorted()).toEqual(schemaTables);
  });

  it("give every excluded table a reason", () => {
    for (const { table, reason } of EXCLUDED_TABLES) {
      expect(reason.trim(), table).not.toBe("");
    }
  });
});
