import { createCli } from "../app";
import { dependencies, run } from "../testing";
import { shellQuoted } from "../shell-quoted";

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

describe("cw org create and export", () => {
  it.for([
    {
      name: "create, an invalid owner",
      argv: ["org", "create", "--name", "Acme", "--owner", "not-an-email"],
      message: /Not an email address/,
    },
    {
      name: "create, a name with nothing to make a slug of",
      argv: ["org", "create", "--name", "!!!", "--owner", "a@b.co"],
      message: /Can't make a slug/,
    },
    {
      name: "export, an empty reason",
      argv: ["org", "export", "--slug", "acme", "--out", "/tmp/x", "--reason", " "],
      message: /reason is empty/,
    },
  ])("refuse $name as invalid_input, before connecting", async ({ argv, message }) => {
    const { output, exitCode } = await run({ cli, argv });
    expect(exitCode).toBe(1);
    expect(output).toMatchObject({ code: "invalid_input" });
    expect(output.message).toMatch(message);
  });
});
