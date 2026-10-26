import { createCli } from "../app";
import { dependencies, run } from "../testing";

// No database: each case here stops before connecting, and `dependencies()` fails one that doesn't.
const cli = createCli(dependencies());

describe("cw custodian ingest", () => {
  it.for(["2026-3-2", "yesterday", "2026-03-02T00:00"])(
    "refuses the As-of date %s as VALIDATION_ERROR",
    async (asOf) => {
      const { output, exitCode } = await run({ cli, argv: ["custodian", "ingest", asOf] });
      expect(exitCode).toBe(1);
      expect(output).toMatchObject({ code: "VALIDATION_ERROR", fieldErrors: [{ path: "asOf" }] });
    },
  );
});
