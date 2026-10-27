// The verification services (compose.verify.yaml) as a worktree's dev environment uses them: the
// Postgres superuser for creating and dropping databases, and Redis's `janitor` for its keys.
// Node runs the CLIs that import this directly (type stripping), so relative imports keep their
// `.ts` extension.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "@repo/db/connect";
import { openJanitor } from "@repo/testing/redis-janitor";
import { VERIFY_PORTS } from "./env-file.ts";

/** The `.secrets/` files a worktree's setup and the app read. */
const SECRETS = [
  "postgres_password",
  "db_migrator_password",
  "db_app_password",
  "redis_password",
  "better_auth_secret",
];

export const secretsDir = (mainCheckout: string) => join(mainCheckout, ".secrets");

const secret = ({ mainCheckout, name }: { mainCheckout: string; name: string }) =>
  readFileSync(join(secretsDir(mainCheckout), name), "utf8").trim();

export function assertSecrets(mainCheckout: string) {
  const missing = SECRETS.filter((name) => !existsSync(join(secretsDir(mainCheckout), name)));
  if (missing.length > 0) {
    throw new Error(
      `${secretsDir(mainCheckout)} lacks ${missing.join(", ")}: create them with the loop in ` +
        "compose.yaml's header (in the main checkout).",
    );
  }
}

/**
 * Starts the verification services if they aren't running. The project directory is the main
 * checkout, so `.secrets/` resolves there; the Compose files are this checkout's (`top`).
 */
export function startServices({ mainCheckout, top }: { mainCheckout: string; top: string }) {
  execFileSync(
    "docker",
    [
      "compose",
      "--project-directory",
      mainCheckout,
      "-f",
      join(top, "compose.yaml"),
      "-f",
      join(top, "compose.verify.yaml"),
      "up",
      "-d",
      "--wait",
      "db",
      "redis",
      "mailpit",
    ],
    // Compose's progress lines are noise on every `pnpm dev`; on failure they're on the error.
    { stdio: ["ignore", "pipe", "pipe"] },
  );
}

/** True for the error a client gets when nothing listens on the port. */
export function isRefused(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  return code === "ECONNREFUSED" || /ECONNREFUSED/.test(error.message);
}

/** A superuser connection to `database` on the verification Postgres. */
function connectSuperuser({ mainCheckout, database }: { mainCheckout: string; database: string }) {
  return connect(
    {
      url: `postgres://postgres@localhost:${VERIFY_PORTS.postgres}/${database}`,
      password: () => secret({ mainCheckout, name: "postgres_password" }),
    },
    { max: 1, connect_timeout: 5 },
  );
}

/** A superuser connection to the verification Postgres's `postgres` database. */
export function connectAdmin(mainCheckout: string) {
  return connectSuperuser({ mainCheckout, database: "postgres" });
}

/** Creates `database` unless it exists; true when it did. */
export async function createDatabase({
  mainCheckout,
  database,
}: {
  mainCheckout: string;
  database: string;
}) {
  const { client, close } = connectAdmin(mainCheckout);
  try {
    const [existing] = await client`select 1 from pg_database where datname = ${database}`;
    if (existing) return false;
    // Cloned from the empty `cognitive_wealth`, which holds the roles' privileges, and the
    // `connect` grant a clone doesn't copy repeated (`packages/db/CLAUDE.md`).
    await client.unsafe(`create database "${database}" owner migrator template cognitive_wealth`);
    await client.unsafe(`revoke all on database "${database}" from public`);
    await client.unsafe(`grant connect on database "${database}" to app`);
    return true;
  } finally {
    await close();
  }
}

/** Drops `database` if it's there and creates it empty, as a verification server's fresh start. */
export async function recreateDatabase(args: { mainCheckout: string; database: string }) {
  await dropDatabase(args);
  await createDatabase(args);
}

/**
 * Every Household in `database`, by name, read as the superuser, since row-level security shows
 * `app` none without a Firm set. None in a database from before Households (#86).
 */
export async function householdsIn({
  mainCheckout,
  database,
}: {
  mainCheckout: string;
  database: string;
}): Promise<Array<{ name: string; publicId: string }>> {
  const { client, close } = connectSuperuser({ mainCheckout, database });
  try {
    const exists = await client`select to_regclass('public.household') is not null as found`;
    if (!exists[0]?.found) return [];
    const rows = await client`select name, public_id from household order by name`;
    return rows.map((row) => ({ name: String(row.name), publicId: String(row.public_id) }));
  } finally {
    await close();
  }
}

/** Drops `database` if it exists; `with (force)` ends open connections, which would block it. */
export async function dropDatabase({
  mainCheckout,
  database,
}: {
  mainCheckout: string;
  database: string;
}): Promise<boolean> {
  const { client, close } = connectAdmin(mainCheckout);
  try {
    const [existing] = await client`select 1 from pg_database where datname = ${database}`;
    if (!existing) return false;
    await client.unsafe(`drop database "${database}" with (force)`);
    return true;
  } finally {
    await close();
  }
}

/**
 * The verification Redis as `janitor`. compose.verify.yaml gives it `redis_password` too, so the
 * throwaway stack needs no secret of its own.
 */
export function connectJanitor(mainCheckout: string) {
  return openJanitor({
    url: `redis://localhost:${VERIFY_PORTS.redis}`,
    password: secret({ mainCheckout, name: "redis_password" }),
  });
}
