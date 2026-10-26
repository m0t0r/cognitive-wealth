import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { CliError, REASON_MAX_LENGTH, parseOrganizationStatusArgs } from "./organizations";

const USAGE = "Usage: test";
const parse = (args: string[]) => parseOrganizationStatusArgs({ args, usage: USAGE });

describe("parseOrganizationStatusArgs", () => {
  it("reads --slug and --reason, trimmed", () => {
    expect(parse(["--slug", " Acme ", "--reason", "  Moved to Initech "])).toEqual({
      help: false,
      slug: "acme",
      reason: "Moved to Initech",
    });
  });

  it("drops the -- pnpm passes through", () => {
    expect(parse(["--", "--slug", "acme", "--reason", "Closed"])).toMatchObject({ slug: "acme" });
  });

  it("asks for help", () => {
    expect(parse(["--help"])).toEqual({ help: true });
  });

  it.for<{ name: string; args: string[] }>([
    { name: "no --reason", args: ["--slug", "acme"] },
    { name: "no --slug", args: ["--reason", "Closed"] },
    { name: "nothing", args: [] },
  ])("prints the usage with $name", ({ args }) => {
    expect(() => parse(args)).toThrow(new CliError(USAGE));
  });

  it.for<{ name: string; args: string[]; message: RegExp }>([
    {
      name: "an empty reason",
      args: ["--slug", "acme", "--reason", "  "],
      message: /reason is empty/,
    },
    {
      name: "a reason that's too long",
      args: ["--slug", "acme", "--reason", "x".repeat(REASON_MAX_LENGTH + 1)],
      message: /longer than 500/,
    },
    {
      name: "an invalid slug",
      args: ["--slug", "Acme Corp", "--reason", "Closed"],
      message: /Invalid slug/,
    },
    {
      name: "an unknown option",
      args: ["--slug", "acme", "--reason", "x", "--force"],
      message: /--force/,
    },
  ])("refuses $name", ({ args, message }) => {
    expect(() => parse(args)).toThrow(message);
  });
});

const CLI = join(import.meta.dirname, "org-status.ts");

// No environment at all, so no DATABASE_URL: every case here stops before connecting.
const run = (args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: {} });

// Each case starts Node on the CLI, which loads its imports through type stripping: 1-2s each, and
// over 5s for the first on a busy CI runner (turbo runs every package's tests at once).
describe("org-status.ts under plain Node", { timeout: 30_000 }, () => {
  it.for(["deactivate", "reactivate"])("%s --help prints its usage", (command) => {
    const result = run([command, "--help"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Usage: pnpm org:${command} --slug <slug> --reason <text>`);
  });

  it.for(["deactivate", "reactivate"])("%s without --reason exits 1", (command) => {
    const result = run([command, "--slug", "acme"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Usage: pnpm org:${command}`);
  });

  it("refuses an unknown command", () => {
    const result = run(["delete", "--slug", "acme", "--reason", "x"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deactivate|reactivate");
  });
});
