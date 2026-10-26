// One representative run of `cw custodian ingest` on a real database, as `app`: an Ingestion, the
// same Delivery again, a refusal and an unknown Firm. `@repo/portfolio`'s ingest tests own the rules.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "@repo/db/testing";
import { seedDevWorld } from "@repo/households/seed";
import { createCli } from "../app";
import { dependencies, run } from "../testing";

// The custodian's example Deliveries for world file v0 (2 and 6 March).
const FEED = join(import.meta.dirname, "../../../../apps/custodian/fixtures/feed");
const WORLD = join(import.meta.dirname, "../../../../world/v0.json");

test("ingests a Delivery, skips it the second time, and refuses one not delivered", async ({
  orm,
}) => {
  await seedDevWorld(orm, JSON.parse(readFileSync(WORLD, "utf8")));
  const cli = createCli(
    dependencies({
      openDatabase: async () => ({ db: orm, close: async () => {}, target: "test", local: true }),
    }),
  );
  const ingest = (asOf: string, ...rest: string[]) =>
    run({ cli, argv: ["custodian", "ingest", asOf, "--root", FEED, ...rest] });

  const dryRun = await ingest("2026-03-02", "--dry-run");
  expect(dryRun).toMatchObject({ exitCode: 0, output: { status: "ingested", dryRun: true } });

  const first = await ingest("2026-03-02");
  expect(first).toMatchObject({
    exitCode: 0,
    output: {
      database: "test",
      firm: { slug: "larkspur", name: "Larkspur Wealth Partners" },
      asOf: "2026-03-02",
      status: "ingested",
      dryRun: false,
      delivery: join(FEED, "2026-03-02"),
      manifestSha256: "77f896ad0c060514b71c25e32efa41ea3b5f65c9d1a7cc2140f96b1f802a0ab1",
    },
  });
  expect(first.output.written).toEqual(dryRun.output.written);

  const again = await ingest("2026-03-02");
  expect(again).toMatchObject({ exitCode: 0, output: { status: "already_ingested" } });
  expect(again.output.written).toBeUndefined();

  const missing = await ingest("2026-03-03");
  expect(missing).toMatchObject({
    exitCode: 1,
    output: {
      code: "not_delivered",
      retryable: true,
      cta: { commands: [{ command: `pnpm cw custodian ingest 2026-03-03 --root ${FEED}` }] },
    },
  });
  expect(missing.output.message).toMatch(/feed:write --date 2026-03-03/);

  const unknown = await ingest("2026-03-02", "--firm", "nope");
  expect(unknown).toMatchObject({ exitCode: 1, output: { code: "unknown_organization" } });
});
