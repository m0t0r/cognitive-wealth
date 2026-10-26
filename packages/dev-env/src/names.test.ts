import {
  orphanTokens,
  tokenOfComposeProject,
  tokenOfDatabase,
  tokenOfRedisKey,
  tokenOfRefCheckout,
  tokenOfVerifyDatabase,
  verifyResources,
  worktreeResources,
} from "./names.ts";

describe("verifyResources", () => {
  it("gives a worktree its own ports, databases and agent-browser session, from its token", () => {
    // task_0ebb429f: 0x0ebb429f mod 399 = 342, so the pair at 3100 + 2 * (1 + 342).
    expect(verifyResources("task")).toEqual({
      token: "task_0ebb429f",
      ports: { head: 3786, ref: 3787 },
      databases: { head: "verify_task_0ebb429f_head", ref: "verify_task_0ebb429f_ref" },
      session: "verify-task_0ebb429f",
      compose: {
        project: "cw-compose-task_0ebb429f",
        ports: { web: 4786, custodian: 5786, mailpit: 6786 },
      },
    });
  });

  it("keeps the main checkout on 3100 and 3101, under a token no worktree can have", () => {
    expect(verifyResources(undefined)).toEqual({
      token: "main",
      ports: { head: 3100, ref: 3101 },
      databases: { head: "verify_main_head", ref: "verify_main_ref" },
      session: "verify",
      compose: { project: "cw-compose-main", ports: { web: 4100, custodian: 5100, mailpit: 6100 } },
    });
  });

  it("fits Postgres's 63-byte identifier limit for a long id", () => {
    const { head, ref } = verifyResources("x".repeat(200)).databases;
    expect(Buffer.byteLength(head)).toBeLessThanOrEqual(63);
    expect(Buffer.byteLength(ref)).toBeLessThanOrEqual(63);
  });

  it("puts every worktree's pair in 3102–3899, clear of the main checkout's", () => {
    for (const id of Array.from({ length: 500 }, (_, i) => `worktree-${i}`)) {
      const { head, ref } = verifyResources(id).ports;
      expect(head).toBeGreaterThanOrEqual(3102);
      expect(head % 2).toBe(0);
      expect(ref).toBe(head + 1);
      expect(ref).toBeLessThanOrEqual(3899);
    }
  });
});

describe("tokenOfVerifyDatabase", () => {
  it.each(["verify_task_0ebb429f_head", "verify_task_0ebb429f_ref"])(
    "reads the token back out of %s",
    (name) => {
      expect(tokenOfVerifyDatabase(name)).toBe("task_0ebb429f");
    },
  );

  it.each([
    "verify_main_head",
    "verify_3100",
    "verify_task_0ebb429f",
    "verify_task_0ebb429f_other",
    "wt_task_0ebb429f",
  ])("ignores %s, which isn't a worktree's verification database", (name) => {
    expect(tokenOfVerifyDatabase(name)).toBeUndefined();
  });
});

describe("orphanTokens", () => {
  const found = {
    databases: [
      "cognitive_wealth",
      "verify_main_head",
      "wt_gone_0000000a",
      "verify_gone_0000000b_head",
      "verify_live_0000000c_ref",
    ],
    redisKeys: ["cw:session", "cw:wt:gone_0000000d:x"],
    stateDirs: ["main", "gone_0000000e", "live_0000000c"],
    refCheckouts: ["main-56862fe", "gone_0000000f-56862fe", "live_0000000c-56862fe"],
    composeProjects: [
      "cognitive-wealth",
      "cognitive-wealth-verify",
      "cw-compose-main",
      "cw-compose-gone_00000010",
      "cw-compose-live_0000000c",
    ],
  };

  it("finds the worktrees that are gone from every kind of leftover, each token once", () => {
    expect(
      orphanTokens({
        ...found,
        live: new Set(["live_0000000c"]),
        databases: [...found.databases, "verify_gone_0000000a_ref"],
      }).toSorted(),
    ).toEqual([
      "gone_0000000a",
      "gone_0000000b",
      "gone_0000000d",
      "gone_0000000e",
      "gone_0000000f",
      "gone_00000010",
    ]);
  });

  it("leaves the main checkout's and live worktrees' leftovers alone", () => {
    expect(
      orphanTokens({
        live: new Set(["live_0000000c"]),
        databases: ["verify_main_head", "verify_live_0000000c_ref"],
        redisKeys: [],
        stateDirs: ["main", "live_0000000c"],
        refCheckouts: ["main-56862fe", "live_0000000c-56862fe"],
        composeProjects: ["cognitive-wealth", "cw-compose-main", "cw-compose-live_0000000c"],
      }),
    ).toEqual([]);
  });
});

describe("tokenOfComposeProject", () => {
  it("reads the token back out of a worktree's Compose project", () => {
    expect(tokenOfComposeProject("cw-compose-task_0ebb429f")).toBe("task_0ebb429f");
  });

  it.each(["cognitive-wealth", "cognitive-wealth-verify", "cw-compose-main", "cw-compose-task"])(
    "ignores %s, which isn't a worktree's Compose project",
    (name) => {
      expect(tokenOfComposeProject(name)).toBeUndefined();
    },
  );
});

describe("tokenOfRefCheckout", () => {
  it("reads the token back out of a worktree's --ref checkout", () => {
    expect(tokenOfRefCheckout("task_0ebb429f-56862fe")).toBe("task_0ebb429f");
  });

  it.each(["main-56862fe", "56862fe", "task_0ebb429f", "task_0ebb429f-xyz"])(
    "ignores %s, which isn't a worktree's --ref checkout",
    (name) => {
      expect(tokenOfRefCheckout(name)).toBeUndefined();
    },
  );
});

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
