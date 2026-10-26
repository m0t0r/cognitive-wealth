// `cw friction …`: friction reports (docs/agents/friction.md) from filing to fix. An agent runs
// `search` and `report` at the end of a task; `friction-triage.yml` runs `triage` when the label
// lands, and `friction-fix.yml` runs `fix` on the `ready-for-agent` ones. The rules are
// `@repo/friction-bot`'s (`reports.ts`); this is their options, output and codes. Every command but
// `search` writes (to GitHub, or the checkout), so none is an MCP tool (ADR 0026).
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Cli, z } from "incur";
import { CliError } from "@repo/db/cli/cli-error";
import type { Dependencies } from "../dependencies.ts";
import { refusal } from "../refusal.ts";
import { shellQuoted } from "../shell-quoted.ts";

const issueNumber = z.coerce.number().int().positive();

const summary = z.object({
  number: z.number(),
  title: z.string(),
  state: z.enum(["open", "closed"]),
  labels: z.array(z.string()),
  url: z.string(),
});

const triageAction = z.union([
  z.object({
    kind: z.literal("label"),
    number: z.number(),
    add: z.array(z.string()),
    remove: z.array(z.string()),
  }),
  z.object({ kind: z.literal("comment"), number: z.number(), body: z.string() }),
  z.object({ kind: z.literal("close"), number: z.number(), comment: z.string() }),
]);

const reportOptions = z.object({
  title: z.string().optional().describe("A short description; needed unless --on"),
  what: z.string().optional().describe('"What happened": observed vs. expected, exact error text'),
  cost: z.string().optional().describe('"Cost": what it blocked or how long it took'),
  where: z.string().optional().describe('"Where": files, commands, docs or skills involved'),
  fix: z.string().optional().describe('"Suggested fix", checked against the hard rules first'),
  bodyFile: z
    .string()
    .optional()
    .describe("A Markdown file to send as the whole body instead of --what/--cost/--where/--fix"),
  on: issueNumber
    .optional()
    .describe("An existing report to comment on with this occurrence, instead of filing one"),
  dryRun: z.boolean().default(false).describe("Show the body and where it would go; send nothing"),
});

type ReportInput = z.output<typeof reportOptions>;

/** An option's name as its flag spells it: `bodyFile` → `body-file`. */
const kebab = (name: string) => name.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/** The report's body from --body-file or the sections; `invalid_input` for a mix or neither. */
async function bodyOf(input: ReportInput): Promise<string> {
  const { reportBody } = await import("@repo/friction-bot/reports");
  const sections = [input.what, input.cost, input.where, input.fix].some((text) => text?.trim());
  if (input.bodyFile && sections) {
    throw new CliError(
      "Give --body-file or the sections (--what, --cost, --where, --fix), not both.",
    );
  }
  if (input.bodyFile) return await readFile(input.bodyFile, "utf8");
  if (!input.what?.trim() || !input.cost?.trim() || !input.where?.trim()) {
    throw new CliError("--what, --cost and --where are each needed (or --body-file).");
  }
  return reportBody({ what: input.what, cost: input.cost, where: input.where, fix: input.fix });
}

export function frictionCommands({ github, claude }: Pick<Dependencies, "github" | "claude">) {
  return Cli.create("friction", {
    description: "Friction reports (docs/agents/friction.md): search, file, triage and fix them",
  })
    .command("search", {
      description:
        "Friction reports matching some words, newest first: run it before report, and comment " +
        "on a match (report --on) instead of filing a duplicate",
      args: z.object({
        words: z.array(z.string()).optional().describe("GitHub search terms; all reports if none"),
      }),
      options: z.object({
        closed: z.boolean().default(false).describe("Include closed reports"),
      }),
      output: z.object({ reports: z.array(summary) }),
      examples: [{ args: { words: ["worktree", "heredoc"] }, description: "Look for a match" }],
      mcp: false,
      async run(c) {
        try {
          const { searchReports } = await import("@repo/friction-bot/reports");
          const found = await searchReports(await github(), {
            search: (c.args.words ?? []).join(" "),
            closed: c.options.closed,
          });
          const reports = found.map(({ number, title, state, labels, url }) => ({
            number,
            title,
            state,
            labels,
            url,
          }));
          const first = reports.find(({ state }) => state === "open");
          return c.ok(
            { reports },
            {
              cta: {
                commands: [
                  ...(first
                    ? [
                        {
                          command: "friction report",
                          options: { on: first.number },
                          description: `Add an occurrence to #${first.number}, if it's the same cause`,
                        },
                      ]
                    : []),
                  { command: "friction report", description: "File a new report" },
                ],
              },
            },
          );
        } catch (error) {
          return c.error(refusal(error));
        }
      },
    })
    .command("report", {
      description:
        "File a friction report with the friction label, or with --on add an occurrence to an " +
        "existing one. The body is friction.md's sections, from --what, --cost, --where and --fix",
      hint: "Each section is one argument; for multi-line text write a Markdown file and pass --body-file.",
      options: reportOptions,
      output: z.object({
        dryRun: z.boolean().describe("true when nothing was sent"),
        action: z.enum(["created", "commented"]),
        number: z.number().nullable().describe("The report; null when a dry run would file one"),
        url: z.string().nullable().describe("The new report or comment; null on a dry run"),
        title: z.string().nullable(),
        body: z.string(),
      }),
      examples: [
        {
          options: {
            title: "pnpm lint fails on warnings, but nothing says so",
            what: "pnpm lint exited 1 on a warning",
            cost: "10 minutes",
            where: ".oxlintrc.json, CLAUDE.md",
            dryRun: true,
          },
          description: "Check the body before filing",
        },
      ],
      mcp: false,
      async run(c) {
        try {
          const input = c.options;
          const body = await bodyOf(input);
          if (input.on === undefined && !input.title?.trim()) {
            throw new CliError("--title is needed to file a report (or --on to comment on one).");
          }
          const { FRICTION } = await import("@repo/friction-bot/reports");
          const action: "created" | "commented" = input.on === undefined ? "created" : "commented";
          if (input.dryRun) {
            // Spelled out, since incur writes a CTA's option values unquoted (`shellQuoted`).
            const { dryRun: _dryRun, ...given } = input;
            const flags = Object.entries(given)
              .filter(([, value]) => value !== undefined)
              .map(([name, value]) => `--${kebab(name)} ${shellQuoted(String(value))}`);
            return c.ok(
              {
                dryRun: true,
                action,
                number: input.on ?? null,
                url: null,
                title: input.title ?? null,
                body,
              },
              {
                cta: {
                  commands: [
                    { command: `friction report ${flags.join(" ")}`, description: "Send it" },
                  ],
                },
              },
            );
          }
          const gh = await github();
          if (input.on !== undefined) {
            const target = await gh.view(input.on);
            if (!target.labels.includes(FRICTION)) {
              throw new CliError({
                code: "not_a_friction_report",
                message: `#${input.on} has no ${FRICTION} label.`,
              });
            }
            const { url } = await gh.comment({ number: input.on, body });
            return { dryRun: false, action, number: input.on, url, title: target.title, body };
          }
          const title = input.title!.trim();
          const { number, url } = await gh.create({ title, body, labels: [FRICTION] });
          return { dryRun: false, action, number, url, title, body };
        } catch (error) {
          return c.error(refusal(error));
        }
      },
    })
    .command("triage", {
      description:
        "Triage one friction report with Haiku: label it ready-for-agent or ready-for-human, or " +
        "close it as a duplicate with a comment on the original. friction-triage.yml runs it",
      hint: "Needs ANTHROPIC_API_KEY. A dry run still asks Haiku (well under a cent) but changes nothing on GitHub.",
      args: z.object({ issue: issueNumber.describe("The report's issue number") }),
      options: z.object({
        retriage: z
          .boolean()
          .default(false)
          .describe("Triage it again although it has a triage label; the new label replaces it"),
        dryRun: z.boolean().default(false).describe("Ask Haiku and show the actions; do none"),
      }),
      output: z.object({
        issue: z.number(),
        status: z.enum(["triaged", "already_triaged"]),
        decision: z.enum(["ready-for-agent", "ready-for-human", "duplicate"]).optional(),
        duplicateOf: z.number().nullable().optional(),
        reason: z.string().optional(),
        labels: z.array(z.string()).optional().describe("Its triage labels, when already triaged"),
        actions: z
          .array(triageAction)
          .describe("What was (or with --dry-run, would be) done, in order"),
        dryRun: z.boolean(),
      }),
      examples: [{ args: { issue: 240 }, options: { dryRun: true }, description: "Preview it" }],
      mcp: false,
      async run(c) {
        try {
          const { triageReport } = await import("@repo/friction-bot/reports");
          const gh = await github();
          const { triage } = await claude();
          const outcome = await triageReport(gh, {
            number: c.args.issue,
            decide: triage,
            retriage: c.options.retriage,
            dryRun: c.options.dryRun,
          });
          const data = { issue: c.args.issue, ...outcome, dryRun: c.options.dryRun };
          if (outcome.status === "already_triaged") {
            return c.ok(data, {
              cta: {
                commands: [
                  {
                    command: `friction triage ${c.args.issue}`,
                    options: { retriage: true, dryRun: true },
                    description: "See what triage would decide now",
                  },
                ],
              },
            });
          }
          if (!c.options.dryRun) return data;
          return c.ok(data, {
            cta: {
              commands: [
                {
                  command: `friction triage ${c.args.issue}`,
                  options: c.options.retriage ? { retriage: true } : {},
                  description: "Apply it",
                },
              ],
            },
          });
        } catch (error) {
          return c.error(refusal(error));
        }
      },
    })
    .command("fix", {
      description:
        "Fix friction reports in this checkout with Sonnet in a tool loop, and say which it fixed " +
        "and which it passed on. friction-fix.yml runs it on a throwaway checkout and commits",
      hint:
        "Needs ANTHROPIC_API_KEY. It edits files (never .claude/hooks/, .claude/settings*.json, " +
        ".github/ or .git/) and runs pnpm checks without the API key or GitHub token. It doesn't commit.",
      args: z.object({
        issues: z.array(issueNumber).describe("The reports' issue numbers"),
      }),
      options: z.object({
        maxSteps: z.coerce.number().int().positive().default(150).describe("Tool-loop step limit"),
        maxCostUsd: z.coerce.number().positive().default(5).describe("Stop at about this spend"),
        checkout: z
          .string()
          .optional()
          .describe(
            "The checkout to fix, when it isn't the one cw runs from: friction-fix.yml runs cw " +
              "from dev, so a fix on the bot's branch can't change the fixer's own code",
          ),
        dryRun: z
          .boolean()
          .default(false)
          .describe("Gather the reports and show them; don't call Sonnet or touch a file"),
      }),
      output: z.object({
        dryRun: z.boolean(),
        reports: z.array(z.object({ number: z.number(), title: z.string() })),
        fixed: z.array(z.object({ number: z.number(), summary: z.string() })),
        skipped: z.array(z.object({ number: z.number(), reason: z.string() })),
        friction: z
          .array(
            z.object({
              title: z.string(),
              what: z.string(),
              cost: z.string(),
              where: z.string(),
              fix: z.string(),
            }),
          )
          .describe(
            "What made the fix harder, to file as new reports (friction report); at most 3",
          ),
        steps: z.number(),
        costUsd: z.number().describe("Estimated from token usage at Sonnet 5.5's price"),
      }),
      mcp: false,
      async run(c) {
        try {
          const numbers = [...new Set(c.args.issues)];
          if (numbers.length === 0) throw new CliError("Name at least one report.");
          const { gatherReports } = await import("@repo/friction-bot/reports");
          const gathered = await gatherReports(await github(), { numbers });
          const reports = gathered.map(({ number, title }) => ({ number, title }));
          if (c.options.dryRun) {
            return c.ok(
              { dryRun: true, reports, fixed: [], skipped: [], friction: [], steps: 0, costUsd: 0 },
              {
                cta: {
                  commands: [
                    { command: `friction fix ${numbers.join(" ")}`, description: "Fix them" },
                  ],
                },
              },
            );
          }
          const { MAX_FRICTION } = await import("@repo/friction-bot/fix");
          const { fix } = await claude();
          const { result, steps, costUsd } = await fix({
            numbers,
            issues: JSON.stringify(gathered),
            maxSteps: c.options.maxSteps,
            maxCostUsd: c.options.maxCostUsd,
            ...(c.options.checkout ? { root: resolve(c.options.checkout) } : {}),
          });
          // Only the reports asked for count, whatever the answer names.
          const asked = (number: number) => numbers.includes(number);
          return {
            dryRun: false,
            reports,
            fixed: result.fixed.filter(({ number }) => asked(number)),
            skipped: result.skipped.filter(({ number }) => asked(number)),
            friction: result.friction.slice(0, MAX_FRICTION),
            steps,
            costUsd,
          };
        } catch (error) {
          return c.error(refusal(error));
        }
      },
    });
}
