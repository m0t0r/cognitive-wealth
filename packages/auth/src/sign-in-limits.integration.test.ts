// Sign-in email limits and the device cookie (docs/auth.md, "Sign-in email limits"). Parsing the
// cookie and its value layout are owned by device.test.ts; here, what needs Better Auth.
import { auditEvent, invitation, verification } from "@repo/db/schema";
import { parseSetCookies } from "@repo/testing/sign-in";
import { eq } from "drizzle-orm";
import { AUTH_BASE_PATH, DEVICE_COOKIE_NAMES } from "./constants";
import { DEVICE_COOKIE_MAX_AGE } from "./device";
import { createMemoryStorage } from "./storage/memory";
import { authTest as test, createTestAuth, TEST_BASE_URL, type TestAuth } from "./testing";

const ADA = "ada@example.com";
const ATTACKER = "203.0.113.66";
const [DEVICE, SECURE_DEVICE] = DEVICE_COOKIE_NAMES;
const VERIFY_URL = new URL(`${TEST_BASE_URL}${AUTH_BASE_PATH}/magic-link/verify`);

/** From `ip`, with `cookie` as the `Cookie` header. */
type Init = { ip?: string; cookie?: string };

/** Moves the faked clock forward `n` minutes. */
function minutes(n: number) {
  vi.setSystemTime(Date.now() + n * 60_000);
}

/** Sends `count` sign-in requests for `email`, each answered `{ status: true }`, then lets sends finish. */
async function requestEmails({
  t,
  email,
  count,
  ip,
  cookie,
}: Init & { t: TestAuth; email: string; count: number }) {
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
async function emailsFor({ t, email, ...init }: Init & { t: TestAuth; email: string }) {
  const before = t.mailer.messages.length;
  await requestEmails({ t, email, count: 1, ...init });
  return t.mailer.messages.slice(before).filter((m) => m.to === email).length;
}

/** The device cookie `response` set, as a browser would store it at `now`; `undefined` if none. */
function deviceCookieOf({
  response,
  name = DEVICE,
  now = Date.now(),
}: {
  response: Response;
  name?: string;
  now?: number;
}) {
  return parseSetCookies({
    headers: response.headers.getSetCookie(),
    requestUrl: VERIFY_URL,
    now,
  }).find((cookie) => cookie.name === name);
}

/** `name=value` of the device cookie `response` set, ready for a `Cookie` header. */
function deviceCookie(response: Response, name: string = DEVICE): string {
  const cookie = deviceCookieOf({ response, name });
  if (cookie === undefined) throw new Error("No device cookie set");
  return `${cookie.name}=${cookie.value}`;
}

/** Names of every cookie `response` sets, including ones it deletes. */
const setCookieNames = (response: Response) =>
  response.headers.getSetCookie().map((header) => header.slice(0, header.indexOf("=")));

/**
 * `cookie` with one character of its signature changed. better-call signs a cookie as
 * `<value>.<signature>`, so only the part after the last `.` is touched.
 */
function tamperSignature(cookie: string): string {
  const separator = cookie.indexOf("=");
  const raw = decodeURIComponent(cookie.slice(separator + 1));
  const at = raw.lastIndexOf(".") + 1;
  const flipped = raw[at] === "A" ? "B" : "A";
  return `${cookie.slice(0, separator)}=${encodeURIComponent(`${raw.slice(0, at)}${flipped}${raw.slice(at + 1)}`)}`;
}

/** Signs `email` in by link from a browser holding `cookie`, returning the verify response. */
async function signInFrom({ t, email, cookie }: { t: TestAuth; email: string; cookie?: string }) {
  const headers: Record<string, string> = cookie ? { cookie } : {};
  const { token } = await t.requestSignIn(email, { headers });
  const response = await t.fetchAuth(`/magic-link/verify?token=${encodeURIComponent(token)}`, {
    headers,
  });
  expect(response.status).toBe(200);
  return response;
}

/** Uses up the address's hourly backstop: `alreadySent` plus 3 per fresh IP, up to 10. */
async function exhaustAddress({
  t,
  email,
  alreadySent,
}: {
  t: TestAuth;
  email: string;
  alreadySent: number;
}) {
  let sent = alreadySent;
  for (let ip = 1; sent < 10; ip++) {
    const count = Math.min(3, 10 - sent);
    // oxlint-disable-next-line no-await-in-loop
    await requestEmails({ t, email, count, ip: `192.0.2.${ip}` });
    sent += count;
  }
  expect(await emailsFor({ t, email, ip: "192.0.2.200" })).toBe(0);
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
    await requestEmails({ t, email: ADA, count: 4, ip: ATTACKER });
    expect(t.mailer.messages).toHaveLength(3);

    expect(await emailsFor({ t, email: ADA, ip: "203.0.113.67" })).toBe(1);
  });

  test("allows 3 more after 10 minutes, and 6 in an hour", async ({ orm }) => {
    // Storage that reads the faked clock on every call, so windows expire as time moves.
    const t = createTestAuth({
      orm,
      secondaryStorage: createMemoryStorage({ now: () => Date.now() }),
    });
    await t.seedUser({ email: ADA });
    vi.useFakeTimers({ toFake: ["Date"] });
    onTestFinished(() => {
      vi.useRealTimers();
    });

    await requestEmails({ t, email: ADA, count: 4, ip: ATTACKER });
    expect(t.mailer.messages).toHaveLength(3);
    minutes(10);
    await requestEmails({ t, email: ADA, count: 4, ip: ATTACKER });
    expect(t.mailer.messages).toHaveLength(6);
    // A new 10 minutes, but the hour already has its 6.
    minutes(10);
    await requestEmails({ t, email: ADA, count: 1, ip: ATTACKER });
    expect(t.mailer.messages).toHaveLength(6);
    // An hour after the first email, both windows start again.
    minutes(40);
    await requestEmails({ t, email: ADA, count: 1, ip: ATTACKER });
    expect(t.mailer.messages).toHaveLength(7);
  });

  test("a refused request answers the same, issues no code, leaves no link, and is audited", async ({
    t,
  }) => {
    const ada = await t.seedUser({ email: ADA });
    await requestEmails({ t, email: ADA, count: 3, ip: ATTACKER });
    // Clear the three sent emails' links and code, so anything left comes from the refused one.
    await t.auth.$deps.db.delete(verification);

    expect(await emailsFor({ t, email: ADA, ip: ATTACKER })).toBe(0);
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
    await requestEmails({ t, email: "grace@example.com", count: 4, ip: ATTACKER });
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
    const cookie = deviceCookie(await signInFrom({ t, email: ADA }));
    // That sign-in's email was the first of the hour; 9 more from 3 IPs reach the backstop.
    await exhaustAddress({ t, email: ADA, alreadySent: 1 });
    expect(t.mailer.messages).toHaveLength(10);
    expect((await throttleEvents(t)).map((e) => e.metadata)).toEqual([{ rule: "address" }]);

    expect(await emailsFor({ t, email: ADA, ip: "192.0.2.201", cookie })).toBe(1);
  });

  test("an attacker's refused requests don't spend it", async ({ t }) => {
    await t.seedUser({ email: ADA });
    // 3 sent, 2 refused by the per-requester limit (5 stays under Better Auth's per-IP 429).
    await requestEmails({ t, email: ADA, count: 5, ip: ATTACKER });
    expect(t.mailer.messages).toHaveLength(3);

    // The other 7 of the 10 are still there for everyone else.
    await exhaustAddress({ t, email: ADA, alreadySent: 3 });
    expect(t.mailer.messages).toHaveLength(10);
  });
});

describe("known device", () => {
  test("has its own limit of 3 per 10 minutes", async ({ t }) => {
    const ada = await t.seedUser({ email: ADA });
    const cookie = deviceCookie(await signInFrom({ t, email: ADA }));
    // An attacker behind the user's NAT uses up the requester limit for that IP; the user's
    // own browser there still gets its email.
    await requestEmails({ t, email: ADA, count: 3, ip: ATTACKER });
    expect(await emailsFor({ t, email: ADA, ip: ATTACKER, cookie })).toBe(1);

    // Another IP (Better Auth's per-IP limit would stop a 6th request from this one).
    expect(await emailsFor({ t, email: ADA, ip: "203.0.113.67", cookie })).toBe(1);
    expect(await emailsFor({ t, email: ADA, ip: "203.0.113.67", cookie })).toBe(1);
    expect(await emailsFor({ t, email: ADA, ip: "203.0.113.67", cookie })).toBe(0);
    expect((await throttleEvents(t)).at(-1)).toMatchObject({
      targetId: ada.publicId,
      metadata: { rule: "device" },
    });
  });

  // The cookie's parser (wrong parts, bad issue time or device ID, age) is owned by
  // device.test.ts. These two need Better Auth: its signature check, and a real other user.
  test.for<[string, (cookies: { real: string; other: string }) => string]>([
    ["a tampered signature", ({ real }) => tamperSignature(real)],
    ["another user's valid cookie", ({ other }) => other],
  ])("gets no exemption with %s", async ([, forge], { t }) => {
    await t.seedUser({ email: ADA });
    await t.seedUser({ email: "grace@example.com" });
    const real = deviceCookie(await signInFrom({ t, email: ADA }));
    const other = deviceCookie(await signInFrom({ t, email: "grace@example.com" }));
    await exhaustAddress({ t, email: ADA, alreadySent: 1 });

    expect(
      await emailsFor({ t, email: ADA, ip: "192.0.2.201", cookie: forge({ real, other }) }),
    ).toBe(0);
    // The genuine cookie still works, so the forgery, not the setup, was refused.
    expect(await emailsFor({ t, email: ADA, ip: "192.0.2.202", cookie: real })).toBe(1);
  });
});

describe("device cookie", () => {
  test("is set on sign-in by link and by code, scoped to the auth endpoints", async ({ t }) => {
    await t.seedUser({ email: ADA });
    const byLink = await signInFrom({ t, email: ADA });
    const { code } = await t.requestSignIn(ADA);
    const byCode = await t.fetchAuth("/sign-in/email-otp", { body: { email: ADA, otp: code } });
    expect(byCode.status).toBe(200);

    const now = Date.now();
    for (const response of [byLink, byCode]) {
      expect(deviceCookieOf({ response, name: DEVICE, now })).toMatchObject({
        path: AUTH_BASE_PATH,
        expires: Math.floor(now / 1000) + DEVICE_COOKIE_MAX_AGE,
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      });
    }
  });

  test("gets the __Secure- prefix and Secure with secure cookies, and is read under that name", async ({
    orm,
  }) => {
    const t = createTestAuth({ orm, secureCookies: true });
    await t.seedUser({ email: ADA });
    const response = await signInFrom({ t, email: ADA });
    expect(deviceCookieOf({ response, name: SECURE_DEVICE })).toMatchObject({
      path: AUTH_BASE_PATH,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });
    expect(deviceCookieOf({ response, name: DEVICE })).toBeUndefined();

    // Past the requester limit, only a recognized device cookie still gets an email.
    await requestEmails({ t, email: ADA, count: 3, ip: ATTACKER });
    const cookie = deviceCookie(response, SECURE_DEVICE);
    expect(await emailsFor({ t, email: ADA, ip: ATTACKER, cookie })).toBe(1);
  });

  test("survives sign-out and still exempts", async ({ t }) => {
    await t.seedUser({ email: ADA });
    const signedIn = await signInFrom({ t, email: ADA });
    const cookie = deviceCookie(signedIn);
    const session = t.sessionHeaders(signedIn);

    const signOut = await t.fetchAuth("/sign-out", {
      body: {},
      headers: { cookie: session.get("cookie")! },
    });
    expect(signOut.status).toBe(200);
    expect(await t.auth.api.getSession({ headers: session })).toBeNull();
    // Neither replaced nor cleared.
    expect(setCookieNames(signOut)).not.toContain(DEVICE);

    await requestEmails({ t, email: ADA, count: 3, ip: ATTACKER });
    expect(await emailsFor({ t, email: ADA, ip: ATTACKER, cookie })).toBe(1);
  });

  test("a cookie issued by a real sign-in still exempts after signing in again, on the same device", async ({
    t,
  }) => {
    await t.seedUser({ email: ADA });
    const first = deviceCookie(await signInFrom({ t, email: ADA }));
    // Signing in again from that browser reissues the cookie; its request is the device's 1st.
    const again = deviceCookie(await signInFrom({ t, email: ADA, cookie: first }));

    // Past the requester limit, the reissued cookie is still recognized (the device's 2nd)…
    await requestEmails({ t, email: ADA, count: 3, ip: ATTACKER });
    expect(await emailsFor({ t, email: ADA, ip: ATTACKER, cookie: again })).toBe(1);
    // …and it kept the device ID: it shares the first cookie's limit of 3, so the 4th is refused.
    // (Another IP: Better Auth's per-IP limit would stop a 6th request from this one.)
    expect(await emailsFor({ t, email: ADA, ip: "203.0.113.67", cookie: again })).toBe(1);
    expect(await emailsFor({ t, email: ADA, ip: "203.0.113.67", cookie: again })).toBe(0);
  });
});
