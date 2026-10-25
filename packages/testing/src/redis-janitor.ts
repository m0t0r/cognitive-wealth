// The Redis ACL's `janitor` user (SCAN and DEL on `cw:*`): e2e empties a worker's keys with it, and
// `@repo/dev-env` a worktree's. Node runs the dev-env CLIs that import this directly (type
// stripping), so it imports nothing but Node built-ins.
import { once } from "node:events";
import { type Socket, connect } from "node:net";

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
 * Just enough of a Redis client (RESP2 over one socket) for the janitor: neither user has a Redis
 * client dependency, and the janitor only needs AUTH, SCAN and DEL.
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

  static async open({ host, port }: { host: string; port: number }): Promise<RespConnection> {
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

/** The SCAN pattern for every key under `prefix`, with glob characters in it escaped. */
export function prefixPattern(prefix: string) {
  if (!prefix.startsWith("cw:")) throw new Error(`The ACL only allows cw:* keys, got ${prefix}`);
  return `${prefix.replace(/[*?[\]\\]/g, "\\$&")}*`;
}

/** Signs in as `janitor` at `url` (its host and port; the user and password come separately). */
export async function openJanitor({ url, password }: { url: string; password: string }) {
  const { hostname, port } = new URL(url);
  const connection = await RespConnection.open({ host: hostname, port: Number(port) });
  try {
    await connection.command("AUTH", "janitor", password);
  } catch (error) {
    await connection.close();
    throw error;
  }

  /** Every key matching the SCAN `pattern`. */
  async function keys(pattern: string): Promise<string[]> {
    const found: string[] = [];
    async function scan(cursor: string): Promise<string[]> {
      const reply = await connection.command("SCAN", cursor, "MATCH", pattern, "COUNT", "1000");
      if (!Array.isArray(reply) || typeof reply[0] !== "string" || !Array.isArray(reply[1])) {
        throw new Error(`Unexpected SCAN reply: ${JSON.stringify(reply)}`);
      }
      found.push(...reply[1].filter((key) => typeof key === "string"));
      return reply[0] === "0" ? found : scan(reply[0]);
    }
    return scan("0");
  }

  /** Deletes every key under `prefix` and returns how many there were. */
  async function deletePrefix(prefix: string): Promise<number> {
    const matching = await keys(prefixPattern(prefix));
    // DEL in batches, so a large keyspace never builds one huge command.
    for (let start = 0; start < matching.length; start += 1000) {
      // Sequential on purpose: one connection, and each batch is already large.
      // oxlint-disable-next-line no-await-in-loop
      await connection.command("DEL", ...matching.slice(start, start + 1000));
    }
    return matching.length;
  }

  return { keys, deletePrefix, close: () => connection.close() };
}
