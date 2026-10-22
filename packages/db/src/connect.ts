import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export interface ConnectionConfig {
  url: string;
  /** Overrides any password in `url`; called on each new connection. */
  password?: (() => string) | undefined;
}

/** A Drizzle client over its own postgres.js pool. `close()` ends the pool. */
export function connect({ url, password }: ConnectionConfig, options: postgres.Options<{}> = {}) {
  const client = postgres(url, { password, onnotice: () => {}, ...options });
  return { db: drizzle({ client }), client, close: () => client.end() };
}
