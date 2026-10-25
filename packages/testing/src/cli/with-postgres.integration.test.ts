import { spawn } from "node:child_process";
import { join } from "node:path";
import postgres from "postgres";
import { type PostgresServer, SHARED_POSTGRES_ENV } from "../postgres-server";

const CLI = join(import.meta.dirname, "with-postgres.ts");

/** Runs the CLI with `command`; resolves with its exit code and what it printed. */
function runCli(command: string[]): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...command], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout }));
  });
}

// The child prints the server it was handed, proves it answers, then fails with exit code 3.
const CHILD = `
const server = JSON.parse(process.env.${SHARED_POSTGRES_ENV});
const { default: postgres } = await import("postgres");
const sql = postgres(server.url, { max: 1 });
const [row] = await sql\`select 1 as one\`;
await sql.end();
console.log(JSON.stringify({ server, one: row.one }));
process.exit(3);
`;

describe("with-postgres", () => {
  test("hands the command a running server, passes its exit code on, then stops the server", async () => {
    const { code, stdout } = await runCli([process.execPath, "--input-type=module", "-e", CHILD]);

    expect(code).toBe(3);
    const { server, one }: { server: PostgresServer; one: number } = JSON.parse(
      stdout.trim().split("\n").at(-1)!,
    );
    expect(one).toBe(1);

    const sql = postgres(server.url, { max: 1, connect_timeout: 2 });
    try {
      await expect(sql`select 1`).rejects.toThrow();
    } finally {
      await sql.end();
    }
  }, 60_000);
});
