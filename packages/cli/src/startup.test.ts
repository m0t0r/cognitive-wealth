import { startupFailure } from "./startup";

const missing = Object.assign(
  new Error("Cannot find package '@repo/db' imported from /repo/packages/cli/src/cli.ts"),
  { code: "ERR_MODULE_NOT_FOUND" },
);

describe("startupFailure", () => {
  it.for([["--json"], ["--format", "json"], ["--format=json"]])(
    "gives the error envelope when asked for JSON (%s)",
    (flags) => {
      const printed = startupFailure({ error: missing, argv: ["dev", "prune", ...flags] });
      expect(JSON.parse(printed ?? "")).toEqual({
        code: "ERR_MODULE_NOT_FOUND",
        message: "Cannot find package '@repo/db' imported from /repo/packages/cli/src/cli.ts",
        retryable: false,
      });
    },
  );

  it("names an error without a code UNKNOWN, as incur does", () => {
    const printed = startupFailure({ error: new Error("boom"), argv: ["--json"] });
    expect(JSON.parse(printed ?? "")).toMatchObject({ code: "UNKNOWN", message: "boom" });
  });

  it("leaves the error to Node without --json", () => {
    expect(startupFailure({ error: missing, argv: ["dev", "prune"] })).toBeUndefined();
  });
});
