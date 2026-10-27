import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelMessage } from "ai";
import { fix, fixPrompt, withCacheBreakpoint } from "./fix.ts";
import { scriptedModel } from "./testing/mock-model.ts";

const answer = {
  fixed: [{ number: 7, summary: "Fixed the typo in notes.md." }],
  skipped: [],
  friction: [],
};

describe("fixPrompt", () => {
  it("names the reports and keeps their text inside the data tag", () => {
    const prompt = fixPrompt({ numbers: [7, 9], issues: '[{"number":7}]' });
    expect(prompt).toContain("#7, #9");
    expect(prompt).toContain('<reports>\n[{"number":7}]\n</reports>');
  });
});

describe("withCacheBreakpoint", () => {
  const cache = { cacheControl: { type: "ephemeral" } };

  it("leaves one breakpoint, on the last message", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "first", providerOptions: { anthropic: { ...cache } } },
      { role: "assistant", content: "second" },
      { role: "user", content: "third" },
    ];

    const marked = withCacheBreakpoint(withCacheBreakpoint(messages));

    expect(marked.map((message) => message.providerOptions?.anthropic?.cacheControl)).toEqual([
      undefined,
      undefined,
      cache.cacheControl,
    ]);
    expect(marked.map((message) => message.content)).toEqual(["first", "second", "third"]);
  });
});

describe("fix", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "friction-bot-"));
    await writeFile(join(root, "notes.md"), "teh\n");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("runs the tools the model calls and returns its answer", async () => {
    const { model, calls } = scriptedModel({
      responses: [
        {
          toolCall: {
            name: "edit_file",
            input: { path: "notes.md", old_string: "teh", new_string: "the" },
          },
        },
        { text: JSON.stringify(answer) },
      ],
    });

    const { result, steps } = await fix({
      root,
      numbers: [7],
      issues: "[]",
      maxSteps: 10,
      maxCostUsd: 5,
      model,
    });

    expect(result).toEqual(answer);
    expect(steps).toBe(2);
    expect(await readFile(join(root, "notes.md"), "utf8")).toBe("the\n");
    // The second call reads the first from the cache.
    expect(calls()[1]?.prompt.at(-1)?.providerOptions?.anthropic?.cacheControl).toEqual({
      type: "ephemeral",
    });
  });

  it("tells the model it can't write where only the user changes things", async () => {
    const { model, calls } = scriptedModel({
      responses: [
        {
          toolCall: {
            name: "write_file",
            input: { path: ".github/workflows/x.yml", content: "on: push" },
          },
        },
        { text: JSON.stringify(answer) },
      ],
    });

    await fix({ root, numbers: [7], issues: "[]", maxSteps: 10, maxCostUsd: 5, model });

    expect(JSON.stringify(calls()[1]?.prompt)).toContain("only by the user");
    await expect(readFile(join(root, ".github/workflows/x.yml"), "utf8")).rejects.toThrow(/ENOENT/);
  });

  it("deletes a file the model asks to, but not one only the user changes", async () => {
    await mkdir(join(root, ".claude/skills/x"), { recursive: true });
    await writeFile(join(root, ".claude/skills/x/SKILL.md"), "skill\n");
    const { model, calls } = scriptedModel({
      responses: [
        { toolCall: { name: "delete_file", input: { path: "notes.md" } } },
        { toolCall: { name: "delete_file", input: { path: ".claude/skills/x/SKILL.md" } } },
        { text: JSON.stringify(answer) },
      ],
    });

    await fix({ root, numbers: [7], issues: "[]", maxSteps: 10, maxCostUsd: 5, model });

    await expect(readFile(join(root, "notes.md"), "utf8")).rejects.toThrow(/ENOENT/);
    expect(await readFile(join(root, ".claude/skills/x/SKILL.md"), "utf8")).toBe("skill\n");
    expect(JSON.stringify(calls()[2]?.prompt)).toContain("only by the user");
  });

  it("stops at the cost cap and gives no answer", async () => {
    const { model, calls } = scriptedModel({
      responses: [{ toolCall: { name: "read_file", input: { path: "notes.md" } } }],
      // $2 of input per step at Sonnet 5.5's price.
      usage: { input: 1_000_000, output: 0 },
    });

    await expect(
      fix({ root, numbers: [7], issues: "[]", maxSteps: 10, maxCostUsd: 3, model }),
    ).rejects.toThrow();
    expect(calls()).toHaveLength(2);
  });
});
