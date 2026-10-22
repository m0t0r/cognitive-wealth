import { describe, expect } from "vitest";
import { createDatabaseTest } from "./pglite";

const test = createDatabaseTest(async (db) => {
  await db.exec(`create table notes (id serial primary key, body text not null)`);
});

describe("createDatabaseTest", () => {
  test("runs migrations and queries real Postgres", async ({ db }) => {
    await db.query("insert into notes (body) values ($1)", ["hello"]);
    const { rows } = await db.query<{ body: string }>("select body from notes");
    expect(rows).toEqual([{ body: "hello" }]);
  });

  test("isolates each test from the others' writes", async ({ db }) => {
    const { rows } = await db.query("select * from notes");
    expect(rows).toHaveLength(0);
  });
});
