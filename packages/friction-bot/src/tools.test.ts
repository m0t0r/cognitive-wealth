import { repoPath, replaceOnce, tail, writablePath } from "./tools.ts";

const ROOT = "/repo";

describe("repoPath", () => {
  it.for([
    ["docs/agents/friction.md", "docs/agents/friction.md"],
    ["./CLAUDE.md", "CLAUDE.md"],
    ["/repo/packages/db/CLAUDE.md", "packages/db/CLAUDE.md"],
  ] as const)("keeps %s inside as %s", ([path, expected]) => {
    expect(repoPath({ root: ROOT, path })).toBe(expected);
  });

  it.for(["../outside.md", "/etc/passwd", ".", "docs/../../x"])("refuses %s", (path) => {
    expect(() => repoPath({ root: ROOT, path })).toThrow(/outside the repository/);
  });
});

describe("writablePath", () => {
  it.for([
    ".claude/hooks/require-worktree.mjs",
    ".claude/settings.json",
    ".claude/settings.local.json",
    ".github/workflows/ci.yml",
    ".git/config",
  ])("refuses %s", (path) => {
    expect(() => writablePath({ root: ROOT, path })).toThrow(/only by the user/);
  });

  it.for(["CLAUDE.md", ".claude/skills/verifier-web/SKILL.md", "docs/agents/friction.md"])(
    "allows %s",
    (path) => {
      expect(writablePath({ root: ROOT, path })).toBe(path);
    },
  );
});

describe("replaceOnce", () => {
  it("replaces the one occurrence, taking `$` literally", () => {
    expect(replaceOnce({ text: "a b c", oldString: "b", newString: "$&$1" })).toBe("a $&$1 c");
  });

  it.for([
    ["missing", "x", /isn't in the file/],
    ["empty", "", /isn't in the file/],
    ["repeated", "a", /more than once/],
  ] as const)("refuses old_string that is %s", ([, oldString, message]) => {
    expect(() => replaceOnce({ text: "a b a", oldString, newString: "z" })).toThrow(message);
  });
});

describe("tail", () => {
  it("keeps short output whole and the end of long output", () => {
    expect(tail("short")).toBe("short");
    const long = `${"x".repeat(40_000)}END`;
    expect(tail(long)).toMatch(/^… \(10003 characters cut\)\n/);
    expect(tail(long).endsWith("END")).toBe(true);
  });
});
