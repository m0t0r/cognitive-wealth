// `pnpm org:deactivate` and `pnpm org:reactivate` (ADR 0022): the operator's way to deactivate a
// Firm that leaves, and to bring one back. Like `org:create`, it runs against any database,
// production included. Node runs this file directly (type stripping), so relative imports keep
// their `.ts` extension, and modules that import the schema load after `registerTsResolution()`.
import { connectionConfig } from "../config.ts";
import { connect } from "../connect.ts";
import { describeDatabaseUrl, loadWebEnvFallback } from "./env.ts";
import { registerTsResolution } from "./ts-resolution.ts";

registerTsResolution();
const { CliError, deactivateOrganization, parseOrganizationStatusArgs, reactivateOrganization } =
  await import("./organizations.ts");

const COMMANDS = {
  deactivate: {
    usage: `Usage: pnpm org:deactivate --slug <slug> --reason <text>

Deactivates an organization that leaves Cognitive Wealth (ADR 0022). Its records and members are
kept, its pending invitations are canceled, and from their next request its members can't act in
it. Nobody is signed out. Undo it with pnpm org:reactivate.`,
    run: deactivateOrganization,
    done: "Deactivated",
    showCanceled: true,
  },
  reactivate: {
    usage: `Usage: pnpm org:reactivate --slug <slug> --reason <text>

Reactivates a deactivated organization: its members find it again on their next request.
Invitations canceled when it was deactivated stay canceled.`,
    run: reactivateOrganization,
    done: "Reactivated",
    showCanceled: false,
  },
} as const;

const OPTIONS = `
  --slug <slug>    The organization's slug.
  --reason <text>  Why, for the audit log (org.deactivated or org.reactivated).

Connects with DATABASE_URL (and DATABASE_PASSWORD_FILE, if set). When DATABASE_URL is unset, both
are read from apps/web/.env.local, the pnpm dev database, except in a git worktree.`;

async function main() {
  // The package script names the command: `node org-status.ts deactivate`.
  const [name, ...args] = process.argv.slice(2);
  if (name !== "deactivate" && name !== "reactivate") {
    throw new CliError(
      `Usage: node org-status.ts deactivate|reactivate --slug <slug> --reason <text>`,
    );
  }
  const command = COMMANDS[name];
  const usage = `${command.usage}\n${OPTIONS}`;
  const parsed = parseOrganizationStatusArgs({ args, usage });
  if (parsed.help) {
    console.log(usage);
    return;
  }

  const envFile = loadWebEnvFallback();
  const config = connectionConfig();
  console.log(`Database: ${describeDatabaseUrl(config.url)}${envFile ? ` (from ${envFile})` : ""}`);
  const { db, close } = connect(config, { max: 1 });
  try {
    const org = await command.run(db, { slug: parsed.slug, reason: parsed.reason });
    console.log(`${command.done} ${org.name}`);
    console.log(`  publicId: ${org.publicId}`);
    console.log(`  slug:     ${org.slug}`);
    console.log(`  at:       ${org.at.toISOString()}`);
    if (command.showCanceled) {
      console.log(`  canceled: ${org.canceledInvitations} pending invitation(s)`);
    }
  } finally {
    await close();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
