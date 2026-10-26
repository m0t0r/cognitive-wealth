// `node packages/dev-env/src/cli/verify-names.ts`: what this checkout's verifier-web runs use, as
// shell assignments the skill's scripts `eval`, so the names are worked out only here
// (`verifyResources`) and teardown finds the same ones. Node runs this file directly (type
// stripping), so relative imports keep their `.ts` extension.
import { checkoutAt } from "../checkout.ts";
import { verifyResources } from "../names.ts";
import { chromeFiles, refCheckoutsDir, stateDirOf, verifyDir } from "../verify.ts";

const { mainCheckout, worktreeId, top } = checkoutAt(process.cwd());
const { token, ports, databases, session, compose } = verifyResources(worktreeId);
const chrome = chromeFiles(mainCheckout);

const values: Record<string, string | number> = {
  VERIFY_MAIN: mainCheckout,
  VERIFY_TOP: top,
  VERIFY_TOKEN: token,
  VERIFY_PORT: ports.head,
  VERIFY_REF_PORT: ports.ref,
  VERIFY_DATABASE: databases.head,
  VERIFY_REF_DATABASE: databases.ref,
  VERIFY_SESSION: session,
  VERIFY_COMPOSE_PROJECT: compose.project,
  VERIFY_COMPOSE_WEB_PORT: compose.ports.web,
  VERIFY_COMPOSE_CUSTODIAN_PORT: compose.ports.custodian,
  VERIFY_COMPOSE_MAILPIT_PORT: compose.ports.mailpit,
  VERIFY_COMPOSE_DB_PORT: compose.ports.db,
  VERIFY_DIR: verifyDir(mainCheckout),
  VERIFY_STATE: stateDirOf({ mainCheckout, token }),
  VERIFY_REF_CHECKOUTS: refCheckoutsDir(mainCheckout),
  VERIFY_CHROME_PID: chrome.pid,
  VERIFY_CHROME_PROFILE: chrome.profile,
  VERIFY_CHROME_OWNER: chrome.owner,
};

// Single-quoted, with any `'` closed, escaped and reopened, so a path with spaces stays one word.
const quote = (value: string | number) => `'${String(value).replaceAll("'", `'\\''`)}'`;
for (const [key, value] of Object.entries(values)) console.log(`${key}=${quote(value)}`);
