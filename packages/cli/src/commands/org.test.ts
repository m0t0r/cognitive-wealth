import { createCli } from "../app";
import { dependencies, run } from "../testing";
import { shellQuoted } from "./org";

describe("shellQuoted", () => {
  it.for([
    ["acme", "acme"],
    ["Contract ended", "'Contract ended'"],
    ["Owner's request", `'Owner'\\''s request'`],
    ["$(rm -rf /)", "'$(rm -rf /)'"],
  ])("%s → %s", ([value, quoted]) => {
    expect(shellQuoted(value!)).toBe(quoted);
  });
});

// No database: each case here stops before connecting, and `dependencies()` fails one that doesn't.
const cli = createCli(dependencies());

describe("cw org deactivate and reactivate", () => {
  it.for([
    { name: "an invalid slug", slug: "Acme Corp", reason: "Closed", message: /Invalid slug/ },
    { name: "an empty reason", slug: "acme", reason: "  ", message: /reason is empty/ },
  ])("refuse $name as invalid_input, before connecting", async ({ slug, reason, message }) => {
    for (const command of ["deactivate", "reactivate"]) {
      // oxlint-disable-next-line no-await-in-loop -- two commands, one after the other
      const { output, exitCode } = await run({
        cli,
        argv: ["org", command, "--slug", slug, "--reason", reason],
      });
      expect(exitCode).toBe(1);
      expect(output).toMatchObject({ code: "invalid_input", retryable: false });
      expect(output.message).toMatch(message);
    }
  });

  it("refuses a missing --reason as VALIDATION_ERROR, naming the field", async () => {
    const { output, exitCode } = await run({ cli, argv: ["org", "deactivate", "--slug", "acme"] });
    expect(exitCode).toBe(1);
    expect(output).toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: [{ path: "reason", missing: true }],
    });
  });
});
