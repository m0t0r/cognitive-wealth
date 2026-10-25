import { join } from "node:path";
import { RedisContainer } from "@testcontainers/redis";
import { openJanitor } from "@repo/testing/redis-janitor";
import { REPO_ROOT, composeImage } from "./compose";

/** compose.yaml's Redis entrypoint: it builds the ACL from the mounted secrets. */
const ENTRYPOINT = join(REPO_ROOT, "docker/redis/entrypoint.sh");
const ENTRYPOINT_TARGET = "/usr/local/bin/cw-redis-entrypoint.sh";

export interface RedisPasswords {
  /** The `app` user's, which the server gets. */
  app: string;
  /** The `janitor` user's (SCAN and DEL on `cw:*`), which only the fixtures use. */
  janitor: string;
}

/**
 * Starts Redis as compose.yaml does (same image, entrypoint and ACL, as the `redis` user, no
 * persistence), plus the e2e-only `janitor` user.
 */
export async function startRedis(passwords: RedisPasswords) {
  const container = await new RedisContainer(composeImage("redis"))
    .withUser("999:1000")
    .withEntrypoint(["/bin/sh", ENTRYPOINT_TARGET])
    .withCommand(["--save", "", "--appendonly", "no"])
    .withCopyFilesToContainer([{ source: ENTRYPOINT, target: ENTRYPOINT_TARGET, mode: 0o755 }])
    .withCopyContentToContainer([
      { content: passwords.app, target: "/run/secrets/redis_password", mode: 0o444 },
      { content: passwords.janitor, target: "/run/secrets/redis_janitor_password", mode: 0o444 },
    ])
    .withTmpFs({ "/run/redis": "rw,uid=999,gid=1000,mode=0700" })
    .start();
  return {
    /** Without a password: the server reads it from REDIS_PASSWORD_FILE, as in production. */
    url: `redis://app@${container.getHost()}:${container.getPort()}`,
    stop: () => container.stop(),
  };
}

/**
 * The janitor's connection, for one worker: `reset()` deletes every key under `prefix` (the
 * worker server's REDIS_KEY_PREFIX), so each test starts without rate-limit counters or cached
 * sessions from the one before.
 */
export async function connectJanitor({
  url,
  password,
  prefix,
}: {
  url: string;
  password: string;
  prefix: string;
}) {
  const janitor = await openJanitor({ url, password });
  return {
    reset: async () => {
      await janitor.deletePrefix(prefix);
    },
    close: janitor.close,
  };
}
