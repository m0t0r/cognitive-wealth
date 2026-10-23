// Signs a user in to the local app through the real flow and saves the session for a browser.
// Node runs this file directly (type stripping), so relative imports keep their `.ts` extension.
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import tls from "node:tls";
import { createMailpit, parseSignInEmail } from "../mailpit.ts";
import { requestSignInEmail, signIn } from "../sign-in.ts";
import { parseDevSignInArgs, USAGE } from "./args.ts";
import { localUrl, portlessCaPath } from "./local.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const DEFAULT_APP = "https://cognitive-wealth.localhost";
const DEFAULT_MAILPIT = "http://127.0.0.1:8025";

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
  const values = parseDevSignInArgs(process.argv.slice(2));
  if (values.help) {
    console.log(USAGE);
    return;
  }
  const { email, ip } = values;

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
    await requestSignInEmail({ appUrl, email, ip });
    const message = await mailpit.waitForMessage({ to: email, exclude });
    const { url, code } = parseSignInEmail(message.text);
    console.log(`Sign-in link: ${url}\nSign-in code: ${code}`);
    return;
  }

  const { storageState } = await signIn({ appUrl, email, mailpitUrl, ip });
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
