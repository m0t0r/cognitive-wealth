// Signing a user in to the local app through the real flow (docs/dev-sign-in.md), behind
// `cw dev sign-in`: the session saved for a browser, or only the link and code. Imported as source
// by `@repo/cli`, which Node runs directly (type stripping), so relative imports keep their `.ts`
// extension.
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import tls from "node:tls";
import { parseEnv } from "node:util";
import { localUrl, portlessCaPath } from "./local.ts";
import { createMailpit, parseSignInEmail } from "./mailpit.ts";
import { requestSignInEmail, signIn } from "./sign-in.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const DEFAULT_APP = "https://cognitive-wealth.localhost";
const DEFAULT_MAILPIT = "http://127.0.0.1:8025";

/**
 * A refusal with a `code` an agent can branch on (`cw`'s error output). `@repo/db`'s `CliError`,
 * written again: `@repo/db` depends on this package, so this one can't import it.
 */
export class DevSignInRefusal extends Error {
  override name = "DevSignInRefusal";
  readonly code: string;

  constructor({ code, message }: { code: string; message: string }) {
    super(message);
    this.code = code;
  }
}

export type DevSignInArgs = {
  /** Lowercased. */
  email: string;
  /** Default: BETTER_AUTH_URL, PORTLESS_URL or https://cognitive-wealth.localhost. */
  app?: string | undefined;
  /** Default: MAILPIT_URL from the shell, then from apps/web/.env.local, or :8025. */
  mailpit?: string | undefined;
  /** Sent as `x-forwarded-for` on every request. */
  ip?: string | undefined;
};

type DevSignInSessionArgs = DevSignInArgs & {
  /** Where to save the session. */
  state?: string | undefined;
};

/**
 * Signs `email` in and saves the session (cookies, as Playwright's `storageState`) to `state`, or
 * by default to this checkout's `.dev/auth/<email>.json`: a worktree's own, so parallel tasks
 * signed in as the same user don't overwrite each other.
 */
export async function devSignIn({
  state,
  ...args
}: DevSignInSessionArgs): Promise<{ statePath: string; app: string }> {
  const { appUrl, mailpitUrl } = targets(args);
  const { storageState } = await noEmailAsRefusal(() =>
    signIn({ appUrl, email: args.email, mailpitUrl, ip: args.ip }),
  );
  const statePath = state ? resolve(state) : join(REPO_ROOT, ".dev/auth", `${args.email}.json`);
  await saveState({ file: statePath, state: storageState });
  return { statePath, app: appUrl };
}

/** Only requests the email, and returns its link and code. */
export async function devSignInLink(args: DevSignInArgs): Promise<{ link: string; code: string }> {
  const { appUrl, mailpitUrl } = targets(args);
  const mailpit = createMailpit(mailpitUrl);
  const exclude = await mailpit.messageIds(args.email);
  await requestSignInEmail({ appUrl, email: args.email, ip: args.ip });
  const message = await noEmailAsRefusal(() => mailpit.waitForMessage({ to: args.email, exclude }));
  const { url, code } = parseSignInEmail(message.text);
  return { link: url, code };
}

/** The app's origin and Mailpit's URL, from the arguments or their defaults; local ones only. */
function targets({ app, mailpit }: Pick<DevSignInArgs, "app" | "mailpit">) {
  const appUrl = local({
    label: "the app",
    value: app ?? (process.env.BETTER_AUTH_URL || process.env.PORTLESS_URL || DEFAULT_APP),
  });
  const mailpitUrl = local({
    label: "Mailpit",
    value: mailpit ?? (process.env.MAILPIT_URL || webEnvMailpit() || DEFAULT_MAILPIT),
  });
  trustPortlessCa(appUrl);
  return { appUrl: appUrl.origin, mailpitUrl: mailpitUrl.toString() };
}

/** `localUrl`, its refusal coded `not_local`. */
function local({ label, value }: { label: string; value: string }): URL {
  try {
    return localUrl(label, value);
  } catch (error) {
    throw new DevSignInRefusal({
      code: "not_local",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Runs `step`, turning Mailpit's "No email to …" into a `no_email` refusal that says why. */
async function noEmailAsRefusal<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (!(error instanceof Error && /No email to/.test(error.message))) throw error;
    throw new DevSignInRefusal({
      code: "no_email",
      message:
        `${error.message}. Is the user seeded (pnpm cw db seed) or invited? Unknown emails get ` +
        "no mail.",
    });
  }
}

/**
 * `pnpm dev` serves the app over HTTPS with portless's local CA, which Node doesn't trust. Node
 * reads NODE_EXTRA_CA_CERTS only at startup, so add the CA to this process's defaults instead.
 */
function trustPortlessCa(app: URL) {
  if (app.protocol !== "https:") return;
  const ca = portlessCaPath();
  // Without it, HTTPS to the app fails to verify, and says so.
  if (!existsSync(ca)) return;
  tls.setDefaultCACertificates([...tls.getCACertificates("default"), readFileSync(ca, "utf8")]);
}

/**
 * `MAILPIT_URL` from this checkout's `apps/web/.env.local`: a worktree's names the shared
 * verification Mailpit its `pnpm dev` sends to (`@repo/dev-env`), the main checkout's the dev one.
 */
function webEnvMailpit(): string | undefined {
  const file = join(REPO_ROOT, "apps/web/.env.local");
  return existsSync(file) ? parseEnv(readFileSync(file, "utf8")).MAILPIT_URL : undefined;
}

async function saveState({ file, state }: { file: string; state: unknown }) {
  // Session cookies: keep them private to this user.
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  // `mode` only applies when the file is created; tighten an existing one too.
  await chmod(file, 0o600);
}
