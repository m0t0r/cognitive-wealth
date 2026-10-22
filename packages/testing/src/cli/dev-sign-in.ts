// Signs a user in to the local app through the real flow and saves the session for a browser.
// Node runs this file directly (type stripping), so relative imports keep their `.ts` extension.
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import tls from "node:tls";
import { parseArgs } from "node:util";
import { createMailpit, parseSignInEmail } from "../mailpit.ts";
import { requestSignInEmail, signIn } from "../sign-in.ts";
import { localUrl, portlessCaPath } from "./local.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const DEFAULT_APP = "https://cognitive-wealth.localhost";
const DEFAULT_MAILPIT = "http://127.0.0.1:8025";
const EMAIL = /^[^\s@/\\]+@[^\s@/\\]+$/;

const USAGE = `Usage: pnpm dev:sign-in <email> [--link] [--state <file>] [--app <url>] [--mailpit <url>]

Signs <email> in through the app's real sign-in flow, reading the email from Mailpit.

  (default)        Save the session to .dev/auth/<email>.json (or --state) for
                   agent-browser --state or Playwright storageState.
  --link           Only request the email and print the confirm link and code.
  --state <file>   Where to save the session.
  --app <url>      App URL. Default: BETTER_AUTH_URL, PORTLESS_URL or ${DEFAULT_APP}.
  --mailpit <url>  Mailpit URL. Default: MAILPIT_URL or ${DEFAULT_MAILPIT}.

Only local hosts are allowed (localhost, 127.0.0.1, ::1, *.localhost). The user must exist
(pnpm db:seed) or have a pending invitation: anyone else gets no email.`;

/**
 * `pnpm dev` serves the app over HTTPS with portless's local CA, which Node doesn't trust. Node
 * reads NODE_EXTRA_CA_CERTS only at startup, so add the CA to this process's defaults instead.
 */
function trustPortlessCa(app: URL) {
  if (app.protocol !== "https:") return;
  const ca = portlessCaPath();
  if (!existsSync(ca)) {
    console.warn(`warning: no portless CA at ${ca}; HTTPS to ${app.host} may fail to verify.`);
    return;
  }
  tls.setDefaultCACertificates([...tls.getCACertificates("default"), readFileSync(ca, "utf8")]);
}

async function saveState(file: string, state: unknown) {
  // Session cookies: keep them private to this user.
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  // `mode` only applies when the file is created; tighten an existing one too.
  await chmod(file, 0o600);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      link: { type: "boolean", default: false },
      state: { type: "string" },
      app: { type: "string" },
      mailpit: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  const [rawEmail, ...extra] = positionals;
  if (!rawEmail || extra.length > 0) throw new Error(USAGE);
  const email = rawEmail.toLowerCase();
  if (!EMAIL.test(email)) throw new Error(`Not an email address: ${rawEmail}`);

  const app = localUrl(
    "the app",
    values.app ?? (process.env.BETTER_AUTH_URL || process.env.PORTLESS_URL || DEFAULT_APP),
  );
  const mailpitUrl = localUrl(
    "Mailpit",
    values.mailpit ?? (process.env.MAILPIT_URL || DEFAULT_MAILPIT),
  ).toString();
  const appUrl = app.origin;
  trustPortlessCa(app);

  if (values.link) {
    const mailpit = createMailpit(mailpitUrl);
    const exclude = await mailpit.messageIds(email);
    await requestSignInEmail({ appUrl, email });
    const message = await mailpit.waitForMessage({ to: email, exclude });
    const { url, code } = parseSignInEmail(message.text);
    console.log(`Sign-in link: ${url}\nSign-in code: ${code}`);
    return;
  }

  const { storageState } = await signIn({ appUrl, email, mailpitUrl });
  const file = values.state ? resolve(values.state) : join(REPO_ROOT, ".dev/auth", `${email}.json`);
  await saveState(file, storageState);
  console.log(`Signed in as ${email}; session saved to ${file}`);
  console.log(`Open it with: agent-browser --state ${file} open ${appUrl}`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  if (/No email to/.test(message)) {
    console.error("Is the user seeded (pnpm db:seed) or invited? Unknown emails get no mail.");
  }
  process.exitCode = 1;
}
