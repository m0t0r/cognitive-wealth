// `cw org …`: the operator's way to create an organization, export a Firm's records (#206), and
// deactivate a Firm that leaves or bring one back (ADR 0022), on any database, production
// included. Each one writes, so none is ever an MCP tool (`mcp: false`; ADR 0026).
import { Cli, z } from "incur";
import type { OrganizationStatusChange } from "@repo/db/cli/organizations";
import type { Dependencies } from "../dependencies.ts";
import { REPO_ROOT, fromInvocation } from "../paths.ts";
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

const createOptions = z.object({
  name: z.string().describe("The organization's display name"),
  slug: z
    .string()
    .optional()
    .describe("a-z, 0-9 and single hyphens, at most 48 characters; made from --name if left out"),
  owner: z
    .string()
    .describe("The owner's email address, stored lowercase; a new user sets their name on sign-in"),
  dryRun: z
    .boolean()
    .default(false)
    .describe("Make every write and check, then roll back: nothing is written"),
});

const createOutput = z.object({
  database: z.string().describe("The database it ran on, without its password"),
  publicId: z.string().describe("With --dry-run, one it would have had: each run draws a new one"),
  name: z.string(),
  slug: z.string(),
  owner: z.object({
    email: z.string(),
    created: z.boolean().describe("true for a new user, who sets their name on first sign-in"),
  }),
  dryRun: z.boolean().describe("true when nothing was written"),
});

const exportOptions = z.object({
  slug: z.string().describe("The organization's slug"),
  out: z.string().describe("A new or empty folder to write into (made 0700, its files 0600)"),
  reason: z
    .string()
    .describe(
      "Who asked and why, for the audit log (org.records_exported); at most 500 characters",
    ),
  dryRun: z
    .boolean()
    .default(false)
    .describe("Make the same checks and count each table's rows; write no file and no audit event"),
});

const exportOutput = z.object({
  database: z.string().describe("The database and role it read as, without the password"),
  publicId: z.string(),
  name: z.string(),
  slug: z.string(),
  state: z.enum(["active", "deactivated"]),
  out: z.string().describe("The folder written, absolute"),
  exportedAt: z.string().describe("The snapshot's moment, ISO 8601"),
  manifestHash: z.string().nullable().describe("manifest.json's SHA-256; null with --dry-run"),
  tables: z
    .array(z.object({ table: z.string(), file: z.string(), rows: z.number() }))
    .describe("One CSV per record table, with the Firm's row count"),
  warnings: z.array(z.string()).describe("Things to fix that didn't stop the export"),
  dryRun: z.boolean().describe("true when nothing was written"),
});

async function createOrganization({
  input,
  openDatabase,
}: Pick<ChangeStatusArgs, "openDatabase"> & { input: z.output<typeof createOptions> }) {
  const {
    createOrganization: create,
    normalizeSlug,
    parseOwnerEmail,
    slugFromName,
  } = await import("@repo/db/cli/organizations");
  // Checked before connecting, so a typo is `invalid_input` even where there's no database.
  const checked = {
    name: input.name,
    slug: input.slug === undefined ? slugFromName(input.name) : normalizeSlug(input.slug),
    ownerEmail: parseOwnerEmail(input.owner),
    dryRun: input.dryRun,
  };
  const { db, close, target, local } = await openDatabase();
  try {
    const created = await create(db, checked);
    return { data: { database: target, ...created }, local };
  } finally {
    await close();
  }
}

async function exportRecords({
  input,
  openDatabase,
}: Pick<ChangeStatusArgs, "openDatabase"> & { input: z.output<typeof exportOptions> }) {
  const { exportRecords: write, isInside } = await import("@repo/db/cli/records-export");
  const { normalizeSlug, parseReason } = await import("@repo/db/cli/organizations");
  // Checked before connecting, as `changeStatus` does.
  normalizeSlug(input.slug);
  parseReason(input.reason);
  const out = fromInvocation(input.out);
  const warnings = isInside({ path: out, root: REPO_ROOT })
    ? [
        `${out} is inside the repository. The export holds clients' personal information; keep ` +
          "it out of the repository and anything that syncs it.",
      ]
    : [];
  const { db, close, target } = await openDatabase({ asMigrator: true });
  try {
    const exported = await write(db, { ...input, out });
    return {
      database: target,
      ...exported.firm,
      state: exported.firmState,
      out: exported.out,
      exportedAt: exported.exportedAt.toISOString(),
      manifestHash: exported.manifestHash,
      tables: exported.tables,
      warnings,
      dryRun: exported.dryRun,
    };
  } finally {
    await close();
  }
}

export function orgCommands({ openDatabase }: Pick<Dependencies, "openDatabase">) {
  return Cli.create("org", {
    description: "A Firm's lifecycle: create, export its records, deactivate and reactivate",
  })
    .command("create", {
      description:
        "Create an organization and make <owner> its owner, creating that user if needed: the " +
        "invite-only way in, on any database, production included",
      options: createOptions,
      output: createOutput,
      mcp: false,
      examples: [
        {
          options: { name: "Acme", owner: "ceo@acme.test", dryRun: true },
          description: "Check what it would do",
        },
      ],
      async run(c) {
        try {
          const { data, local } = await createOrganization({ input: c.options, openDatabase });
          const commands = c.options.dryRun
            ? [
                {
                  command: "org create",
                  options: {
                    name: shellQuoted(data.name),
                    slug: data.slug,
                    owner: shellQuoted(data.owner.email),
                  },
                  description: "Create it for real",
                },
              ]
            : local
              ? [
                  {
                    command: "dev sign-in",
                    args: { email: shellQuoted(data.owner.email) },
                    description: "Sign the owner in to pnpm dev",
                  },
                ]
              : [];
          return c.ok(data, commands.length > 0 ? { cta: { commands } } : undefined);
        } catch (error) {
          return c.error(refusal(error));
        }
      },
    })
    .command("export", {
      description:
        "Write a Firm's Records export, active or deactivated: one CSV per record table, " +
        "manifest.json and README.md, read in one snapshot as migrator and audited as " +
        "org.records_exported",
      hint:
        "It holds nonpublic personal information: encrypting and delivering it are up to you. On " +
        "a local database it signs in as migrator itself; anywhere else DATABASE_URL must name it.",
      options: exportOptions,
      output: exportOutput,
      mcp: false,
      async run(c) {
        try {
          const data = await exportRecords({ input: c.options, openDatabase });
          if (!c.options.dryRun) return data;
          return c.ok(data, {
            cta: {
              commands: [
                {
                  command: "org export",
                  options: {
                    slug: data.slug,
                    out: shellQuoted(data.out),
                    reason: shellQuoted(c.options.reason),
                  },
                  description: "Export it for real",
                },
              ],
            },
          });
        } catch (error) {
          return c.error(refusal(error));
        }
      },
    })
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
