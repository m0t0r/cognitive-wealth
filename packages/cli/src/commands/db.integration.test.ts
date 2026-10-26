// One representative run of `cw db seed` on a real database, as `app`: the dry run, the seed, the
// same seed again, and a changed world file. `@repo/households`' and `@repo/db`'s seed tests own
// the rules.
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { count } from "drizzle-orm";
import { user } from "@repo/db/schema";
import { test } from "@repo/db/testing";
import { createCli } from "../app";
import { dependencies, run } from "../testing";

const WORLD = join(import.meta.dirname, "../../../../world/v0.json");

test("seeds after a dry run, adds nothing the second time, and refuses a changed world", async ({
  orm,
}) => {
  const cli = createCli(
    dependencies({
      openDatabase: async () => ({ db: orm, close: async () => {}, target: "test", local: true }),
    }),
  );
  const users = async () => (await orm.select({ n: count() }).from(user))[0]?.n;

  const dryRun = await run({ cli, argv: ["db", "seed", "--dry-run"] });
  expect(dryRun).toMatchObject({
    exitCode: 0,
    output: { database: "test", added: { users: 3, households: 1 }, dryRun: true },
  });
  expect(await users()).toBe(0);

  const seeded = await run({ cli, argv: ["db", "seed"] });
  expect(seeded).toMatchObject({
    exitCode: 0,
    output: {
      added: { users: 3, organizations: 2, memberships: 4, households: 1 },
      dryRun: false,
      cta: { commands: [{ command: "pnpm cw dev sign-in owner@cognitive-wealth.test" }] },
    },
  });
  expect(seeded.output.organizations).toContainEqual({
    name: "Globex",
    slug: "globex",
    members: [{ email: "owner@cognitive-wealth.test", role: "owner" }],
  });
  expect(await users()).toBe(3);

  const again = await run({ cli, argv: ["db", "seed"] });
  expect(again.output).toMatchObject({
    added: { users: 0, organizations: 0, memberships: 0, households: 0 },
  });

  const dir = await mkdtemp(join(tmpdir(), "cw-db-seed-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const changed = join(dir, "world.json");
  await writeFile(
    changed,
    readFileSync(WORLD, "utf8").replace('"name": "The Reyes Household"', '"name": "Reyes"'),
  );
  const conflict = await run({ cli, argv: ["db", "seed", "--world", changed] });
  expect(conflict).toMatchObject({
    exitCode: 1,
    // The fix is in the message: incur 0.7.1 prints no `hint` in an error.
    output: { code: "seed_conflict", message: expect.stringMatching(/start the database over/) },
  });
});

test("refuses a database that isn't local as not_local", async ({ orm }) => {
  const cli = createCli(
    dependencies({
      openDatabase: async () => ({ db: orm, close: async () => {}, target: "prod", local: false }),
    }),
  );
  const { output, exitCode } = await run({ cli, argv: ["db", "seed"] });
  expect(exitCode).toBe(1);
  expect(output).toMatchObject({ code: "not_local" });
  expect((await orm.select({ n: count() }).from(user))[0]?.n).toBe(0);
});
