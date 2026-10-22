// A sign-in request's response must not wait on anything whose cost depends on the address
// (ADR 0001, "Sign-in request"): timing would reveal which addresses can sign in.
import { test as dbTest } from "@repo/db/testing";
import { auditEvent, verification } from "@repo/db/schema";
import { sql } from "drizzle-orm";
import { describe, expect, vi } from "vitest";
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

/** Everything the background work could touch: mail, verification rows, audit rows, limits. */
async function snapshot(t: TestAuth) {
  const rows = await t.auth.$deps.db
    .select({ identifier: verification.identifier })
    .from(verification)
    .orderBy(verification.identifier);
  return {
    mail: t.mailer.messages.length,
    verification: rows.map(({ identifier }) =>
      identifier.startsWith("magic-link:") ? "magic-link" : identifier,
    ),
    audit: await t.auth.$deps.db.$count(auditEvent),
    limits: t.storage.keys().filter((key) => key.startsWith("rl:sign-in-email:")),
  };
}

const magicLinks = (t: TestAuth) =>
  t.auth.$deps.db.$count(verification, sql`starts_with(${verification.identifier}, 'magic-link:')`);

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
      expect(await snapshot(t)).toEqual({
        ...before,
        verification: [...before.verification, "magic-link"],
      });

      await runTasks();
      const after = await snapshot(t);
      if (kind === "an eligible address") {
        expect(after.mail).toBe(before.mail + 1);
        expect(after.verification).toEqual(["magic-link", `sign-in-otp-${ADA}`]);
      } else {
        expect(after.mail).toBe(before.mail);
        expect(after.verification).toEqual(before.verification);
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
    expect(await magicLinks(t)).toBe(3);
  });
});

describe("background failures", () => {
  test("are logged, discard the link and leave the response alone", async ({ orm }) => {
    const t = createTestAuth({ orm });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(t.mailer, "send").mockRejectedValueOnce(new Error("mail provider down"));
    await t.seedUser({ email: ADA });

    await requestSignIn(t, ADA);
    await t.settle();
    expect(error).toHaveBeenCalledWith("Sign-in request failed", expect.any(Error));
    expect(await magicLinks(t)).toBe(0);
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
    expect(await magicLinks(t)).toBe(0);
    expect(t.mailer.messages).toEqual([]);
  });
});
