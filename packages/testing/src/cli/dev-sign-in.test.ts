import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { listen, startFakeMailpit } from "../fake-mailpit";

const run = promisify(execFile);
const CLI = fileURLToPath(new URL("./dev-sign-in.ts", import.meta.url));

describe("pnpm dev:sign-in --ip", () => {
  it("sends the sign-in request from that client IP", async () => {
    const mailpit = await startFakeMailpit();
    onTestFinished(mailpit.close);
    const seen: (string | string[] | undefined)[] = [];
    const app = await listen((request, response) => {
      seen.push(request.headers["x-forwarded-for"]);
      response.setHeader("content-type", "application/json");
      mailpit.deliver({
        to: "ann@example.test",
        subject: "Sign in to Cognitive Wealth",
        text: `Sign-in link: ${app.url}/sign-in/confirm#token=abc&next=%2F\nSign-in code: 123456\n`,
      });
      response.end(JSON.stringify({ status: true }));
    });
    onTestFinished(app.close);

    const { stdout } = await run(process.execPath, [
      CLI,
      "ann@example.test",
      "--link",
      "--app",
      app.url,
      "--mailpit",
      mailpit.url,
      "--ip",
      "10.77.0.3",
    ]);

    expect(seen).toEqual(["10.77.0.3"]);
    expect(stdout).toContain("Sign-in code: 123456");
  });
});
