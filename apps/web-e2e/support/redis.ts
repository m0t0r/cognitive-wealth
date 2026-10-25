import { once } from "node:events";
import { type Socket, connect } from "node:net";
import { join } from "node:path";
import { RedisContainer } from "@testcontainers/redis";
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

type Reply = string | number | null | Reply[];

class RedisReplyError extends Error {}

/** Parses one RESP2 reply at `start`, or returns undefined if the buffer doesn't hold all of it. */
function parseReply(
  buffer: Buffer,
  start: number,
): { value: Reply | RedisReplyError; end: number } | undefined {
  const lineEnd = buffer.indexOf("\r\n", start);
  if (lineEnd === -1) return undefined;
  const line = buffer.toString("utf8", start + 1, lineEnd);
  const next = lineEnd + 2;
  switch (String.fromCodePoint(buffer[start] ?? 0)) {
    case "+":
      return { value: line, end: next };
    case "-":
      return { value: new RedisReplyError(line), end: next };
    case ":":
      return { value: Number(line), end: next };
    case "$": {
      const length = Number(line);
      if (length === -1) return { value: null, end: next };
      if (buffer.length < next + length + 2) return undefined;
      return { value: buffer.toString("utf8", next, next + length), end: next + length + 2 };
    }
    case "*": {
      const count = Number(line);
      if (count === -1) return { value: null, end: next };
      const items: Reply[] = [];
      let position = next;
      for (let index = 0; index < count; index++) {
        const item = parseReply(buffer, position);
        if (!item) return undefined;
        if (item.value instanceof RedisReplyError) return { value: item.value, end: item.end };
        items.push(item.value);
        position = item.end;
      }
      return { value: items, end: position };
    }
    default:
      throw new Error(`Unexpected RESP reply: ${line}`);
  }
}

/**
 * Just enough of a Redis client (RESP2 over one socket) to empty a worker's keys: this package
 * has no Redis client dependency, and the janitor only needs AUTH, SCAN and DEL.
 */
class RespConnection {
  #socket: Socket;
  #buffer = Buffer.alloc(0);
  #pending: Array<{ resolve: (reply: Reply) => void; reject: (error: Error) => void }> = [];

  private constructor(socket: Socket) {
    this.#socket = socket;
    socket.on("data", (chunk: Buffer) => this.#receive(chunk));
    socket.on("error", (error) => this.#failAll(error));
    socket.on("close", () => this.#failAll(new Error("Redis connection closed")));
  }

  static async open(host: string, port: number): Promise<RespConnection> {
    const socket = connect({ host, port });
    await once(socket, "connect");
    return new RespConnection(socket);
  }

  command(...args: string[]): Promise<Reply> {
    const encoded = args.map((arg) => `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`).join("");
    return new Promise((resolve, reject) => {
      this.#pending.push({ resolve, reject });
      this.#socket.write(`*${args.length}\r\n${encoded}`);
    });
  }

  async close() {
    this.#socket.end();
    if (!this.#socket.closed) await once(this.#socket, "close");
  }

  #receive(chunk: Buffer) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    for (;;) {
      const reply = parseReply(this.#buffer, 0);
      if (!reply) return;
      this.#buffer = this.#buffer.subarray(reply.end);
      const waiter = this.#pending.shift();
      if (reply.value instanceof RedisReplyError) waiter?.reject(reply.value);
      else waiter?.resolve(reply.value);
    }
  }

  #failAll(error: Error) {
    for (const waiter of this.#pending.splice(0)) waiter.reject(error);
  }
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
  if (!prefix.startsWith("cw:")) throw new Error(`The ACL only allows cw:* keys, got ${prefix}`);
  const { hostname, port } = new URL(url);
  const connection = await RespConnection.open(hostname, Number(port));
  await connection.command("AUTH", "janitor", password);
  const pattern = `${prefix.replace(/[*?[\]\\]/g, "\\$&")}*`;

  async function reset(cursor = "0"): Promise<void> {
    const reply = await connection.command("SCAN", cursor, "MATCH", pattern, "COUNT", "1000");
    if (!Array.isArray(reply) || typeof reply[0] !== "string" || !Array.isArray(reply[1])) {
      throw new Error(`Unexpected SCAN reply: ${JSON.stringify(reply)}`);
    }
    const keys = reply[1].filter((key) => typeof key === "string");
    if (keys.length > 0) await connection.command("DEL", ...keys);
    if (reply[0] !== "0") await reset(reply[0]);
  }

  return { reset: () => reset(), close: () => connection.close() };
}
