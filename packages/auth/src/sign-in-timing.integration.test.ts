// A sign-in request's response must not wait on anything whose cost depends on the address
// (ADR 0006): timing would reveal which addresses can sign in.
import { test as dbTest } from "@repo/db/testing";
import { auditEvent, verification } from "@repo/db/schema";
import type { EmailMessage } from "@repo/email";
import { parseSignInEmail } from "@repo/testing/mailpit";
import { createTestAuth, type TestAuth } from "./testing";

const ADA = "ada@example.com";
const ATTACKER = "203.0.113.66";

/** Test auth whose background tasks are only recorded, until `runTasks()` runs them in order. */
const test = dbTest.extend("deferred", ({ orm }) => {
  const tasks: (() => Promise<void>)[] = [];
  const t = createTestAuth({ orm, runInBackground: (task) => void tasks.push(task) });
  async function runTasks() {
    while (tasks.length > 0) {
      // In order, as the requests came.
      // oxlint-disable-next-line no-await-in-loop
      await tasks.shift()!();
    }
  }
  return { t, tasks, runTasks };
});

async function requestSignIn(t: TestAuth, email: string, ip?: string) {
  const response = await t.fetchAuth("/sign-in/magic-link", {
    body: { email },
    ...(ip === undefined ? {} : { ip }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: true });
}

/**
 * Everything the background work could touch: mail, credentials (verification rows), audit rows
 * and our own rate-limit counters (`consumeRateLimit` keeps them under `rl:`).
 */
async function snapshot(t: TestAuth) {
  return {
    mail: t.mailer.messages.length,
    credentials: await t.auth.$deps.db.$count(verification),
    audit: await t.auth.$deps.db.$count(auditEvent),
    limits: t.storage.keys().filter((key) => key.startsWith("rl:")).length,
  };
}

const credentials = (t: TestAuth) => t.auth.$deps.db.$count(verification);

describe("sign-in request timing", () => {
  test.for([
    ["an unknown address", "stranger@example.com"],
    ["an eligible address", ADA],
    ["a throttled address", ADA],
  ] as const)(
    "answers %s before any address-dependent work starts",
    async ([kind, email], { deferred: { t, tasks, runTasks } }) => {
      await t.seedUser({ email: ADA });
      if (kind === "a throttled address") {
        for (let i = 0; i < 3; i++) {
          // Sequential on purpose: each request counts against the limits the next one sees.
          // oxlint-disable-next-line no-await-in-loop
          await requestSignIn(t, ADA, ATTACKER);
        }
        await runTasks();
        await t.auth.$deps.db.delete(verification);
      }
      const before = await snapshot(t);

      await requestSignIn(t, email, ATTACKER);
      // Only the plugin's own link insert, the same for every address, happened in-request.
      expect(tasks).toHaveLength(1);
      expect(await snapshot(t)).toEqual({ ...before, credentials: before.credentials + 1 });

      await runTasks();
      const after = await snapshot(t);
      if (kind === "an eligible address") {
        // The link and the code.
        expect(after.mail).toBe(before.mail + 1);
        expect(after.credentials).toBe(before.credentials + 2);
      } else {
        // No usable credential left behind.
        expect(after.mail).toBe(before.mail);
        expect(after.credentials).toBe(before.credentials);
        expect(after.audit).toBe(before.audit + (kind === "a throttled address" ? 1 : 0));
      }
    },
  );

  test("the limits suite's ordering holds once tasks run", async ({
    deferred: { t, runTasks },
  }) => {
    await t.seedUser({ email: ADA });
    // All four answered before any limit was counted; run in order, the fourth is refused.
    for (let i = 0; i < 4; i++) {
      // oxlint-disable-next-line no-await-in-loop
      await requestSignIn(t, ADA, ATTACKER);
    }
    expect(t.mailer.messages).toHaveLength(0);
    await runTasks();
    expect(t.mailer.messages).toHaveLength(3);
    // That the refused fourth leaves no link is owned by the limits suite.
  });
});

describe("background failures", () => {
  test("are logged, discard the link and leave the response alone", async ({ orm }) => {
    const t = createTestAuth({ orm });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // The provider fails, but the message it was handed shows which link would have gone out.
    const handed: EmailMessage[] = [];
    vi.spyOn(t.mailer, "send").mockImplementationOnce(async (message) => {
      handed.push(message);
      throw new Error("mail provider down");
    });
    await t.seedUser({ email: ADA });

    await requestSignIn(t, ADA);
    await t.settle();
    expect(error).toHaveBeenCalledWith("Sign-in request failed", expect.any(Error));
    const { token } = parseSignInEmail(handed[0]!.text);
    const verify = await t.fetchAuth(`/magic-link/verify?token=${encodeURIComponent(token)}`);
    expect(await verify.json()).toEqual({ ok: false, error: "invalid_or_expired" });
  });

  test("a runner that throws doesn't reach the response, and the link is discarded", async ({
    orm,
  }) => {
    const t = createTestAuth({
      orm,
      runInBackground: () => {
        throw new Error("no runner");
      },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await t.seedUser({ email: ADA });

    await requestSignIn(t, ADA);
    expect(error).toHaveBeenCalledWith("Sign-in request failed", expect.any(Error));
    expect(await credentials(t)).toBe(0);
    expect(t.mailer.messages).toEqual([]);
  });
});
