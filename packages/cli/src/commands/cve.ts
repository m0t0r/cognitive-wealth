// `cw cve scan`: checks what the repository pins against cve.now (ADR 0024) and returns what it
// finds. With `--create-issues`, which the weekly workflow (`.github/workflows/cve-now.yml`)
// passes, it files one issue per new finding; it never changes code. GitHub's token and repository,
// when set, also skip what's already reported, and a workflow step gets the report as its summary.
// It can write (issues), so it's never an MCP tool (ADR 0026). The workflow installs only `cw`'s
// and the scan's own dependencies, so this file loads nothing else.
import { appendFile } from "node:fs/promises";
import { Cli, z } from "incur";
import { CliError } from "@repo/db/cli/cli-error";
import type { Dependencies } from "../dependencies.ts";
import { refusal } from "../refusal.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

const output = z.object({
  packages: z
    .number()
    .describe("Packages checked, from pnpm-lock.yaml and the custodian's uv.lock"),
  findings: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        cvss: z.number().nullable(),
        kev: z.boolean().describe("In CISA's Known Exploited Vulnerabilities catalog"),
        affects: z.array(z.string()).describe("What the stack pins that the advisory names"),
        fixedIn: z.array(z.string()).describe("The first fixed version of each that has one"),
      }),
    )
    .describe("New advisories over the bar that affect what we pin"),
  skipped: z
    .array(z.object({ id: z.string(), reason: z.string() }))
    .describe("Matched, but already reported or under the bar"),
  issues: z.array(z.string()).describe("The issues filed, with --create-issues"),
});

export function cveCommands({ cveScan }: Pick<Dependencies, "cveScan">) {
  return Cli.create("cve", { description: "Vulnerabilities in what the repository pins" }).command(
    "scan",
    {
      description:
        "Check the lockfiles' packages and the pinned PostgreSQL, Redis and Node.js against " +
        "cve.now, and return what's new",
      hint:
        "Read-only without --create-issues. With GITHUB_TOKEN and GITHUB_REPOSITORY set, what's " +
        "already reported (the scan's issues, Dependabot's alerts) is skipped.",
      options: z.object({
        createIssues: z
          .boolean()
          .default(false)
          .describe("File one issue per new finding (needs GITHUB_TOKEN and GITHUB_REPOSITORY)"),
        minCvss: z.coerce
          .number()
          .default(7)
          .describe("The lowest CVSS score reported; CISA KEV entries are, whatever their score"),
        sinceDays: z.coerce
          .number()
          .int()
          .min(1)
          .default(14)
          .describe("How far back the PostgreSQL, Redis and Node.js feeds are read"),
      }),
      output,
      mcp: false,
      async run(c) {
        const { createIssues, minCvss, sinceDays } = c.options;
        try {
          const { root, github, stepSummaryFile, scan, reportedIds, fileIssues } = await cveScan();
          if (createIssues && !github) {
            throw new CliError({
              code: "no_github",
              message: "--create-issues needs GITHUB_TOKEN and GITHUB_REPOSITORY",
            });
          }
          const result = await scan({
            root,
            minCvss,
            since: new Date(Date.now() - sinceDays * DAY_MS),
            known: github ? await reportedIds(github) : new Set(),
          });
          if (stepSummaryFile) {
            const { stepSummary } = await import("@repo/cve-scan/publish");
            await appendFile(stepSummaryFile, `${stepSummary(result)}\n`);
          }
          const issues = createIssues && github ? await fileIssues(github, result.findings) : [];
          return {
            packages: result.packages,
            findings: result.findings.map(({ entry, affects, fixedIn }) => ({
              id: entry.id,
              title: entry.title,
              cvss: entry.severity?.cvss ?? null,
              kev: Boolean(entry.exploitation?.kev),
              affects,
              fixedIn,
            })),
            skipped: result.skipped,
            issues,
          };
        } catch (error) {
          return c.error(refusal(error));
        }
      },
    },
  );
}
