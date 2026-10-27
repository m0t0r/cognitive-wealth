// `cw verify …`: what the verifier-web skill runs from this checkout (#267).
// - `start` builds `web` and serves the production build on the verification services, from a
//   fresh database (`@repo/dev-env`'s `verify-server.ts`); `stop` stops this checkout's servers
//   and removes its `--ref` checkouts.
// - `browser start` starts (or reuses, or takes over) the shared headless Chrome on 9222 and opens
//   the app in it signed in (`verify-browser.ts`); `browser stop` closes this checkout's session
//   and frees the Chrome if this checkout holds it.
// - `compose up|down`: compose.yaml's own services in a Compose project of this checkout's own
//   (`verify-compose.ts`).
// Each acts only on what this checkout started; the stops run the same code a worktree's teardown
// runs. The working tree's database is seeded and ingested through `db seed`'s and
// `custodian ingest`'s own calls (`domainCalls`); a `--ref` checkout runs its own `cw`. They write
// to the checkout, its processes and the verification services only, but still aren't MCP tools
// (ADR 0026).
import { isIP } from "node:net";
import { Cli, z } from "incur";
import { CliError } from "@repo/db/cli/cli-error";
import type { Checkout } from "@repo/dev-env/checkout";
import type { DomainCalls } from "@repo/dev-env/populate";
import type { Dependencies } from "../dependencies.ts";
import { fromInvocation } from "../paths.ts";
import { refusal } from "../refusal.ts";

/** The verification Mailpit (compose.verify.yaml), where `dev sign-in` reads a verify server's email. */
const VERIFY_MAILPIT = "http://127.0.0.1:8026";
/** The persona `start`'s next step signs in: the world's Firm's owner, as from its own IP. */
const PERSONA = { email: "owner@cognitive-wealth.test", ip: "10.77.0.1" };

const households = z
  .array(z.object({ name: z.string(), publicId: z.string() }))
  .describe("Every Household, for URLs; publicIds are new on every run");
const ingested = z
  .array(z.object({ asOf: z.string(), status: z.enum(["ingested", "already_ingested"]) }))
  .describe("The custodian's example Deliveries, ingested into Larkspur");
const notes = z
  .array(z.string())
  .describe("What the served checkout couldn't do: a --ref from before cw or Ingestion");

const startOutput = z.object({
  url: z.string().describe("The app's URL"),
  role: z.enum(["head", "ref"]).describe("head: this checkout; ref: the --ref build"),
  database: z.string().describe("Its database as app, for a CLI or a query"),
  passwordFile: z.string().describe("app's password, for DATABASE_PASSWORD_FILE"),
  households,
  ingested,
  notes,
  seed: z.string().optional().describe("What --seed's function printed"),
  checkout: z.string().describe("The checkout built and served"),
  log: z.string().describe("The server's log"),
  pid: z.number().optional().describe("The server's pid; absent with --dry-run"),
  replaces: z
    .number()
    .optional()
    .describe("This checkout's last server for the role, which a run replaces"),
  dryRun: z.boolean().describe("true when nothing was changed"),
});

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

const browserStartOutput = z.object({
  session: z.string().describe("The agent-browser session, for every later --session"),
  statePath: z.string().describe("The session file loaded"),
  chrome: z
    .object({
      pid: z.number(),
      started: z.boolean().describe("false when this checkout's running Chrome was reused"),
      tookOverFrom: z
        .string()
        .optional()
        .describe("The gone checkout whose Chrome was stopped for a fresh one"),
    })
    .optional()
    .describe("The shared Chrome on 9222; absent with --dry-run"),
  holder: z
    .string()
    .optional()
    .describe("With --dry-run: the token of the checkout holding the Chrome, if any"),
  dryRun: z.boolean().describe("true when nothing was started"),
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

const composeUpOutput = z.object({
  project: z.string().describe("The Compose project: docker compose -p <project> ps|logs|exec"),
  urls: z.object({ web: z.string(), custodian: z.string(), mailpit: z.string() }),
  database: z.string().optional().describe("The project's database as app; only when db runs"),
  passwordFile: z.string().optional(),
  ingested,
  notes,
  dryRun: z.boolean().describe("true when nothing was started"),
});

const composeDownOutput = z.object({
  project: z.string(),
  steps: z.array(z.string()).describe("One line per step taken; empty with --dry-run"),
  dryRun: z.boolean().describe("true when nothing was removed"),
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

/**
 * `cw db seed`'s and `cw custodian ingest`'s own calls, on a verification database: for this
 * checkout's code only, since a `--ref`'s schema may differ.
 */
async function domainCalls(openDatabase: Dependencies["openDatabase"]): Promise<DomainCalls> {
  const { WORLD_FILE, seed } = await import("./db.ts");
  const { WORLD_FIRM, ingest } = await import("./custodian.ts");
  return {
    async seed(target) {
      await seed({
        world: WORLD_FILE,
        dryRun: false,
        openDatabase: () => openDatabase({ target }),
      });
    },
    async ingest({ target, asOf, root }) {
      const { result } = await ingest({
        asOf,
        firm: WORLD_FIRM,
        root,
        dryRun: false,
        openDatabase: () => openDatabase({ target }),
      });
      if (result.status === "refused") {
        throw new CliError({
          code: result.reason,
          message: `Refused the example Delivery for ${asOf}: ${result.message}.`,
        });
      }
      return result.status;
    },
  };
}

/** Only the checkout's own fields of `verify()`'s answer, for the calls that take a checkout. */
const checkoutOf = ({ mainCheckout, top, worktreeId }: Checkout): Checkout => ({
  mainCheckout,
  top,
  worktreeId,
});

/** `<file>[:<export>]` with the file resolved against where the command was typed. */
function seedTarget(seed: string) {
  const colon = seed.lastIndexOf(":");
  return colon > 0
    ? `${fromInvocation(seed.slice(0, colon))}${seed.slice(colon)}`
    : fromInvocation(seed);
}

export function verifyCommands({
  verify,
  openDatabase,
}: Pick<Dependencies, "verify" | "openDatabase">) {
  const browser = Cli.create("browser", {
    description: "The shared headless Chrome on 127.0.0.1:9222 and this checkout's session in it",
  })
    .command("start", {
      description:
        "Start the shared headless Chrome on 9222 (or reuse this checkout's), connect this " +
        "checkout's agent-browser session to it, load <email>'s session and open the app",
      hint:
        "Sign in first with dev sign-in. One checkout holds the Chrome at a time: another live " +
        "checkout's is refused (chrome_held), a gone one's is replaced, and anything else on 9222 " +
        "is refused (port_9222_taken): ask the user to quit it, never kill it.",
      args: z.object({ email: z.string().describe("Whose session to load") }),
      options: z.object({
        app: z.string().describe("The app's URL, from verify start"),
        ip: z
          .string()
          .refine((ip) => isIP(ip) !== 0, "Not an IP address")
          .describe("The client IP every request claims (x-forwarded-for), one per persona"),
        session: z
          .string()
          .optional()
          .describe("The session; `verify` in the main checkout, `verify-<token>` in a worktree"),
        dryRun: z
          .boolean()
          .default(false)
          .describe("Find the session file and the Chrome's holder, and stop"),
      }),
      output: browserStartOutput,
      mcp: false,
      async run(c) {
        const { email } = c.args;
        const { app, ip, session, dryRun } = c.options;
        try {
          const env = await verify();
          const { mainCheckout, worktreeId } = env;
          const statePath = env.sessionFileOf({ checkout: env, email });
          if (!statePath) {
            return c.error({
              code: "no_session",
              message: `No session file for ${email} in this checkout's .dev/auth or the main checkout's.`,
              retryable: true,
              cta: {
                commands: [
                  {
                    command: "dev sign-in",
                    args: { email },
                    options: { app, ip, mailpit: VERIFY_MAILPIT },
                    description: "Sign in to the verify server, then retry",
                  },
                ],
              },
            });
          }
          if (dryRun) {
            const { verifyResources } = await import("@repo/dev-env/names");
            const holder = env.chromeHolder(mainCheckout);
            return {
              session: session ?? verifyResources(worktreeId).session,
              statePath,
              ...(holder && { holder }),
              dryRun: true,
            };
          }
          const started = await env.startBrowser({
            checkout: checkoutOf(env),
            email,
            app,
            ip,
            session,
          });
          return c.ok(
            { ...started, dryRun: false },
            {
              cta: {
                commands: [
                  {
                    command: "verify browser stop",
                    description: "Free the Chrome once the browser work is done",
                  },
                ],
              },
            },
          );
        } catch (error) {
          const refused = refusal(error);
          // Another checkout's verification ends, and frees the Chrome.
          return c.error(
            refused.code === "chrome_held" || refused.code === "chrome_starting"
              ? { ...refused, retryable: true }
              : refused,
          );
        }
      },
    })
    .command("stop", {
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

  const compose = Cli.create("compose", {
    description:
      "compose.yaml's own services (the images, the custodian, migrations) in a Compose " +
      "project of this checkout's own, never the dev stack's",
  })
    .command("up", {
      description:
        "Build and start compose.yaml's services (all of them, or those named) in this " +
        "checkout's own project; while db runs, migrate, seed and ingest it as verify start does",
      hint:
        "Ports are this checkout's own; a worktree gets throwaway secrets in its .secrets/. A " +
        "second up keeps the data; down starts over. docker compose -p <project> ps|logs|exec " +
        "reaches the project. Use it only for changes the images exercise; verify start otherwise.",
      args: z.object({
        services: z
          .array(z.string())
          .optional()
          .describe("Services to start; a one-shot (migrate, custodian-migrate) runs on its own"),
      }),
      options: z.object({
        dryRun: z.boolean().default(false).describe("Name the project and its URLs, and stop"),
      }),
      output: composeUpOutput,
      mcp: false,
      async run(c) {
        try {
          const env = await verify();
          const { worktreeId } = env;
          if (c.options.dryRun) {
            const { verifyResources } = await import("@repo/dev-env/names");
            const { composeUrls } = await import("@repo/dev-env/verify-compose");
            const { project, ports } = verifyResources(worktreeId).compose;
            return {
              project,
              urls: composeUrls(ports),
              ingested: [],
              notes: [],
              dryRun: true,
            };
          }
          const up = await env.composeUp({
            checkout: checkoutOf(env),
            services: c.args.services ?? [],
            domain: await domainCalls(openDatabase),
          });
          return { ...up, dryRun: false };
        } catch (error) {
          return c.error(refusal(error));
        }
      },
    })
    .command("down", {
      description: "Stop this checkout's Compose project and delete its volumes",
      hint: "A worktree's teardown does the same, so a forgotten down doesn't outlive it.",
      options: z.object({
        dryRun: z.boolean().default(false).describe("Name the project, and stop"),
      }),
      output: composeDownOutput,
      mcp: false,
      async run(c) {
        try {
          const env = await verify();
          const { verifyResources } = await import("@repo/dev-env/names");
          const { project } = verifyResources(env.worktreeId).compose;
          if (c.options.dryRun) return { project, steps: [], dryRun: true };
          return { project, steps: [env.removeComposeProject(project)], dryRun: false };
        } catch (error) {
          return c.error(refusal(error));
        }
      },
    });

  return Cli.create("verify", {
    description:
      "The verifier-web skill's runs from this checkout: production servers, --ref checkouts, " +
      "the shared headless Chrome and a Compose project of its own",
  })
    .command("start", {
      description:
        "Build web and serve the production build on the verification services, from a fresh " +
        "database (migrated, seeded, the example Deliveries ingested); with --ref, that ref's " +
        "build instead, from its own checkout",
      hint:
        "Rerun after every edit: it replaces this checkout's own server for the role, never " +
        "another's. A port held by anything else is refused before anything changes " +
        "(port_taken); pass --port with a free one. Don't run it while pnpm e2e runs in this " +
        "checkout: both build into apps/web/.next.",
      options: z.object({
        ref: z
          .string()
          .optional()
          .describe("A git ref to serve instead of the working tree, e.g. the PR's base"),
        port: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("The port; this checkout's own for the role by default"),
        seed: z
          .string()
          .optional()
          .describe(
            "<file>:<export>, one more seed function (an e2e helper) run from the working tree " +
              "after the world, even with --ref",
          ),
        dryRun: z
          .boolean()
          .default(false)
          .describe("Check the port and say what would be served, and stop"),
      }),
      output: startOutput,
      mcp: false,
      async run(c) {
        const { ref, port, dryRun } = c.options;
        try {
          const env = await verify();
          const checkout = checkoutOf(env);
          if (dryRun) {
            const plan = env.planVerifyServer({ checkout, ref, port });
            return {
              ...plan,
              households: [],
              ingested: [],
              notes: [],
              dryRun: true,
            };
          }
          const started = await env.startVerifyServer({
            checkout,
            ref,
            port,
            seed: c.options.seed === undefined ? undefined : seedTarget(c.options.seed),
            domain: await domainCalls(openDatabase),
          });
          return c.ok(
            { ...started, dryRun: false },
            {
              cta: {
                commands: [
                  {
                    command: "dev sign-in",
                    args: { email: PERSONA.email },
                    options: { app: started.url, ip: PERSONA.ip, mailpit: VERIFY_MAILPIT },
                    description: "Sign the world's owner in to it",
                  },
                  {
                    command: "verify browser start",
                    args: { email: PERSONA.email },
                    options: { app: started.url, ip: PERSONA.ip },
                    description: "Then open it signed in, in the shared Chrome",
                  },
                ],
              },
            },
          );
        } catch (error) {
          return c.error(refusal(error));
        }
      },
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
    .command(browser)
    .command(compose);
}
