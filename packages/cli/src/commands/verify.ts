// `cw verify …`: what the verifier-web skill runs from this checkout (#267).
// - `stop` stops this checkout's verification servers and removes its `--ref` checkouts.
// - `browser stop` closes this checkout's agent-browser session and frees the shared Chrome if
//   this checkout holds it.
// Both act only on what this checkout started, through `@repo/dev-env`'s `verify.ts`, the same
// code a worktree's teardown runs. They write to the checkout and its processes only, but still
// aren't MCP tools (ADR 0026).
import { Cli, z } from "incur";
import type { Dependencies } from "../dependencies.ts";
import { refusal } from "../refusal.ts";

const stopOutput = z.object({
  servers: z
    .array(z.number())
    .describe("The pids of this checkout's verification servers; with --dry-run, what would stop"),
  refCheckouts: z
    .array(z.string())
    .describe("This checkout's --ref checkouts; with --dry-run, what would be removed"),
  steps: z.array(z.string()).describe("One line per step taken; empty with --dry-run"),
  dryRun: z.boolean().describe("true when nothing was stopped"),
});

const browserStopOutput = z.object({
  session: z.string().describe("The agent-browser session closed"),
  holdsChrome: z
    .boolean()
    .describe(
      "Whether this checkout held the shared Chrome on 9222, which it then stops and frees",
    ),
  steps: z.array(z.string()).describe("One line per step taken; empty with --dry-run"),
  dryRun: z.boolean().describe("true when nothing was stopped"),
});

/** A step that failed, say a process that won't exit, as a refusal whose retry is `retry`. */
function stopFailed({ error, retry }: { error: unknown; retry: string }) {
  return {
    code: "stop_failed",
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
    cta: { commands: [{ command: retry, description: "Retry once the cause is fixed" }] },
  };
}

export function verifyCommands({ verify }: Pick<Dependencies, "verify">) {
  const browser = Cli.create("browser", {
    description: "The shared headless Chrome on 127.0.0.1:9222 and this checkout's session in it",
  }).command("stop", {
    description:
      "Close this checkout's agent-browser session and, if this checkout holds the shared " +
      "Chrome, stop it and free it for other worktrees",
    hint:
      "Run it as soon as the browser work is done, so another worktree can take the Chrome. " +
      "Another checkout's Chrome is left alone.",
    options: z.object({
      session: z
        .string()
        .optional()
        .describe(
          "The session to close; `verify` in the main checkout, `verify-<token>` in a worktree",
        ),
      dryRun: z.boolean().default(false).describe("Say what would be stopped, and stop"),
    }),
    output: browserStopOutput,
    mcp: false,
    async run(c) {
      try {
        const { mainCheckout, worktreeId, chromeHolder, releaseChrome } = await verify();
        const { verifyResources } = await import("@repo/dev-env/names");
        const { token, session: ownSession } = verifyResources(worktreeId);
        const session = c.options.session ?? ownSession;
        const found = { session, holdsChrome: chromeHolder(mainCheckout) === token };
        if (c.options.dryRun) return { ...found, steps: [], dryRun: true };
        try {
          const step = await releaseChrome({ mainCheckout, token, session });
          return { ...found, steps: [`closed the session ${session}`, step], dryRun: false };
        } catch (error) {
          return c.error(stopFailed({ error, retry: "verify browser stop" }));
        }
      } catch (error) {
        return c.error(refusal(error));
      }
    },
  });

  return Cli.create("verify", {
    description:
      "The verifier-web skill's runs from this checkout: production servers, --ref checkouts " +
      "and the shared headless Chrome",
  })
    .command("stop", {
      description:
        "Stop this checkout's verification servers and remove its --ref checkouts, with their " +
        "pidfiles and logs",
      hint:
        "Other worktrees' servers and checkouts are left alone, and the verify Compose project " +
        "keeps running. A removed worktree's go with dev prune, which the hooks run.",
      options: z.object({
        dryRun: z.boolean().default(false).describe("List what would be stopped, and stop"),
      }),
      output: stopOutput,
      mcp: false,
      async run(c) {
        try {
          const env = await verify();
          const { mainCheckout, worktreeId } = env;
          const { verifyResources } = await import("@repo/dev-env/names");
          const { token } = verifyResources(worktreeId);
          const found = {
            servers: env.verifyServersOf({ mainCheckout, token }),
            refCheckouts: env.refCheckoutsOf({ mainCheckout, token }),
          };
          if (c.options.dryRun) return { ...found, steps: [], dryRun: true };
          try {
            // The servers first: a --ref one runs from the checkout removed next.
            const steps = [
              await env.stopVerifyServers({ mainCheckout, token }),
              env.removeRefCheckouts({ mainCheckout, token }),
            ];
            return { ...found, steps, dryRun: false };
          } catch (error) {
            return c.error(stopFailed({ error, retry: "verify stop" }));
          }
        } catch (error) {
          return c.error(refusal(error));
        }
      },
    })
    .command(browser);
}
