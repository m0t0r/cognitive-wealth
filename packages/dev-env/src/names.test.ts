import { tokenOfDatabase, tokenOfRedisKey, worktreeResources } from "./names.ts";

describe("worktreeResources", () => {
  it("names the database and Redis prefix after the worktree id, with a hash of it", () => {
    expect(worktreeResources("task")).toEqual({
      token: "task_0ebb429f",
      database: "wt_task_0ebb429f",
      redisPrefix: "cw:wt:task_0ebb429f:",
    });
  });

  it("lowercases the id and turns anything but letters and digits into underscores", () => {
    expect(worktreeResources("feat/Billing-2").database).toBe("wt_feat_billing_2_92c1c89d");
  });

  it("keeps ids that differ only in punctuation apart", () => {
    expect(worktreeResources("a-b").database).not.toBe(worktreeResources("a_b").database);
  });

  it("fits Postgres's 63-byte identifier limit for a long id", () => {
    const { database } = worktreeResources("x".repeat(200));
    expect(Buffer.byteLength(database)).toBeLessThanOrEqual(63);
    expect(database).toMatch(/^wt_[a-z0-9_]+$/);
  });

  it("still names an id with no letters or digits", () => {
    expect(worktreeResources("---").database).toMatch(/^wt_worktree_[0-9a-f]{8}$/);
  });

  it("gives a prefix the app's REDIS_KEY_PREFIX rule accepts", () => {
    expect(worktreeResources("feat/Billing-2").redisPrefix).toMatch(/^cw:[A-Za-z0-9:_-]+$/);
  });
});

describe("tokenOfDatabase", () => {
  it("reads the token back out of a worktree's database", () => {
    expect(tokenOfDatabase("wt_task_0ebb429f")).toBe("task_0ebb429f");
  });

  it.each(["cognitive_wealth", "verify_3100", "postgres", "template1", "wt_task", "wt_x_0EBB429F"])(
    "ignores %s, which no worktree created",
    (name) => {
      expect(tokenOfDatabase(name)).toBeUndefined();
    },
  );
});

describe("tokenOfRedisKey", () => {
  it("reads the token back out of a key under a worktree's prefix", () => {
    expect(tokenOfRedisKey("cw:wt:task_0ebb429f:active-sessions-1")).toBe("task_0ebb429f");
  });

  it.each(["cw:e2e-1:session", "cw:session", "cw:wt:", "cw:wt:task_0ebb429f"])(
    "ignores %s, which isn't under a worktree's prefix",
    (key) => {
      expect(tokenOfRedisKey(key)).toBeUndefined();
    },
  );
});
