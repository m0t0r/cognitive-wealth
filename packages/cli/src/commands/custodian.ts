// `cw custodian ingest <date>`: Ingestion of one As-of date's Delivery from the Custodian feed into
// a Firm (by default the world file's, Larkspur), from the local folder the custodian's `feed:write`
// writes (ADR 0017). A refused Delivery fails with its reason as the code; one already ingested is
// a success that says so. It writes, so it's never an MCP tool (ADR 0026).
import { join } from "node:path";
import { Cli, z } from "incur";
import { CliError } from "@repo/db/cli/cli-error";
import type { Dependencies } from "../dependencies.ts";
import { REPO_ROOT, fromInvocation } from "../paths.ts";
import { refusal } from "../refusal.ts";
import { shellQuoted } from "../shell-quoted.ts";

// Where `pnpm --filter custodian feed:write` writes, in the same checkout (ADR 0017).
const DEFAULT_ROOT = join(REPO_ROOT, ".dev/custodian-feed");

/** Refusals that may clear on their own: the custodian may still be writing the Delivery. */
const RETRYABLE = new Set(["not_delivered", "incomplete"]);

const written = z.object({
  transactions: z.number(),
  positions: z.number(),
  prices: z.number(),
  securities: z.number().describe("Added or updated"),
  accounts: z.number().describe("Added or updated"),
});

const output = z.object({
  database: z.string().describe("The database it ran on, without its password"),
  firm: z.object({ slug: z.string(), name: z.string() }),
  asOf: z.string(),
  status: z
    .enum(["ingested", "already_ingested"])
    .describe("already_ingested: this very Delivery was ingested before, and nothing was written"),
  delivery: z.string().describe("The Delivery's folder"),
  manifestSha256: z.string(),
  written: written
    .optional()
    .describe("Rows written (with --dry-run, that would be), by what they are; only when ingested"),
  dryRun: z.boolean().describe("true when nothing was written: the Ingestion ran and rolled back"),
});

type IngestArgs = {
  asOf: string;
  firm: string;
  root: string;
  dryRun: boolean;
  openDatabase: Dependencies["openDatabase"];
};

async function ingest({ asOf, firm: slug, root, dryRun, openDatabase }: IngestArgs) {
  const { organization } = await import("@repo/db/schema");
  const { TransactionRollbackError, eq } = await import("drizzle-orm");
  const { ingestDelivery, localFeedSource } = await import("@repo/portfolio");
  const { db, close, target } = await openDatabase();
  try {
    const [firm] = await db
      .select({ id: organization.id, name: organization.name })
      .from(organization)
      .where(eq(organization.slug, slug));
    if (!firm) {
      throw new CliError({
        code: "unknown_organization",
        message: `No Firm has the slug "${slug}".`,
      });
    }
    const source = localFeedSource(root);
    let result: Awaited<ReturnType<typeof ingestDelivery>> | undefined;
    try {
      // Ingestion is one transaction; a dry run wraps it in another and rolls that back.
      await db.transaction(async (tx) => {
        result = await ingestDelivery(tx, { firmId: firm.id, asOf, source });
        if (dryRun) tx.rollback();
      });
    } catch (error) {
      if (!(dryRun && error instanceof TransactionRollbackError)) throw error;
    }
    if (result === undefined) throw new Error("The transaction ended without a result");
    return { database: target, firm: { slug, name: firm.name }, result };
  } finally {
    await close();
  }
}

export function custodianCommands({ openDatabase }: Pick<Dependencies, "openDatabase">) {
  return Cli.create("custodian", { description: "The Custodian feed" }).command("ingest", {
    description:
      "Ingest one As-of date's Delivery from the local Custodian feed into a Firm: its " +
      "Transactions, Positions and prices, and the Securities and Accounts they name",
    hint:
      "A refused Delivery writes nothing, and its reason is the error code. Write a Delivery " +
      "first with pnpm --filter custodian feed:write --date <date>.",
    args: z.object({
      asOf: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "An As-of date is YYYY-MM-DD")
        .describe("The As-of date, YYYY-MM-DD"),
    }),
    options: z.object({
      firm: z
        .string()
        // WORLD_FIRM_SLUG, written out: `@repo/db/seed-data` loads the schema, which waits for `run`.
        .default("larkspur")
        .describe("The Firm's slug; the world file's by default"),
      root: z
        .string()
        .default(DEFAULT_ROOT)
        .describe(
          "The feed's folder, with one folder per As-of date; .dev/custodian-feed by default",
        ),
      dryRun: z
        .boolean()
        .default(false)
        .describe("Make every check and write, then roll back: nothing is written"),
    }),
    output,
    mcp: false,
    async run(c) {
      const { asOf } = c.args;
      const root = fromInvocation(c.options.root);
      try {
        const { database, firm, result } = await ingest({
          asOf,
          firm: c.options.firm,
          root,
          dryRun: c.options.dryRun,
          openDatabase,
        });
        const delivery = join(root, asOf);
        if (result.status === "refused") {
          const retryable = RETRYABLE.has(result.reason);
          return c.error({
            code: result.reason,
            message:
              `Refused the Delivery for ${asOf}; nothing was written. ${result.message}.` +
              (retryable
                ? ` If the custodian is still writing it, try again once it's done ` +
                  `(pnpm --filter custodian feed:write --date ${asOf} writes it to ${root}).`
                : ""),
            retryable,
            ...(retryable && {
              cta: {
                commands: [
                  {
                    command: "custodian ingest",
                    args: { asOf },
                    options: { root: shellQuoted(root) },
                    description: "Retry once the Delivery is written",
                  },
                ],
              },
            }),
          });
        }
        const { manifestSha256 } = result;
        return {
          database,
          firm,
          asOf,
          status: result.status,
          delivery,
          manifestSha256,
          ...(result.status === "ingested" && { written: result.written }),
          dryRun: c.options.dryRun,
        };
      } catch (error) {
        return c.error(refusal(error));
      }
    },
  });
}
