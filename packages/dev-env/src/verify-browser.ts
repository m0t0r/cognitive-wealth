// `cw verify browser start`: this checkout's agent-browser session, signed in as a seeded user, in a
// headless Chrome of its own that agent-browser launches (no CDP port), so worktrees verifying at
// once never share a tab, cookies or a trace (#144). `cw verify trace` reaches that Chrome through
// the session's own CDP endpoint. Node runs the CLIs that import this directly (type stripping), so
// relative imports keep their `.ts` extension.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CliError } from "@repo/db/cli/cli-error";
import type { Checkout } from "./checkout.ts";
import { verifyResources } from "./names.ts";
import { agentBrowser } from "./agent-browser.ts";
import { TRACE_VIEWPORT, type Viewport } from "./trace-viewport.ts";

/** What starting the browser reaches outside itself for; a test hands in its own. */
export type BrowserSystem = {
  agentBrowser: (args: string[]) => void;
};

export const defaultBrowserSystem: BrowserSystem = { agentBrowser };

export type StartBrowserArgs = {
  checkout: Checkout;
  email: string;
  /** The app's URL, opened once signed in. */
  app: string;
  /** The client IP every request claims (x-forwarded-for), the persona's rate-limit bucket. */
  ip: string;
  /** The agent-browser session; this checkout's own by default. */
  session?: string | undefined;
  system?: BrowserSystem | undefined;
};

export type StartedBrowser = {
  session: string;
  /** The session file loaded. */
  statePath: string;
  /** The window size, the one `cw verify trace` measures at. */
  viewport: Viewport;
};

/**
 * The session file `cw dev sign-in` saved for `email`: this checkout's first, since it saves to the
 * checkout it runs from and one in the main checkout may belong to another task's server.
 */
export function sessionFileOf({ checkout, email }: { checkout: Checkout; email: string }) {
  return [checkout.top, checkout.mainCheckout]
    .map((root) => join(root, ".dev/auth", `${email}.json`))
    .find((file) => existsSync(file));
}

export async function startBrowser({
  checkout,
  email,
  app,
  ip,
  session: chosen,
  system = defaultBrowserSystem,
}: StartBrowserArgs): Promise<StartedBrowser> {
  const session = chosen ?? verifyResources(checkout.worktreeId).session;
  const statePath = sessionFileOf({ checkout, email });
  if (!statePath) {
    throw new CliError({
      code: "no_session",
      message: `No session file for ${email} in ${join(checkout.top, ".dev/auth")} or the main checkout's; sign in first.`,
    });
  }
  // A fresh session: `--state` on one that's running leaves it on about:blank (#225).
  try {
    system.agentBrowser(["--session", session, "close"]);
  } catch {
    // It wasn't running.
  }
  system.agentBrowser([
    "--session",
    session,
    "--state",
    statePath,
    "--headers",
    JSON.stringify({ "x-forwarded-for": ip }),
    "open",
    app,
  ]);
  const { width, height } = TRACE_VIEWPORT;
  system.agentBrowser(["--session", session, "set", "viewport", String(width), String(height)]);
  return { session, statePath, viewport: TRACE_VIEWPORT };
}
