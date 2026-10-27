import { Cli } from "incur";
import { commandGroups, createCli, withoutSeparator } from "./app";
import { dependencies, mcp, run } from "./testing";

describe("cw", () => {
  it("lists every command in its --llms manifest", async () => {
    const { output } = await run({ cli: createCli(dependencies()), argv: ["--llms"] });
    expect(output.commands).toMatchObject([
      { name: "custodian ingest" },
      { name: "cve scan" },
      { name: "db seed" },
      { name: "dev env" },
      { name: "dev prune" },
      { name: "dev sign-in" },
      { name: "dev teardown" },
      { name: "friction commit" },
      { name: "friction fix" },
      { name: "friction hand-back" },
      { name: "friction publish" },
      { name: "friction refresh" },
      { name: "friction report" },
      { name: "friction search" },
      { name: "friction start" },
      { name: "friction triage" },
      { name: "friction triage-backlog" },
      { name: "org create" },
      { name: "org deactivate" },
      { name: "org export" },
      { name: "org reactivate" },
      { name: "verify browser start" },
      { name: "verify browser stop" },
      { name: "verify compose down" },
      { name: "verify compose up" },
      { name: "verify start" },
      { name: "verify stop" },
      { name: "verify trace" },
    ]);
  });

  it("drops the -- pnpm 12 passes through (#104)", () => {
    expect(withoutSeparator(["org", "deactivate", "--", "--slug", "acme"])).toEqual([
      "org",
      "deactivate",
      "--slug",
      "acme",
    ]);
  });

  it("refuses an unknown flag with a code", async () => {
    const { output, exitCode } = await run({
      cli: createCli(dependencies()),
      argv: ["org", "deactivate", "--slug", "acme", "--reason", "x", "--force"],
    });
    expect(exitCode).toBe(1);
    expect(output).toMatchObject({ code: "UNKNOWN", message: "Unknown flag: --force" });
  });
});

describe("cw over MCP (ADR 0026)", () => {
  it("serves no tools at all", async () => {
    const response = await mcp({ cli: createCli(dependencies()), method: "tools/list" });
    expect(response.error?.message).toBe("Method not found");
  });

  it("keeps every command out even where tools are allowed, since each says mcp: false", async () => {
    // A root without cw's `exclude: ["*"]`, with one read-only command so it has tools to list.
    const open = Cli.create("open", { sync: false, update: false }).command("ping", {
      run: () => ({ pong: true }),
    });
    for (const group of commandGroups(dependencies())) open.command(group);
    const response = await mcp({
      cli: open,
      method: "tools/call",
      params: { name: "search_tools", arguments: { query: "", limit: 20 } },
    });
    expect(JSON.parse(response.result!.content![0]!.text)).toEqual({ tools: [{ name: "ping" }] });
  });
});
