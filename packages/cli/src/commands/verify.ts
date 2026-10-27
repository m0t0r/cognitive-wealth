// `cw verify …`: what the verifier-web skill runs from this checkout (#267).
// - `start` builds `web` and serves the production build on the verification services, from a
//   fresh database (`@repo/dev-env`'s `verify-server.ts`); `stop` stops this checkout's servers
//   and removes its `--ref` checkouts.
// - `browser start` opens the app signed in, in a headless Chrome of this checkout's session's own
//   (`verify-browser.ts`); `browser stop` closes the session (and stops a shared Chrome on 9222
//   that this checkout still holds from before #144).
// - `trace` records a performance trace of the session's page, the way the chrome-devtools MCP
//   does, and returns what DevTools' trace engine reads from it (`verify-trace.ts`, #144).
// - `compose up|down`: compose.yaml's own services in a Compose project of this checkout's own
//   (`verify-compose.ts`).
// Each acts only on what this checkout started; the stops run the same code a worktree's teardown
// runs. The working tree's database is seeded and ingested through `db seed`'s and
// `custodian ingest`'s own calls (`domainCalls`); a `--ref` checkout runs its own `cw`. They write
// to the checkout, its processes and the verification services only, but still aren't MCP tools
// (ADR 0026).
import { isIP } from "node:net";
import { Cli, z } from "incur";
import type { Checkout } from "@repo/dev-env/checkout";
import type { Dependencies } from "../dependencies.ts";
import { domainCalls } from "../domain-calls.ts";
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

const viewport = z.object({ width: z.number(), height: z.number() });

const browserStartOutput = z.object({
  session: z.string().describe("The agent-browser session, for every later --session"),
  statePath: z.string().describe("The session file loaded"),
  viewport: viewport
    .optional()
    .describe("The window size, the one verify trace measures at; absent with --dry-run"),
  dryRun: z.boolean().describe("true when nothing was started"),
});

const browserStopOutput = z.object({
  session: z.string().describe("The agent-browser session closed"),
  holdsSharedChrome: z
    .boolean()
    .describe(
      "Whether this checkout still held the shared Chrome on 9222 from before #144, which it stops",
    ),
  steps: z.array(z.string()).describe("One line per step taken; empty with --dry-run"),
  dryRun: z.boolean().describe("true when nothing was stopped"),
});

const insight = z.object({
  name: z.string().describe("DevTools' key for it: LCPBreakdown, RenderBlocking, …"),
  title: z.string(),
  state: z.enum(["pass", "fail", "informative"]).describe("fail: something to fix"),
  description: z.string().optional().describe("What it says, when it didn't pass"),
  savings: z
    .object({ LCP: z.number().optional(), INP: z.number().optional(), CLS: z.number().optional() })
    .optional()
    .describe("Estimated savings: ms for LCP and INP, a score for CLS"),
});

const traceOutput = z.object({
  session: z.string(),
  url: z.string().optional().describe("The page traced; absent with --dry-run"),
  mode: z.enum(["load", "interaction"]).describe("load without --step, interaction with"),
  throttled: z.boolean(),
  viewport: viewport.optional(),
  file: z.string().describe("The saved trace; DevTools' Performance panel opens it"),
  summary: z
    .object({
      url: z.string(),
      lcp: z
        .object({ ms: z.number(), subparts: z.record(z.string(), z.number()) })
        .optional()
        .describe("A page load's Largest Contentful Paint, with its subparts in ms"),
      cls: z.number().optional().describe("A page load's Cumulative Layout Shift"),
      inp: z
        .object({ ms: z.number(), type: z.string() })
        .optional()
        .describe("An interaction trace's Interaction to Next Paint"),
      insights: z.array(insight),
    })
    .optional()
    .describe("What DevTools' trace engine read; absent with --dry-run"),
  dryRun: z.boolean().describe("true when nothing was recorded"),
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
    description: "This checkout's agent-browser session, in a headless Chrome of its own",
  })
    .command("start", {
      description:
        "Open the app signed in as <email> in this checkout's agent-browser session, in a " +
        "headless Chrome of its own, at the window size verify trace measures at",
      hint:
        "Sign in first with dev sign-in. A running session is closed and opened fresh, since " +
        "--state on a running one leaves it blank (#225). Worktrees never share a browser.",
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
          .describe("Find the session file, and stop"),
      }),
      output: browserStartOutput,
      mcp: false,
      async run(c) {
        const { email } = c.args;
        const { app, ip, session, dryRun } = c.options;
        try {
          const env = await verify();
          const { worktreeId } = env;
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
            return {
              session: session ?? verifyResources(worktreeId).session,
              statePath,
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
                    command: "verify trace",
                    args: { name: "<route>" },
                    description: "Trace a page once agent-browser has opened it",
                  },
                  {
                    command: "verify browser stop",
                    description: "Close the session once the browser work is done",
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
        "Close this checkout's agent-browser session and its Chrome, and stop a shared Chrome " +
        "on 9222 this checkout still holds from before #144",
      hint: "A worktree's teardown does the same. Another checkout's session is left alone.",
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
          const found = { session, holdsSharedChrome: chromeHolder(mainCheckout) === token };
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
      "a browser session and its perf traces, and a Compose project of its own",
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
                    description: "Then open it signed in, in a browser of this checkout's own",
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
    .command("trace", {
      description:
        "Record a performance trace of this checkout's agent-browser session, as the " +
        "chrome-devtools MCP does, and return the LCP, CLS or INP and insights DevTools reads",
      hint:
        "Open the page with agent-browser first. Without --step it traces a page load of the " +
        "current page (LCP, CLS); with --step it runs those agent-browser commands while " +
        "recording, without reloading (INP). Traces are taken at 1280×800 (wrong_viewport " +
        "otherwise). A trace that lacks what a number needs is refused, never reported as 0.",
      args: z.object({
        name: z
          .string()
          .regex(/^[\w.-]+$/, "Letters, digits, dots, dashes and underscores only")
          .describe("Saved as .dev/perf/<name>.trace.json.gz in this checkout"),
      }),
      options: z.object({
        step: z
          .array(z.string())
          .default([])
          .describe(
            'An agent-browser command without --session, e.g. "click @e3"; repeat for several',
          ),
        throttle: z
          .boolean()
          .default(false)
          .describe("4× CPU and Slow 4G for the whole trace, turned off afterwards"),
        session: z
          .string()
          .optional()
          .describe("The session; `verify` in the main checkout, `verify-<token>` in a worktree"),
        dryRun: z
          .boolean()
          .default(false)
          .describe("Name the session, the file and the mode, and stop"),
      }),
      output: traceOutput,
      mcp: false,
      async run(c) {
        const { name } = c.args;
        const { step: steps, throttle, session, dryRun } = c.options;
        try {
          const env = await verify();
          if (dryRun) {
            const { verifyResources } = await import("@repo/dev-env/names");
            const { join } = await import("node:path");
            const mode: "load" | "interaction" = steps.length > 0 ? "interaction" : "load";
            return {
              session: session ?? verifyResources(env.worktreeId).session,
              mode,
              throttled: throttle,
              file: join(env.top, ".dev/perf", `${name}.trace.json.gz`),
              dryRun: true,
            };
          }
          const traced = await env.traceSession({
            checkout: checkoutOf(env),
            name,
            steps,
            throttle,
            session,
          });
          return { ...traced, dryRun: false };
        } catch (error) {
          return c.error(refusal(error));
        }
      },
    })
    .command(browser)
    .command(compose);
}
