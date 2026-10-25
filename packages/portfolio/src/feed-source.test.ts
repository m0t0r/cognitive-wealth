import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localFeedSource } from "./feed-source";

describe("localFeedSource", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "feed-"));
    mkdirSync(join(root, "2026-03-02"));
    writeFileSync(join(root, "2026-03-02", "prices.csv"), "security,price\n");
    writeFileSync(join(root, "2026-03-02", "manifest.json"), "{}");
    // What `LocalFeedStore.put` leaves while it writes: never a key.
    writeFileSync(join(root, "2026-03-02", ".prices.csv.0a1b.partial"), "secu");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("gets a key's bytes, as the custodian's store keys them", async () => {
    const bytes = await localFeedSource(root).get("2026-03-02/prices.csv");

    expect(new TextDecoder().decode(bytes)).toBe("security,price\n");
  });

  it("gets nothing for a key that isn't there", async () => {
    expect(await localFeedSource(root).get("2026-03-03/manifest.json")).toBeUndefined();
  });

  it("lists the keys under a prefix, sorted, leaving out half-written files", async () => {
    expect(await localFeedSource(root).list("2026-03-02/")).toEqual([
      "2026-03-02/manifest.json",
      "2026-03-02/prices.csv",
    ]);
    expect(await localFeedSource(root).list("2026-03-03/")).toEqual([]);
  });

  it("lists nothing when the feed has no directory yet", async () => {
    expect(await localFeedSource(join(root, "missing")).list("")).toEqual([]);
  });

  it.each(["../secrets.csv", "/etc/passwd", "2026-03-02/../../x", ""])(
    "refuses the key %j, which isn't inside the feed",
    async (key) => {
      await expect(localFeedSource(root).get(key)).rejects.toThrow(/relative path inside/);
    },
  );
});
