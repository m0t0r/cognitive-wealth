import { createHash } from "node:crypto";
import type { Database } from "@repo/db";
import {
  custodialAccount,
  custodialPosition,
  custodialTransaction,
  custodianDelivery,
  security,
  securityPrice,
} from "@repo/db/schema";
import { ManifestFile } from "@repo/custodian-client/schemas";
import { asc } from "drizzle-orm";
import { z } from "zod";
import type { FeedSource } from "./feed-source";

/** Every row of every table Ingestion writes to, in a stable order. */
export async function feedRows(db: Database) {
  const [deliveries, accounts, securities, transactions, positions, prices] = await Promise.all([
    db.select().from(custodianDelivery).orderBy(asc(custodianDelivery.id)),
    db.select().from(custodialAccount).orderBy(asc(custodialAccount.id)),
    db.select().from(security).orderBy(asc(security.id)),
    db.select().from(custodialTransaction).orderBy(asc(custodialTransaction.id)),
    db.select().from(custodialPosition).orderBy(asc(custodialPosition.id)),
    db.select().from(securityPrice).orderBy(asc(securityPrice.id)),
  ]);
  return { deliveries, accounts, securities, transactions, positions, prices };
}

/**
 * A feed source over `base`, with some keys' contents replaced (`edits`) or removed (`null`), for
 * a Delivery damaged on the way.
 */
export function editedFeedSource({
  base,
  edits,
}: {
  base: FeedSource;
  edits: Record<string, string | null>;
}): FeedSource {
  return {
    async get(key) {
      if (!(key in edits)) return base.get(key);
      const edit = edits[key];
      return edit === null || edit === undefined ? undefined : new TextEncoder().encode(edit);
    },
    async list(prefix) {
      const keys = new Set(await base.list(prefix));
      for (const [key, edit] of Object.entries(edits)) {
        if (!key.startsWith(prefix)) continue;
        if (edit === null) keys.delete(key);
        else keys.add(key);
      }
      return [...keys].toSorted();
    },
  };
}

// A Manifest's files, keeping its other fields as they are.
const ManifestFiles = z.looseObject({ files: z.array(ManifestFile) });

/**
 * `base`'s Delivery for `asOf` with some files' text replaced, and a Manifest rewritten to match
 * them: as if the Custodian really wrote it this way, so it passes the Manifest check and only its
 * rows can be wrong. `editManifest` changes the Manifest's JSON after that.
 */
export async function rewrittenDelivery({
  base,
  asOf,
  files = {},
  editManifest = (json) => json,
}: {
  base: FeedSource;
  asOf: string;
  files?: Record<string, string>;
  editManifest?: (json: Record<string, unknown>) => Record<string, unknown>;
}): Promise<FeedSource> {
  const json = ManifestFiles.parse(
    JSON.parse(await textOf({ source: base, key: `${asOf}/manifest.json` })),
  );
  for (const entry of json.files) {
    const text = files[entry.name];
    if (text === undefined) continue;
    entry.rows = text.trimEnd().split("\n").length - 1;
    entry.sha256 = createHash("sha256").update(text).digest("hex");
  }
  return editedFeedSource({
    base,
    edits: {
      ...Object.fromEntries(Object.entries(files).map(([name, text]) => [`${asOf}/${name}`, text])),
      [`${asOf}/manifest.json`]: JSON.stringify(editManifest(json), null, 2),
    },
  });
}

/** The text stored under `key`, which must exist. */
export async function textOf({
  source,
  key,
}: {
  source: FeedSource;
  key: string;
}): Promise<string> {
  const bytes = await source.get(key);
  if (!bytes) throw new Error(`The feed source has no ${key}`);
  return new TextDecoder().decode(bytes);
}
