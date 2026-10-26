import { CliError } from "./organizations";
import { isInside, parseExportArgs } from "./records-export";

const usage = "Usage: pnpm org:export …";

describe("parseExportArgs", () => {
  it("reads --slug, --out and --reason", () => {
    expect(
      parseExportArgs({
        args: ["--slug", "Acme", "--out", "exports/acme", "--reason", " SEC exam request "],
        usage,
      }),
    ).toEqual({ help: false, slug: "acme", out: "exports/acme", reason: "SEC exam request" });
  });

  it("skips pnpm's -- separator", () => {
    expect(
      parseExportArgs({ args: ["--", "--slug", "acme", "--out", "x", "--reason", "r"], usage }),
    ).toMatchObject({ slug: "acme" });
  });

  it.for([
    [["--slug", "acme", "--out", "x"], "--reason"],
    [["--slug", "acme", "--reason", "r"], "--out"],
    [["--reason", "r"], "--slug, --out"],
  ] as const)("names a missing option, then the usage (%j)", ([args, missing]) => {
    expect(() => parseExportArgs({ args: [...args], usage })).toThrow(
      new CliError(`Missing ${missing}.\n\n${usage}`),
    );
  });

  it("refuses an empty reason", () => {
    expect(() =>
      parseExportArgs({ args: ["--slug", "acme", "--out", "x", "--reason", " "], usage }),
    ).toThrow(/reason is empty/);
  });

  it("answers --help", () => {
    expect(parseExportArgs({ args: ["--help"], usage })).toEqual({ help: true });
  });
});

describe("isInside", () => {
  it.for([
    ["/repo/exports/acme", true],
    ["/repo", true],
    ["/repository/acme", false],
    ["/elsewhere/acme", false],
  ] as const)("%s is inside /repo: %s", ([path, inside]) => {
    expect(isInside({ path, root: "/repo" })).toBe(inside);
  });
});
