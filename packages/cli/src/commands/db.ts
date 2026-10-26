// `cw db seed`: adds the dev users and Firms in docs/dev-sign-in.md to a local database, then the
// world file's CRM half to the world's Firm, in one transaction (`@repo/households`'
// `seedDevWorld`). Local databases only. It writes, so it's never an MCP tool (ADR 0026).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Cli, z } from "incur";
import { CliError } from "@repo/db/cli/cli-error";
import type { Dependencies } from "../dependencies.ts";
import { REPO_ROOT, fromInvocation } from "../paths.ts";
import { refusal } from "../refusal.ts";

const WORLD_FILE = join(REPO_ROOT, "world/v0.json");

const output = z.object({
  database: z.string().describe("The database it ran on, without its password"),
  added: z
    .object({
      users: z.number(),
      organizations: z.number(),
      memberships: z.number(),
      households: z.number(),
      people: z.number(),
      accounts: z.number(),
      accountRoles: z.number(),
    })
    .describe("Rows this run added; existing rows are left as they are"),
  renamedOrganizations: z
    .number()
    .describe("1 when the old seeded Acme was renamed to Larkspur, keeping its members"),
  organizations: z
    .array(
      z.object({
        name: z.string(),
        slug: z.string(),
        members: z.array(z.object({ email: z.string(), role: z.string() })),
      }),
    )
    .describe("The dev Firms and who is in them, for signing in"),
  dryRun: z.boolean().describe("true when nothing was written"),
});

type SeedArgs = {
  world: string;
  dryRun: boolean;
  openDatabase: Dependencies["openDatabase"];
};

async function seed({ world: worldFile, dryRun, openDatabase }: SeedArgs) {
  const { TransactionRollbackError } = await import("drizzle-orm");
  const { SeedConflict, seedDevWorld } = await import("@repo/households/seed");
  const world: unknown = JSON.parse(await readFile(worldFile, "utf8"));
  const { db, close, target, local } = await openDatabase();
  try {
    if (!local) {
      throw new CliError({
        code: "not_local",
        message:
          `Refusing to seed ${target}: the seed is for local development databases only ` +
          "(localhost, 127.0.0.1, ::1 and *.localhost, with NODE_ENV not production).",
      });
    }
    let seeded: Awaited<ReturnType<typeof seedDevWorld>> | undefined;
    try {
      // The seed is one transaction; a dry run wraps it in another and rolls that back.
      await db.transaction(async (tx) => {
        seeded = await seedDevWorld(tx, world);
        if (dryRun) tx.rollback();
      });
    } catch (error) {
      if (error instanceof SeedConflict) {
        throw new CliError({
          code: "seed_conflict",
          message:
            `${error.message}. The world file changed since this database was seeded, and a row ` +
            "seeded from the old file now differs (in the new file, or edited in the app); the " +
            "seed never overwrites, so nothing was written. To load the new world, start the " +
            "database over (docs/dev-sign-in.md: `down -v`; in a worktree, `pnpm cw dev " +
            "teardown`, then `pnpm dev`), migrate and seed again.",
        });
      }
      if (!(dryRun && error instanceof TransactionRollbackError)) throw error;
    }
    if (seeded === undefined) throw new Error("The transaction ended without a result");
    return { database: target, ...seeded };
  } finally {
    await close();
  }
}

export function dbCommands({ openDatabase }: Pick<Dependencies, "openDatabase">) {
  return Cli.create("db", { description: "The development database" }).command("seed", {
    description:
      "Add the dev users and Firms (owner@, admin@ and member@cognitive-wealth.test; Larkspur " +
      "and Globex) to a local database, then the world file's Households, People, Accounts and " +
      "Account roles to Larkspur",
    hint:
      "Idempotent: existing rows are left as they are. Refuses a remote database, NODE_ENV " +
      "production, and a changed world file whose earlier rows now differ (seed_conflict).",
    options: z.object({
      world: z
        .string()
        .default(WORLD_FILE)
        .describe("The world file to load; world/v0.json by default"),
      dryRun: z.boolean().default(false).describe("Seed, then roll back: nothing is written"),
    }),
    output,
    mcp: false,
    async run(c) {
      try {
        const { database, devData, crm } = await seed({
          world: fromInvocation(c.options.world),
          dryRun: c.options.dryRun,
          openDatabase,
        });
        const { SEED_ORGANIZATIONS, SEED_USERS } = await import("@repo/db/seed-data");
        const organizations = SEED_ORGANIZATIONS.map(({ name, slug }) => ({
          name,
          slug,
          members: SEED_USERS.flatMap(({ email, roles }) => {
            const role = roles[slug];
            return role ? [{ email, role }] : [];
          }),
        }));
        const data = {
          database,
          added: {
            ...devData.added,
            households: crm.added.households,
            people: crm.added.people,
            accounts: crm.added.accounts,
            accountRoles: crm.added.accountRoles,
          },
          renamedOrganizations: devData.renamed.organizations,
          organizations,
          dryRun: c.options.dryRun,
        };
        const commands = c.options.dryRun
          ? [{ command: "db seed", description: "Seed it for real" }]
          : [
              {
                command: "dev sign-in",
                args: { email: SEED_USERS[0]!.email },
                description: "Sign in to pnpm dev",
              },
            ];
        return c.ok(data, { cta: { commands } });
      } catch (error) {
        return c.error(refusal(error));
      }
    },
  });
}
