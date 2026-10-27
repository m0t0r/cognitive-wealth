// Running `cw` in-process for tests: the real commands, with the dependencies a test hands in.
import type { Cli } from "incur";
import type { Dependencies } from "./dependencies.ts";

/** What a test needs of a `Cli`, whatever commands it holds. */
type Runnable = Pick<Cli.Cli, "serve" | "fetch">;

/** Dependencies that fail the test if a command reaches for one it wasn't given. */
export function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    openDatabase: () => Promise.reject(new Error("The test gave this command no database")),
    devEnv: () => Promise.reject(new Error("The test gave this command no dev environment")),
    verify: () => Promise.reject(new Error("The test gave this command no verifier state")),
    github: () => Promise.reject(new Error("The test gave this command no GitHub")),
    claude: () => Promise.reject(new Error("The test gave this command no Claude")),
    cveScan: () => Promise.reject(new Error("The test gave this command no cve.now scan")),
    ...overrides,
  };
}

/** Runs `argv` through `cli` with `--json`: the parsed output and the exit code. */
export async function run({ cli, argv }: { cli: Runnable; argv: string[] }) {
  let stdout = "";
  let exitCode = 0;
  await cli.serve([...argv, "--json"], {
    stdout: (text) => {
      stdout += text;
    },
    exit: (code) => {
      exitCode = code;
    },
  });
  const output: Record<string, unknown> = JSON.parse(stdout);
  return { output, exitCode };
}

type McpArgs = { cli: Runnable; method: string; params?: Record<string, unknown> };

/**
 * Sends one MCP request to `cli`'s MCP endpoint after an `initialize`, and returns the JSON-RPC
 * response. It reaches the same tools `--mcp` serves over stdio.
 */
export async function mcp({ cli, method, params = {} }: McpArgs) {
  const post = (body: unknown) =>
    cli.fetch(
      new Request("http://cw.test/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(body),
      }),
    );
  await post({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    },
  });
  const response = await post({ jsonrpc: "2.0", id: 2, method, params });
  const body: McpResponse = await response.json();
  return body;
}

type McpResponse = {
  result?: { content?: Array<{ text: string }> };
  error?: { message: string };
};
