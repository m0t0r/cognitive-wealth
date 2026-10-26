import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Finding } from "@repo/cve-scan/report";
import type { CveScan } from "../dependencies";
import { createCli } from "../app";
import { dependencies, run } from "../testing";

const FINDING = {
  entry: {
    id: "CVE-2026-1",
    title: "undici vulnerable to Denial of Service",
    aliases: [],
    summary: null,
    originalDescription: null,
    severity: { cvss: 7.5 },
    statedSeverity: null,
    exploitation: { kev: { dateAdded: "2026-10-01" } },
    affected: [],
    publishedAt: null,
  },
  affects: ["npm undici@7.18.0"],
  fixedIn: ["7.30.1"],
} satisfies Finding;

type FakeScanArgs = { github?: CveScan["github"]; stepSummaryFile?: string };

/** A scan of `/repo` that finds `FINDING` and skips one advisory already reported. */
function cveScan({ github, stepSummaryFile }: FakeScanArgs = {}) {
  const env = {
    root: "/repo",
    github,
    stepSummaryFile,
    scan: vi.fn<CveScan["scan"]>(async () => ({
      packages: 412,
      findings: [FINDING],
      skipped: [{ id: "CVE-2026-2", reason: "already reported" }],
    })),
    reportedIds: vi.fn(async () => new Set(["CVE-2026-2"])),
    fileIssues: vi.fn(async () => ["https://github.com/acme/repo/issues/7"]),
  } satisfies CveScan;
  return { env, cli: createCli(dependencies({ cveScan: async () => env })) };
}

const GITHUB = { token: "t0ken", repository: "acme/repo" };

describe("cw cve scan", () => {
  it("returns the findings as data, and files nothing", async () => {
    const { env, cli } = cveScan();
    const { output, exitCode } = await run({ cli, argv: ["cve", "scan", "--since-days", "30"] });
    expect(exitCode).toBe(0);
    expect(output).toEqual({
      packages: 412,
      findings: [
        {
          id: "CVE-2026-1",
          title: "undici vulnerable to Denial of Service",
          cvss: 7.5,
          kev: true,
          affects: ["npm undici@7.18.0"],
          fixedIn: ["7.30.1"],
        },
      ],
      skipped: [{ id: "CVE-2026-2", reason: "already reported" }],
      issues: [],
    });
    const args = env.scan.mock.calls[0]![0];
    expect(args).toMatchObject({ root: "/repo", minCvss: 7, known: new Set() });
    expect(Date.now() - args.since.getTime()).toBeCloseTo(30 * 24 * 60 * 60 * 1000, -4);
    expect(env.fileIssues).not.toHaveBeenCalled();
  });

  it("with --create-issues, skips what's reported and files the rest", async () => {
    const { env, cli } = cveScan({ github: GITHUB });
    const { output } = await run({ cli, argv: ["cve", "scan", "--create-issues"] });
    expect(output.issues).toEqual(["https://github.com/acme/repo/issues/7"]);
    expect(env.scan).toHaveBeenCalledWith(
      expect.objectContaining({ known: new Set(["CVE-2026-2"]) }),
    );
    expect(env.fileIssues).toHaveBeenCalledWith({ gh: GITHUB, findings: [FINDING] });
  });

  it("appends the report to the step summary", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cw-cve-"));
    onTestFinished(() => rm(dir, { recursive: true, force: true }));
    const stepSummaryFile = join(dir, "summary.md");
    const { cli } = cveScan({ stepSummaryFile });
    await run({ cli, argv: ["cve", "scan"] });
    expect(await readFile(stepSummaryFile, "utf8")).toMatch(
      /^## cve\.now scan\n[\s\S]*\[CVE-2026-1\]\(https:\/\/cve\.now\/CVE-2026-1\)/,
    );
  });

  it("refuses --create-issues without GitHub as no_github, before scanning", async () => {
    const { env, cli } = cveScan();
    const { output, exitCode } = await run({ cli, argv: ["cve", "scan", "--create-issues"] });
    expect(exitCode).toBe(1);
    expect(output).toMatchObject({ code: "no_github" });
    expect(env.scan).not.toHaveBeenCalled();
  });

  it.for([
    ["--since-days", "0"],
    ["--since-days", "1.5"],
    ["--min-cvss", "high"],
  ])("refuses %s %s as VALIDATION_ERROR", async ([flag, value]) => {
    const { cli } = cveScan();
    const { output, exitCode } = await run({ cli, argv: ["cve", "scan", flag!, value!] });
    expect(exitCode).toBe(1);
    expect(output).toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
