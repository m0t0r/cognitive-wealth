import { test } from "./testing";

// `drizzle({ client })` (`connect.ts`) replaces postgres.js's JSON serializers on the client, so a
// raw query on `$client` can't bind an object to a `jsonb` parameter. `packages/db/CLAUDE.md`
// ("sql pitfalls") says to pass `JSON.stringify(…)` with `::jsonb`; this pins what it describes.
const NOT_A_STRING = /"string" argument must be of type string/;

describe("a raw postgres.js jsonb parameter on a Drizzle-wrapped client", () => {
  test("fails through client.json()", async ({ orm }) => {
    const client = orm.$client;

    await expect(client`select ${client.json({ a: 1 })}::jsonb as value`).rejects.toThrowError(
      NOT_A_STRING,
    );
  });

  test("fails as a plain object", async ({ orm }) => {
    const client = orm.$client;

    await expect(
      // @ts-expect-error postgres.js types no plain object as a parameter
      client`select ${{ a: 1 }}::jsonb as value`,
    ).rejects.toThrowError(NOT_A_STRING);
  });

  test("works as JSON.stringify(…) with ::jsonb", async ({ orm }) => {
    const client = orm.$client;

    const [row] = await client`select ${JSON.stringify({ a: 1 })}::jsonb as value`;

    expect(row?.value).toEqual({ a: 1 });
  });
});
