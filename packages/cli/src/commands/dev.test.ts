import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listen, startFakeMailpit } from "@repo/testing/fake-mailpit";
import type { DevEnv } from "../dependencies";
import { createCli } from "../app";
import { dependencies, run } from "../testing";

/**
 * A fake app whose sign-in request emails a link and code to a fake Mailpit, and whose verify
 * sets a session cookie; it records each request's `x-forwarded-for`.
 */
async function startFakes() {
  const mailpit = await startFakeMailpit();
  onTestFinished(mailpit.close);
  const ips: (string | string[] | undefined)[] = [];
  const app = await listen((request, response) => {
    ips.push(request.headers["x-forwarded-for"]);
    response.setHeader("content-type", "application/json");
    if (request.url?.startsWith("/api/auth/magic-link/verify")) {
      response.setHeader("set-cookie", "cw.session_token=abc; Path=/; HttpOnly; SameSite=Lax");
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    mailpit.deliver({
      to: "ann@example.test",
      subject: "Sign in to Cognitive Wealth",
      text: `Sign-in link: ${app.url}/sign-in/confirm#token=abc&next=%2F\nSign-in code: 123456\n`,
    });
    response.end(JSON.stringify({ status: true }));
  });
  onTestFinished(app.close);
  return { argv: ["--app", app.url, "--mailpit", mailpit.url], app, ips };
}

describe("cw dev sign-in", () => {
  const cli = createCli(dependencies());

  it("saves the session and returns the file it wrote", async () => {
    const { argv, app } = await startFakes();
    const dir = await mkdtemp(join(tmpdir(), "cw-sign-in-"));
    onTestFinished(() => rm(dir, { recursive: true, force: true }));
    const state = join(dir, "ann.json");

    const { output, exitCode } = await run({
      cli,
      argv: ["dev", "sign-in", "Ann@Example.test", ...argv, "--state", state],
    });

    expect(exitCode).toBe(0);
    expect(output).toMatchObject({ email: "ann@example.test", statePath: state, app: app.url });
    expect(JSON.parse(await readFile(state, "utf8")).cookies).toMatchObject([
      { name: "cw.session_token", value: "abc" },
    ]);
    expect((await stat(state)).mode & 0o777).toBe(0o600);
  });

  it("with --link, returns the link and code, sent from --ip", async () => {
    const { argv, app, ips } = await startFakes();

    const { output, exitCode } = await run({
      cli,
      argv: ["dev", "sign-in", "ann@example.test", "--link", ...argv, "--ip", "10.77.0.3"],
    });

    expect(exitCode).toBe(0);
    expect(output).toEqual({
      email: "ann@example.test",
      link: `${app.url}/sign-in/confirm#token=abc&next=%2F`,
      code: "123456",
    });
    expect(ips).toEqual(["10.77.0.3"]);
  });

  it("refuses an app that isn't local as not_local", async () => {
    const { output, exitCode } = await run({
      cli,
      argv: ["dev", "sign-in", "ann@example.test", "--app", "https://cognitive-wealth.com"],
    });
    expect(exitCode).toBe(1);
    expect(output).toMatchObject({ code: "not_local" });
  });

  it.for([
    { name: "an email that isn't one", argv: ["nobody"], path: "email" },
    { name: "an --ip that isn't one", argv: ["a@b.test", "--ip", "10.77.0"], path: "ip" },
    { name: "two addresses as --ip", argv: ["a@b.test", "--ip", "10.0.0.1, 10.0.0.2"], path: "ip" },
  ])("refuses $name as VALIDATION_ERROR", async ({ argv, path }) => {
    const { output, exitCode } = await run({ cli, argv: ["dev", "sign-in", ...argv] });
    expect(exitCode).toBe(1);
    expect(output).toMatchObject({ code: "VALIDATION_ERROR", fieldErrors: [{ path }] });
  });
});

const ORPHAN = {
  token: "gone_0badc0de",
  database: "wt_gone_0badc0de",
  redisPrefix: "cw:wt:gone_0badc0de:",
};

/** A dev environment with one orphan, whose `prune` gives back `pruned`. */
function devEnv(pruned: Awaited<ReturnType<DevEnv["prune"]>>) {
  const env = {
    mainCheckout: "/repo",
    findOrphans: vi.fn(async () => ({
      environments: [{ ...ORPHAN, server: { pid: 41 } }],
      servers: [{ pid: 42, cwd: "/old/apps/web" }],
    })),
    prune: vi.fn(async () => pruned),
  };
  return { env, cli: createCli(dependencies({ devEnv: async () => env })) };
}

describe("cw dev prune", () => {
  it("lists the orphans with --dry-run, and tears nothing down", async () => {
    const { env, cli } = devEnv({ removed: [], failed: [] });
    const { output, exitCode } = await run({ cli, argv: ["dev", "prune", "--dry-run"] });
    expect(exitCode).toBe(0);
    expect(output).toEqual({
      dryRun: true,
      removed: [],
      orphans: [{ database: ORPHAN.database, redisPrefix: ORPHAN.redisPrefix, pid: 41 }],
      servers: [{ pid: 42, cwd: "/old/apps/web" }],
    });
    expect(env.prune).not.toHaveBeenCalled();
  });

  it("says what it tore down", async () => {
    const { env, cli } = devEnv({ removed: ["wt_gone_0badc0de: dropped"], failed: [] });
    const { output, exitCode } = await run({ cli, argv: ["dev", "prune"] });
    expect(exitCode).toBe(0);
    expect(output).toMatchObject({ dryRun: false, removed: ["wt_gone_0badc0de: dropped"] });
    expect(env.prune).toHaveBeenCalledWith("/repo");
  });

  it("fails with prune_failed, retryable, naming every failure", async () => {
    const { cli } = devEnv({ removed: ["a: dropped"], failed: ["b: Redis said no"] });
    const { output, exitCode } = await run({ cli, argv: ["dev", "prune"] });
    expect(exitCode).toBe(1);
    expect(output).toMatchObject({
      code: "prune_failed",
      retryable: true,
      message: "Tore down 1, and failed on:\nb: Redis said no",
    });
  });
});
