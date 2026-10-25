import { readFile, readdir } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";

/**
 * Where Ingestion reads the Custodian feed from: the reading half of the custodian's `FeedStore`
 * (`apps/custodian/src/custodian/feed_store.py`). A key is a path such as
 * `2026-03-02/manifest.json`: the Delivery's As-of date, then the file. For now
 * `localFeedSource` reads the custodian's local directory; SeaweedFS takes its place in #54.
 */
export interface FeedSource {
  /** The bytes stored under `key`, or `undefined` when there are none. */
  get(key: string): Promise<Uint8Array | undefined>;
  /** Every key that starts with `prefix`, sorted. */
  list(prefix: string): Promise<string[]>;
}

/** A Delivery's key for one of its files, as the custodian's `delivery_key` makes it. */
export const deliveryKey = (asOf: string, name: string) => `${asOf}/${name}`;

/**
 * The feed in a local directory, as `LocalFeedStore` writes it: key `2026-03-02/prices.csv` is
 * that file under `root`. Like the store, it skips dot-files, the half-written `.partial` ones.
 */
export function localFeedSource(root: string): FeedSource {
  return {
    async get(key) {
      try {
        return await readFile(pathOf(root, key));
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
        throw error;
      }
    },
    async list(prefix) {
      let entries;
      try {
        entries = await readdir(root, { recursive: true, withFileTypes: true });
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
        throw error;
      }
      return entries
        .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
        .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"))
        .filter((key) => key.startsWith(prefix))
        .toSorted();
    },
  };
}

/** The file for `key`, refusing a key that would land outside `root`, as the store does. */
function pathOf(root: string, key: string): string {
  const parts = key.split("/");
  if (!key || posix.isAbsolute(key) || parts.includes("..")) {
    throw new Error(`A feed key is a relative path inside the feed, not ${JSON.stringify(key)}`);
  }
  return join(root, ...parts);
}
