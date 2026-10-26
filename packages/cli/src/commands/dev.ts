// `cw dev …`: local development.
// - `sign-in` signs a user in to the local app through the real flow (docs/dev-sign-in.md).
// - `prune` tears down every worktree environment whose worktree git no longer lists
//   (`@repo/dev-env`'s `prune`). The `teardown-worktree` hook runs it after a worktree removal and
//   at the start and end of every session, and `pnpm dev` runs the same sweep on start; by hand
//   it's for a check (`--dry-run`) or a retry.
// They write to the dev services and the checkout only, but still aren't MCP tools (ADR 0026).
import { isIP } from "node:net";
import { Cli, z } from "incur";
import type { Dependencies } from "../dependencies.ts";
import { fromInvocation } from "../paths.ts";
import { refusal } from "../refusal.ts";

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

export function devCommands({ devEnv }: Pick<Dependencies, "devEnv">) {
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
