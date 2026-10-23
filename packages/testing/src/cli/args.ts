// Argument parsing for `pnpm dev:sign-in`, apart from the CLI so it can be tested without running
// it. Node runs this file directly (type stripping), so relative imports keep their `.ts` extension.
import { isIP } from "node:net";
import { parseArgs } from "node:util";

const EMAIL = /^[^\s@/\\]+@[^\s@/\\]+$/;

export const USAGE = `Usage: pnpm dev:sign-in <email> [--link] [--state <file>] [--app <url>] [--mailpit <url>] [--ip <addr>]

Signs <email> in through the app's real sign-in flow, reading the email from Mailpit.

  (default)        Save the session to .dev/auth/<email>.json (or --state) for
                   agent-browser --state or Playwright storageState.
  --link           Only request the email and print the confirm link and code.
  --state <file>   Where to save the session.
  --app <url>      App URL. Default: BETTER_AUTH_URL, PORTLESS_URL or https://cognitive-wealth.localhost.
  --mailpit <url>  Mailpit URL. Default: MAILPIT_URL or http://127.0.0.1:8025.
  --ip <addr>      Send every request as from this client IP (x-forwarded-for), so each
                   session gets its own rate-limit bucket. Only an app that trusts
                   x-forwarded-for (AUTH_TRUSTED_IP_HEADER) uses it.

Only local hosts are allowed (localhost, 127.0.0.1, ::1, *.localhost). The user must exist
(pnpm db:seed) or have a pending invitation: anyone else gets no email.`;

export interface DevSignInArgs {
  help: boolean;
  /** Lowercased. Empty with `help`. */
  email: string;
  link: boolean;
  state: string | undefined;
  app: string | undefined;
  mailpit: string | undefined;
  /** An IPv4 or IPv6 address, sent as `x-forwarded-for`. */
  ip: string | undefined;
}

/** Parses the CLI's arguments; throws with the usage (or the problem) when they're wrong. */
export function parseDevSignInArgs(args: string[]): DevSignInArgs {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      link: { type: "boolean", default: false },
      state: { type: "string" },
      app: { type: "string" },
      mailpit: { type: "string" },
      ip: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const options = {
    link: values.link,
    state: values.state,
    app: values.app,
    mailpit: values.mailpit,
    ip: values.ip,
  };
  if (values.help) return { help: true, email: "", ...options };

  const [rawEmail, ...extra] = positionals;
  if (!rawEmail || extra.length > 0) throw new Error(USAGE);
  const email = rawEmail.toLowerCase();
  if (!EMAIL.test(email)) throw new Error(`Not an email address: ${rawEmail}`);
  if (values.ip !== undefined && isIP(values.ip) === 0) {
    throw new Error(`Not an IP address: ${values.ip}`);
  }
  return { help: false, email, ...options };
}
