// `cw org deactivate` and `cw org reactivate` (ADR 0022): the operator's way to deactivate a Firm
// that leaves, and to bring one back, on any database, production included. Both write, so
// neither is ever an MCP tool (`mcp: false`; ADR 0026).
import { Cli, z } from "incur";
import type { OrganizationStatusChange } from "@repo/db/cli/organizations";
import type { Dependencies } from "../dependencies.ts";
import { refusal } from "../refusal.ts";

const options = z.object({
  slug: z.string().describe("The organization's slug: a-z, 0-9 and single hyphens"),
  reason: z
    .string()
    .describe(
      "Why, for the audit log (org.deactivated or org.reactivated); at most 500 characters",
    ),
  dryRun: z
    .boolean()
    .default(false)
    .describe("Make every check and count, then roll back: nothing is written"),
});

const output = z.object({
  database: z.string().describe("The database it ran on, without its password"),
  publicId: z.string(),
  name: z.string(),
  slug: z.string(),
  at: z.string().describe("When it was (or, with --dry-run, would have been) changed, ISO 8601"),
  canceledInvitations: z.number().describe("Pending invitations canceled; 0 for reactivate"),
  dryRun: z.boolean().describe("true when nothing was written"),
});

type Change = "deactivate" | "reactivate";

type ChangeStatusArgs = {
  change: Change;
  input: z.output<typeof options>;
  openDatabase: Dependencies["openDatabase"];
};

async function changeStatus({ change, input, openDatabase }: ChangeStatusArgs) {
  // Loaded here, not at the top, because the schema it imports is bundler-style (the entry's
  // `registerTsResolution()` must run first), and so `cw dev …` doesn't load it at all.
  const { deactivateOrganization, normalizeSlug, parseReason, reactivateOrganization } =
    await import("@repo/db/cli/organizations");
  const run = change === "deactivate" ? deactivateOrganization : reactivateOrganization;
  // Checked before connecting, so a typo is `invalid_input` even where there's no database.
  const checked = { ...input, slug: normalizeSlug(input.slug), reason: parseReason(input.reason) };
  const { db, close, target } = await openDatabase();
  try {
    const result: OrganizationStatusChange = await run(db, checked);
    return { database: target, ...result, at: result.at.toISOString() };
  } finally {
    await close();
  }
}

/**
 * `value` quoted for a POSIX shell when it needs it. incur writes a CTA's option values as they
 * are, so `--reason Contract ended` would run with the reason `Contract`.
 */
export function shellQuoted(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

/** The command that would undo `change`, or with `dryRun` the one that makes it for real. */
function next({ change, input }: Pick<ChangeStatusArgs, "change" | "input">) {
  if (input.dryRun) {
    return {
      command: `org ${change}`,
      options: { slug: shellQuoted(input.slug), reason: shellQuoted(input.reason) },
      description: `${change === "deactivate" ? "Deactivate" : "Reactivate"} it for real`,
    };
  }
  const undo: Change = change === "deactivate" ? "reactivate" : "deactivate";
  return {
    command: `org ${undo}`,
    options: { slug: shellQuoted(input.slug), reason: true },
    description: "Undo it",
  };
}

export function orgCommands({ openDatabase }: Pick<Dependencies, "openDatabase">) {
  return Cli.create("org", { description: "A Firm's lifecycle: deactivate and reactivate" })
    .command("deactivate", {
      description:
        "Deactivate a Firm that leaves (ADR 0022): its records and members are kept, its pending " +
        "invitations are canceled, and from their next request its members can't act in it",
      hint: "Nobody is signed out. Undo it with org reactivate.",
      options,
      output,
      mcp: false,
      examples: [
        {
          options: { slug: "acme", reason: "Contract ended", dryRun: true },
          description: "Check what it would do",
        },
      ],
      async run(c) {
        try {
          const data = await changeStatus({ change: "deactivate", input: c.options, openDatabase });
          return c.ok(data, {
            cta: { commands: [next({ change: "deactivate", input: c.options })] },
          });
        } catch (error) {
          return c.error(refusal(error));
        }
      },
    })
    .command("reactivate", {
      description: "Reactivate a deactivated Firm: its members find it again on their next request",
      hint: "Invitations canceled when it was deactivated stay canceled.",
      options,
      output,
      mcp: false,
      async run(c) {
        try {
          const data = await changeStatus({ change: "reactivate", input: c.options, openDatabase });
          return c.ok(data, {
            cta: { commands: [next({ change: "reactivate", input: c.options })] },
          });
        } catch (error) {
          return c.error(refusal(error));
        }
      },
    });
}
