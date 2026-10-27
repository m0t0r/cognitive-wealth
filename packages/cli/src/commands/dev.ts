// `cw dev …`: local development.
// - `sign-in` signs a user in to the local app through the real flow (docs/dev-sign-in.md).
// - `prune` tears down every worktree environment whose worktree git no longer lists
//   (`@repo/dev-env`'s `prune`). The `teardown-worktree` hook runs it after a worktree removal and
//   at the start and end of every session, and `pnpm dev` runs the same sweep on start; by hand
//   it's for a check (`--dry-run`) or a retry.
// They write to the dev services and the checkout only, but still aren't MCP tools (ADR 0026).
import { isIP } from "node:net";
import { join } from "node:path";
import { Cli, z } from "incur";
import { CliError } from "@repo/db/cli/cli-error";
import type { Dependencies } from "../dependencies.ts";
import { domainCalls } from "../domain-calls.ts";
import { fromInvocation } from "../paths.ts";
import { refusal } from "../refusal.ts";
import { shellQuoted } from "../shell-quoted.ts";

const EMAIL = /^[^\s@/\\]+@[^\s@/\\]+$/;

const signInOptions = z.object({
  link: z.boolean().default(false).describe("Only request the email, and return its link and code"),
  state: z
    .string()
    .optional()
    .describe("Where to save the session; this checkout's .dev/auth/<email>.json by default"),
  app: z
    .string()
    .optional()
    .describe("The app's URL; BETTER_AUTH_URL, PORTLESS_URL or https://cognitive-wealth.localhost"),
  mailpit: z
    .string()
    .optional()
    .describe(
      "Mailpit's URL; MAILPIT_URL from the shell, then from apps/web/.env.local (a worktree's " +
        "names the verification Mailpit), or http://127.0.0.1:8025",
    ),
  ip: z
    .string()
    .refine((ip) => isIP(ip) !== 0, "Not an IP address")
    .optional()
    .describe(
      "Send every request as from this client IP (x-forwarded-for), so each session gets its own " +
        "rate-limit bucket; only an app that trusts x-forwarded-for uses it",
    ),
});

const signInOutput = z.union([
  z.object({
    email: z.string(),
    statePath: z.string().describe("The session file written, for agent-browser --state"),
    app: z.string().describe("The app's origin it signed in to"),
  }),
  z.object({
    email: z.string(),
    link: z.string().describe("The confirm link, with --link"),
    code: z.string().describe("The six-digit sign-in code, with --link"),
  }),
]);

const ENV_FILE = "apps/web/.env.local";

const envOutput = z.object({
  worktree: z.string().describe("The worktree's root"),
  database: z.string().describe("Its database on the verification Postgres (:5433)"),
  redisPrefix: z.string().describe("Its Redis keys' prefix on the verification Redis"),
  created: z
    .boolean()
    .optional()
    .describe(
      "true when the database was created, migrated, seeded and given the example Deliveries; " +
        "false when only migrated",
    ),
  ingested: z
    .array(z.object({ asOf: z.string(), status: z.enum(["ingested", "already_ingested"]) }))
    .optional()
    .describe(
      "The custodian's example Deliveries (apps/custodian/fixtures/feed) ingested into Larkspur; " +
        "empty unless created",
    ),
  envFile: z.string().describe("The apps/web/.env.local written, pointing at them"),
  pruned: z.array(z.string()).describe("What removed worktrees left, torn down first"),
  warnings: z.array(z.string()).describe("What couldn't be torn down; retry with dev prune"),
  dryRun: z.boolean().describe("true when nothing was set up"),
});

const teardownOutput = z.object({
  worktree: z.string(),
  found: z.boolean().describe("false when the path is no worktree and has no record"),
  database: z.string().optional(),
  redisPrefix: z.string().optional(),
  pid: z.number().optional().describe("Its pnpm dev, if one is running"),
  steps: z.array(z.string()).describe("One line per step taken; empty with --dry-run"),
  dryRun: z.boolean().describe("true when nothing was torn down"),
});

/** The main checkout uses the dev stack (apps/web/.env.example), which these never touch. */
function mainCheckoutRefusal(path: string) {
  return new CliError({
    code: "main_checkout",
    message:
      `${path} is the main checkout, whose dev stack this never touches. Run it inside a ` +
      "worktree, or pass --worktree <path> to teardown.",
  });
}

const output = z.object({
  dryRun: z.boolean().describe("true when nothing was torn down"),
  removed: z.array(z.string()).describe("One line per thing torn down; empty with --dry-run"),
  orphans: z
    .array(
      z.object({
        database: z.string(),
        redisPrefix: z.string(),
        pid: z.number().optional().describe("Its pnpm dev, if one is running"),
      }),
    )
    .describe("The environments of removed worktrees; with --dry-run, what would go"),
  servers: z
    .array(z.object({ pid: z.number(), cwd: z.string() }))
    .describe("pnpm dev processes found only in the process table, in no live checkout"),
});

export function devCommands({
  devEnv,
  openDatabase,
}: Pick<Dependencies, "devEnv" | "openDatabase">) {
  return Cli.create("dev", {
    description: "Local development: signing in, and the dev environments of git worktrees",
  })
    .command("sign-in", {
      description:
        "Sign <email> in to the local app through its real sign-in flow, reading the email from " +
        "Mailpit, and save the session for agent-browser --state or Playwright's storageState",
      hint:
        "Only local hosts are allowed (localhost, 127.0.0.1, ::1, *.localhost). The user must " +
        "exist (pnpm cw db seed) or have a pending invitation: anyone else gets no email.",
      args: z.object({
        email: z
          .string()
          .transform((email) => email.toLowerCase())
          .refine((email) => EMAIL.test(email), "Not an email address")
          .describe("Who to sign in"),
      }),
      options: signInOptions,
      output: signInOutput,
      mcp: false,
      async run(c) {
        const { email } = c.args;
        const { link, state, app, mailpit, ip } = c.options;
        try {
          const { devSignIn, devSignInLink } = await import("@repo/testing/dev-sign-in");
          if (link) return { email, ...(await devSignInLink({ email, app, mailpit, ip })) };
          const signedIn = await devSignIn({
            email,
            app,
            mailpit,
            ip,
            state: state === undefined ? undefined : fromInvocation(state),
          });
          return { email, ...signedIn };
        } catch (error) {
          return c.error(refusal(error));
        }
      },
    })
    .command("env", {
      description:
        "Set up this worktree's dev environment without starting the app: its own database on " +
        "the verification Postgres (created, migrated, seeded and given the custodian's example " +
        "Deliveries the first time, migrated after that), its Redis prefix, and apps/web/.env.local pointing at them",
      hint: "pnpm dev does the same on every start. First it tears down removed worktrees' ones.",
      options: z.object({
        dryRun: z.boolean().default(false).describe("Name the environment, and set nothing up"),
      }),
      output: envOutput,
      mcp: false,
      async run(c) {
        try {
          const env = await devEnv();
          const { top, mainCheckout, worktreeId } = env;
          if (!worktreeId) throw mainCheckoutRefusal(top);
          const { worktreeResources } = await import("@repo/dev-env/names");
          const named = { worktree: top, envFile: join(top, ENV_FILE) };
          if (c.options.dryRun) {
            const { database, redisPrefix } = worktreeResources(worktreeId);
            return { ...named, database, redisPrefix, pruned: [], warnings: [], dryRun: true };
          }
          // What removed worktrees left goes first; a failure there doesn't stop this one.
          const { removed, failed } = await env.prune(mainCheckout);
          const { record, created, ingested } = await env.setUpWorktree({
            top,
            mainCheckout,
            worktreeId,
            domain: await domainCalls(openDatabase),
          });
          return {
            ...named,
            database: record.database,
            redisPrefix: record.redisPrefix,
            created,
            ingested,
            pruned: removed,
            warnings: failed.map(
              (line) => `Couldn't tear down what's left of a removed worktree: ${line}`,
            ),
            dryRun: false,
          };
        } catch (error) {
          return c.error(refusal(error));
        }
      },
    })
    .command("teardown", {
      description:
        "Tear down a worktree's dev environment, to start it over: stop its pnpm dev, drop its " +
        "database and Redis keys, and remove what its verifier-web runs left",
      hint:
        "Idempotent, so it's safe to rerun. The next pnpm dev sets it up again. A removed " +
        "worktree's environment goes with " +
        "dev prune, which the hooks run.",
      options: z.object({
        worktree: z
          .string()
          .optional()
          .describe("The worktree to tear down, even one already removed; this one by default"),
        dryRun: z.boolean().default(false).describe("Say what would be torn down, and stop"),
      }),
      output: teardownOutput,
      mcp: false,
      async run(c) {
        try {
          const env = await devEnv();
          const { mainCheckout } = env;
          const worktree = c.options.worktree ? fromInvocation(c.options.worktree) : env.top;
          if (worktree === mainCheckout) throw mainCheckoutRefusal(worktree);
          const { dryRun } = c.options;
          const target = env.teardownTargetAt({ mainCheckout, path: worktree });
          if (!target) return { worktree, found: false, steps: [], dryRun };
          const found = {
            worktree,
            found: true,
            database: target.database,
            redisPrefix: target.redisPrefix,
            pid: target.server?.pid,
          };
          if (dryRun) return { ...found, steps: [], dryRun };
          let steps: string[];
          try {
            steps = await env.tearDown({ mainCheckout, target });
          } catch (error) {
            return c.error({
              code: "teardown_failed",
              message: error instanceof Error ? error.message : String(error),
              retryable: true,
              cta: {
                commands: [
                  {
                    command: "dev teardown",
                    options: { worktree: shellQuoted(worktree) },
                    description: "Retry once the cause is fixed",
                  },
                ],
              },
            });
          }
          return { ...found, steps, dryRun };
        } catch (error) {
          return c.error(refusal(error));
        }
      },
    })
    .command("prune", {
      description:
        "Tear down every worktree environment whose worktree is gone: its database, Redis keys, " +
        "pnpm dev, and what verifier-web left for it",
      hint: "Only worktrees git no longer lists are touched, so it's safe to run at any time.",
      options: z.object({
        dryRun: z.boolean().default(false).describe("List what would be torn down, and stop"),
      }),
      output,
      mcp: false,
      async run(c) {
        try {
          const { mainCheckout, findOrphans, prune } = await devEnv();
          const { environments, servers } = await findOrphans(mainCheckout);
          const found = {
            orphans: environments.map(({ database, redisPrefix, server }) => ({
              database,
              redisPrefix,
              pid: server?.pid,
            })),
            servers: servers.map(({ pid, cwd }) => ({ pid, cwd })),
          };
          if (c.options.dryRun) return { dryRun: true, removed: [], ...found };
          const { removed, failed } = await prune(mainCheckout);
          if (failed.length > 0) {
            return c.error({
              code: "prune_failed",
              message: [`Tore down ${removed.length}, and failed on:`, ...failed].join("\n"),
              retryable: true,
              cta: {
                commands: [{ command: "dev prune", description: "Retry once the cause is fixed" }],
              },
            });
          }
          return { dryRun: false, removed, ...found };
        } catch (error) {
          return c.error(refusal(error));
        }
      },
    });
}
