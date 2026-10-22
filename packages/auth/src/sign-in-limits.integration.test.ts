// Sign-in email limits and the device cookie (ADR 0001, "Sign-in request", step 2).
import { test as dbTest } from "@repo/db/testing";
import { auditEvent, invitation, verification } from "@repo/db/schema";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, vi } from "vitest";
import { DEVICE_COOKIE_MAX_AGE } from "./device";
import { createTestAuth, TEST_SECRET, type TestAuth } from "./testing";

const test = dbTest.extend("t", ({ orm }) => createTestAuth({ orm }));

const ADA = "ada@example.com";
const ATTACKER = "203.0.113.66";
const DEVICE = "cw.device";
// 16 bytes of base64url: a device ID the parser accepts.
const WELL_FORMED_ID = "AAAAAAAAAAAAAAAAAAAAAA";

/** From `ip`, with `cookie` as the `Cookie` header. */
type Init = { ip?: string; cookie?: string };

/** Sends `count` sign-in requests for `email`, each answered `{ status: true }`, then lets sends finish. */
async function requestEmails(t: TestAuth, email: string, count: number, { ip, cookie }: Init = {}) {
  for (let i = 0; i < count; i++) {
    // Sequential on purpose: each request counts against the limits the next one sees.
    // oxlint-disable-next-line no-await-in-loop
    const response = await t.fetchAuth("/sign-in/magic-link", {
      ...(ip === undefined ? {} : { ip }),
      ...(cookie === undefined ? {} : { headers: { cookie } }),
      body: { email },
    });
    expect(response.status).toBe(200);
    // oxlint-disable-next-line no-await-in-loop
    expect(await response.json()).toEqual({ status: true });
  }
  await t.settle();
}

/** Emails to `email` sent by one request, made like `requestEmails`. */
async function emailsFor(t: TestAuth, email: string, init: Init = {}) {
  const before = t.mailer.messages.length;
  await requestEmails(t, email, 1, init);
  return t.mailer.messages.slice(before).filter((m) => m.to === email).length;
}

/** The `Set-Cookie` header for the device cookie, if `response` set one. */
function deviceSetCookie(response: Response, name = DEVICE): string | undefined {
  return response.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
}

/** `name=value` of the device cookie `response` set, ready for a `Cookie` header. */
function deviceCookie(response: Response, name = DEVICE): string {
  const header = deviceSetCookie(response, name);
  if (header === undefined) throw new Error("No device cookie set");
  return header.split(";")[0]!;
}

/** The signed payload (`publicId.issuedAt.deviceId`) and signature of a device cookie. */
function decode(cookie: string) {
  const raw = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));
  const dot = raw.lastIndexOf(".");
  const [publicId, issuedAt, deviceId] = raw.slice(0, dot).split(".");
  return {
    payload: raw.slice(0, dot),
    signature: raw.slice(dot + 1),
    publicId,
    issuedAt,
    deviceId,
  };
}

/** A device cookie with `payload` signed by the test secret, as better-call signs it. */
function signed(payload: string): string {
  const signature = createHmac("sha256", TEST_SECRET).update(payload).digest("base64");
  return `${DEVICE}=${encodeURIComponent(`${payload}.${signature}`)}`;
}

/** Signs `email` in by link from a browser holding `cookie`, returning the verify response. */
async function signInFrom(t: TestAuth, email: string, cookie?: string) {
  const headers: Record<string, string> = cookie ? { cookie } : {};
  const { token } = await t.requestSignIn(email, { headers });
  const response = await t.fetchAuth(`/magic-link/verify?token=${encodeURIComponent(token)}`, {
    headers,
  });
  expect(response.status).toBe(200);
  return response;
}

/** Uses up the address's hourly backstop: `alreadySent` plus 3 per fresh IP, up to 10. */
async function exhaustAddress(t: TestAuth, email: string, alreadySent: number) {
  let sent = alreadySent;
  for (let ip = 1; sent < 10; ip++) {
    const count = Math.min(3, 10 - sent);
    // oxlint-disable-next-line no-await-in-loop
    await requestEmails(t, email, count, { ip: `192.0.2.${ip}` });
    sent += count;
  }
  expect(await emailsFor(t, email, { ip: "192.0.2.200" })).toBe(0);
}

const throttleEvents = (t: TestAuth) =>
  t.auth.$deps.db
    .select({
      actorUserId: auditEvent.actorUserId,
      targetType: auditEvent.targetType,
      targetId: auditEvent.targetId,
      ipAddress: auditEvent.ipAddress,
      metadata: auditEvent.metadata,
    })
    .from(auditEvent)
    .where(eq(auditEvent.action, "auth.sign_in_throttled"))
    .orderBy(auditEvent.id);

describe("per-requester limit", () => {
  test("an attacker's 3 requests don't stop another requester's email", async ({ t }) => {
    await t.seedUser({ email: ADA });
    await requestEmails(t, ADA, 4, { ip: ATTACKER });
    expect(t.mailer.messages).toHaveLength(3);

    expect(await emailsFor(t, ADA, { ip: "203.0.113.67" })).toBe(1);
  });

  test("a refused request answers the same, issues no code, leaves no link, and is audited", async ({
    t,
  }) => {
    const ada = await t.seedUser({ email: ADA });
    await requestEmails(t, ADA, 3, { ip: ATTACKER });
    // Clear the three sent emails' links and code, so anything left comes from the refused one.
    await t.auth.$deps.db.delete(verification);

    expect(await emailsFor(t, ADA, { ip: ATTACKER })).toBe(0);
    expect(await t.auth.$deps.db.$count(verification)).toBe(0);
    const events = await throttleEvents(t);
    expect(events).toEqual([
      {
        actorUserId: null,
        targetType: "user",
        targetId: ada.publicId,
        ipAddress: ATTACKER,
        metadata: { rule: "requester" },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("@");
  });

  test("an invitee is throttled too, audited without a target", async ({ t }) => {
    const inviter = await t.seedUser({ email: "inviter@example.com" });
    const org = await t.seedOrganization({
      name: "Acme",
      slug: "acme",
      members: [{ userId: inviter.id, role: "owner" }],
    });
    await t.auth.$deps.db.insert(invitation).values({
      organizationId: org.id,
      inviterId: inviter.id,
      email: "grace@example.com",
      role: "member",
      status: "pending",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await requestEmails(t, "grace@example.com", 4, { ip: ATTACKER });
    expect(t.mailer.messages).toHaveLength(3);
    expect(await throttleEvents(t)).toEqual([
      expect.objectContaining({
        targetType: null,
        targetId: null,
        metadata: { rule: "requester" },
      }),
    ]);
  });
});

describe("per-address backstop", () => {
  test("stops new requesters at 10 an hour, but not the user's own browser", async ({ t }) => {
    await t.seedUser({ email: ADA });
    const cookie = deviceCookie(await signInFrom(t, ADA));
    // That sign-in's email was the first of the hour; 9 more from 3 IPs reach the backstop.
    await exhaustAddress(t, ADA, 1);
    expect(t.mailer.messages).toHaveLength(10);
    expect((await throttleEvents(t)).map((e) => e.metadata)).toEqual([{ rule: "address" }]);

    expect(await emailsFor(t, ADA, { ip: "192.0.2.201", cookie })).toBe(1);
  });

  test("an attacker's refused requests don't spend it", async ({ t }) => {
    await t.seedUser({ email: ADA });
    // 3 sent, 2 refused by the per-requester limit (5 stays under Better Auth's per-IP 429).
    await requestEmails(t, ADA, 5, { ip: ATTACKER });
    expect(t.mailer.messages).toHaveLength(3);

    // The other 7 of the 10 are still there for everyone else.
    await exhaustAddress(t, ADA, 3);
    expect(t.mailer.messages).toHaveLength(10);
  });
});

describe("known device", () => {
  test("has its own limit of 3 per 10 minutes", async ({ t }) => {
    const ada = await t.seedUser({ email: ADA });
    const cookie = deviceCookie(await signInFrom(t, ADA));
    // An attacker behind the user's NAT uses up the requester limit for that IP; the user's
    // own browser there still gets its email.
    await requestEmails(t, ADA, 3, { ip: ATTACKER });
    expect(await emailsFor(t, ADA, { ip: ATTACKER, cookie })).toBe(1);

    // Another IP (Better Auth's per-IP limit would stop a 6th request from this one).
    expect(await emailsFor(t, ADA, { ip: "203.0.113.67", cookie })).toBe(1);
    expect(await emailsFor(t, ADA, { ip: "203.0.113.67", cookie })).toBe(1);
    expect(await emailsFor(t, ADA, { ip: "203.0.113.67", cookie })).toBe(0);
    expect((await throttleEvents(t)).at(-1)).toMatchObject({
      targetId: ada.publicId,
      metadata: { rule: "device" },
    });
  });

  test.for<[string, (s: { real: string; other: string }) => string]>([
    [
      "a tampered signature",
      ({ real }) => {
        const { payload, signature } = decode(real);
        const flipped = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
        return `${DEVICE}=${encodeURIComponent(`${payload}.${flipped}`)}`;
      },
    ],
    [
      "a tampered value",
      ({ real }) => {
        const { publicId, issuedAt, signature } = decode(real);
        return `${DEVICE}=${encodeURIComponent(`${publicId}.${issuedAt}.${WELL_FORMED_ID}.${signature}`)}`;
      },
    ],
    ["no signature", ({ real }) => `${DEVICE}=${encodeURIComponent(decode(real).payload)}`],
    ["another user's cookie", ({ other }) => other],
    ["a signed value that isn't a device cookie", () => signed("not-a-device-cookie")],
    [
      "a signed value with a short device ID",
      ({ real }) => {
        const { publicId, issuedAt } = decode(real);
        return signed(`${publicId}.${issuedAt}.short`);
      },
    ],
    [
      "a signed value with a non-numeric issue time",
      ({ real }) => signed(`${decode(real).publicId}.soon.${WELL_FORMED_ID}`),
    ],
    [
      "a signed value issued in the future",
      ({ real }) => {
        const future = Math.floor(Date.now() / 1000) + 3600;
        return signed(`${decode(real).publicId}.${future}.${WELL_FORMED_ID}`);
      },
    ],
    [
      "a signed value with an extra part",
      ({ real }) => signed(`${decode(real).payload}.${WELL_FORMED_ID}`),
    ],
  ])("gets no exemption with %s", async ([, forge], { t }) => {
    await t.seedUser({ email: ADA });
    await t.seedUser({ email: "grace@example.com" });
    const real = deviceCookie(await signInFrom(t, ADA));
    const other = deviceCookie(await signInFrom(t, "grace@example.com"));
    await exhaustAddress(t, ADA, 1);

    expect(await emailsFor(t, ADA, { ip: "192.0.2.201", cookie: forge({ real, other }) })).toBe(0);
    // The genuine cookie still works, so the forgery, not the setup, was refused.
    expect(await emailsFor(t, ADA, { ip: "192.0.2.202", cookie: real })).toBe(1);
  });

  test("gets no exemption with a cookie older than 180 days", async ({ t }) => {
    await t.seedUser({ email: ADA });
    const cookie = deviceCookie(await signInFrom(t, ADA));
    await exhaustAddress(t, ADA, 1);

    // Only `Date` moves; the rate-limit counters (on the real clock) stay where they are.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + (DEVICE_COOKIE_MAX_AGE + 60) * 1000 });
    try {
      expect(await emailsFor(t, ADA, { ip: "192.0.2.201", cookie })).toBe(0);
    } finally {
      vi.useRealTimers();
    }
    expect(await emailsFor(t, ADA, { ip: "192.0.2.202", cookie })).toBe(1);
  });
});

describe("device cookie", () => {
  test("is set on sign-in by link and by code, scoped to the auth endpoints", async ({ t }) => {
    await t.seedUser({ email: ADA });
    const byLink = deviceSetCookie(await signInFrom(t, ADA));
    const { code } = await t.requestSignIn(ADA);
    const byCode = deviceSetCookie(
      await t.fetchAuth("/sign-in/email-otp", { body: { email: ADA, otp: code } }),
    );

    for (const header of [byLink, byCode]) {
      expect(header).toMatch(
        /^cw\.device=[^;]+; Max-Age=15552000; Path=\/api\/auth; HttpOnly; SameSite=Lax$/,
      );
    }
  });

  test("gets the __Secure- prefix and Secure with secure cookies", async ({ orm }) => {
    const t = createTestAuth({ orm, secureCookies: true });
    await t.seedUser({ email: ADA });
    const response = await signInFrom(t, ADA);
    const header = deviceSetCookie(response, `__Secure-${DEVICE}`);
    expect(header).toMatch(
      /^__Secure-cw\.device=[^;]+; Max-Age=15552000; Path=\/api\/auth; HttpOnly; Secure; SameSite=Lax$/,
    );
    expect(deviceSetCookie(response)).toBeUndefined();

    // And it's read under that name: the request is counted against the device rule.
    const cookie = deviceCookie(response, `__Secure-${DEVICE}`);
    expect(await emailsFor(t, ADA, { cookie })).toBe(1);
    const { deviceId } = decode(cookie);
    expect(t.storage.keys()).toContain(`rl:sign-in-email:dev:${ADA}:${deviceId}`);
  });

  test("survives sign-out and keeps its device ID across sign-ins", async ({ t }) => {
    const ada = await t.seedUser({ email: ADA });
    await t.seedUser({ email: "grace@example.com" });
    const first = await signInFrom(t, ADA);
    const cookie = deviceCookie(first);
    expect(decode(cookie).publicId).toBe(ada.publicId);
    expect(decode(cookie).issuedAt).toMatch(/^\d+$/);

    const signOut = await t.fetchAuth("/sign-out", {
      body: {},
      headers: { cookie: t.sessionHeaders(first).get("cookie")! },
    });
    expect(signOut.status).toBe(200);
    expect(signOut.headers.getSetCookie().some((c) => c.includes("session_token=;"))).toBe(true);
    expect(deviceSetCookie(signOut)).toBeUndefined();

    const again = deviceCookie(await signInFrom(t, ADA, cookie));
    expect(decode(again).deviceId).toBe(decode(cookie).deviceId);

    // Another user on the same browser gets a device ID of their own.
    const grace = deviceCookie(await signInFrom(t, "grace@example.com", again));
    expect(decode(grace).deviceId).not.toBe(decode(cookie).deviceId);
  });
});
