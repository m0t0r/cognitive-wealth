// Sign-in through Better Auth and the route handler. Pure request rules (allowlist matching,
// Sec-Fetch and Origin checks, body validation, response stripping, callback sanitizing) are owned
// by route-handler.test.ts and callback-path.test.ts; each gets one wiring case here.
import { test as dbTest } from "@repo/db/testing";
import { auditEvent, invitation, member, organization, user, verification } from "@repo/db/schema";
import { parseSetCookies } from "@repo/testing/sign-in";
import { eq, sql } from "drizzle-orm";
import { describe, expect } from "vitest";
import { getViewer, switchOrganization } from "./tenant";
import { createTestAuth, TEST_BASE_URL, type TestAuth } from "./testing";

const test = dbTest.extend("t", ({ orm }) => createTestAuth({ orm }));

const verifyPath = (token: string) => `/magic-link/verify?token=${encodeURIComponent(token)}`;

async function verifyLink(t: TestAuth, token: string) {
  const response = await t.fetchAuth(verifyPath(token));
  return { status: response.status, body: await response.json(), response };
}

async function verifyCode(t: TestAuth, email: string, otp: string) {
  const response = await t.fetchAuth("/sign-in/email-otp", { body: { email, otp } });
  return { status: response.status, body: await response.json(), response };
}

/** A code that differs from `code` in every digit. */
const wrongCode = (code: string) => code.replace(/\d/g, (d) => String((Number(d) + 1) % 10));

async function seedInvitation(
  t: TestAuth,
  email: string,
  { expiresAt = new Date(Date.now() + 86_400_000), status = "pending" } = {},
) {
  const inviter = await t.seedUser({ email: `inviter-${crypto.randomUUID()}@example.com` });
  const org = await t.seedOrganization({
    name: "Acme",
    slug: `acme-${crypto.randomUUID()}`,
    members: [{ userId: inviter.id, role: "owner" }],
  });
  await t.auth.$deps.db.insert(invitation).values({
    organizationId: org.id,
    inviterId: inviter.id,
    email,
    role: "member",
    status,
    expiresAt,
  });
  return org;
}

/** The publicId of the organization the session behind `headers` works in, or `null`. */
const activeOrganization = async (t: TestAuth, headers: Headers) =>
  (await getViewer(t.auth, headers))?.tenant?.organization.publicId ?? null;

const expireAllVerifications = (t: TestAuth) =>
  t.auth.$deps.db.update(verification).set({ expiresAt: sql`now() - interval '1 second'` });

describe("sign-in by link", () => {
  test("signs an existing user in, with `{ ok: true }` and the session cookie", async ({ t }) => {
    await t.seedUser({ email: "ada@example.com" });
    const { token, code, next, url } = await t.requestSignIn("ada@example.com");
    expect(url.startsWith("http://localhost:3000/sign-in/confirm#token=")).toBe(true);
    expect(next).toBe("/");
    expect(code).toMatch(/^\d{6}$/);

    const { status, body, response } = await verifyLink(t, token);
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    const cookies = parseSetCookies(response.headers.getSetCookie(), new URL(TEST_BASE_URL));
    expect(cookies.map((cookie) => cookie.name)).toContain("cw.session_token");
    for (const cookie of cookies) {
      expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax" });
    }

    const session = await t.auth.api.getSession({ headers: t.sessionHeaders(response) });
    expect(session?.user.email).toBe("ada@example.com");
  });

  test("sends one email with the link, code, tags and a random idempotency key", async ({ t }) => {
    await t.seedUser({ email: "ada@example.com" });
    await t.requestSignIn("ada@example.com");
    const [message] = t.mailer.messages;
    expect(message).toMatchObject({ to: "ada@example.com", tags: { category: "sign_in" } });
    expect(message!.idempotencyKey).toMatch(/^sign-in\/[0-9a-f-]{36}$/);
    // The token never appears outside the fragment.
    expect(message!.text).not.toMatch(/[?&]token=/);
  });

  test("rejects a replayed link", async ({ t }) => {
    await t.seedUser({ email: "ada@example.com" });
    const { token } = await t.requestSignIn("ada@example.com");
    expect((await verifyLink(t, token)).status).toBe(200);

    const replay = await verifyLink(t, token);
    expect(replay).toMatchObject({ status: 400, body: { ok: false, error: "invalid_or_expired" } });
    expect(replay.response.headers.get("location")).toBeNull();
    expect(replay.response.headers.getSetCookie()).toEqual([]);
  });

  test("rejects an expired link", async ({ t }) => {
    await t.seedUser({ email: "ada@example.com" });
    const { token } = await t.requestSignIn("ada@example.com");
    await expireAllVerifications(t);

    expect(await verifyLink(t, token)).toMatchObject({
      status: 400,
      body: { ok: false, error: "invalid_or_expired" },
    });
  });

  test("rejects an unknown token", async ({ t }) => {
    expect(await verifyLink(t, "x".repeat(32))).toMatchObject({
      status: 400,
      body: { ok: false, error: "invalid_or_expired" },
    });
  });

  test("puts a sanitized callback path into the link's fragment", async ({ t }) => {
    await t.seedUser({ email: "ada@example.com" });
    const before = t.mailer.messages.length;
    const response = await t.fetchAuth("/sign-in/magic-link", {
      body: { email: "ada@example.com", callbackURL: "/invite/abc?x=1" },
    });
    expect(response.status).toBe(200);
    const message = await t.waitForEmail("ada@example.com", before);
    expect(message.text).toContain("#token=");
    expect(message.text).toContain("next=%2Finvite%2Fabc%3Fx%3D1");
  });

  test("refuses an off-site callback URL", async ({ t }) => {
    await t.seedUser({ email: "ada@example.com" });
    const response = await t.fetchAuth("/sign-in/magic-link", {
      body: { email: "ada@example.com", callbackURL: "//evil.com" },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "invalid_request" });
    await t.settle();
    expect(t.mailer.messages).toEqual([]);
  });
});

describe("sign-in by code", () => {
  test("signs in with the code from the email", async ({ t }) => {
    await t.seedUser({ email: "ada@example.com" });
    const { code } = await t.requestSignIn("ada@example.com");

    const { status, body, response } = await verifyCode(t, "ada@example.com", code);
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    const session = await t.auth.api.getSession({ headers: t.sessionHeaders(response) });
    expect(session?.user.email).toBe("ada@example.com");
  });

  test("rejects a replayed code", async ({ t }) => {
    await t.seedUser({ email: "ada@example.com" });
    const { code } = await t.requestSignIn("ada@example.com");
    expect((await verifyCode(t, "ada@example.com", code)).status).toBe(200);

    expect(await verifyCode(t, "ada@example.com", code)).toMatchObject({
      status: 400,
      body: { ok: false, error: "invalid_or_expired" },
    });
  });

  test("rejects an expired code", async ({ t }) => {
    await t.seedUser({ email: "ada@example.com" });
    const { code } = await t.requestSignIn("ada@example.com");
    await expireAllVerifications(t);

    expect(await verifyCode(t, "ada@example.com", code)).toMatchObject({
      status: 400,
      body: { ok: false, error: "invalid_or_expired" },
    });
  });

  test("invalidates the code after 3 wrong attempts", async ({ t }) => {
    await t.seedUser({ email: "ada@example.com" });
    const { code } = await t.requestSignIn("ada@example.com");
    for (let i = 0; i < 3; i++) {
      // Sequential on purpose: each step depends on the ones before.
      // oxlint-disable-next-line no-await-in-loop
      expect(await verifyCode(t, "ada@example.com", wrongCode(code))).toMatchObject({
        status: 400,
        body: { ok: false, error: "invalid_or_expired" },
      });
    }

    expect(await verifyCode(t, "ada@example.com", code)).toMatchObject({
      status: 403,
      body: { ok: false, error: "too_many_attempts" },
    });
    expect(await verifyCode(t, "ada@example.com", code)).toMatchObject({ status: 400 });
  });

  test("refuses a malformed code without spending an attempt", async ({ t }) => {
    await t.seedUser({ email: "ada@example.com" });
    const { code } = await t.requestSignIn("ada@example.com");
    for (const otp of ["12345", "1234567", "abcdef"]) {
      // Sequential on purpose: each step depends on the ones before.
      // oxlint-disable-next-line no-await-in-loop
      expect((await verifyCode(t, "ada@example.com", otp)).body).toEqual({
        ok: false,
        error: "invalid_request",
      });
    }
    expect((await verifyCode(t, "ada@example.com", code)).status).toBe(200);
  });
});

describe("sibling credentials", () => {
  test("signing in by link kills the code", async ({ t }) => {
    await t.seedUser({ email: "ada@example.com" });
    const { token, code } = await t.requestSignIn("ada@example.com");
    expect((await verifyLink(t, token)).status).toBe(200);

    expect((await verifyCode(t, "ada@example.com", code)).body).toEqual({
      ok: false,
      error: "invalid_or_expired",
    });
  });

  test("signing in by code kills the link", async ({ t }) => {
    await t.seedUser({ email: "ada@example.com" });
    const { token, code } = await t.requestSignIn("ada@example.com");
    expect((await verifyCode(t, "ada@example.com", code)).status).toBe(200);

    expect((await verifyLink(t, token)).body).toEqual({ ok: false, error: "invalid_or_expired" });
  });

  test("kills every pending link for the address, whatever case it was typed in", async ({ t }) => {
    await t.seedUser({ email: "ada@example.com" });
    const first = await t.requestSignIn("ADA@example.com");
    const second = await t.requestSignIn("ada@example.com");
    expect((await verifyLink(t, second.token)).status).toBe(200);

    expect((await verifyLink(t, first.token)).body).toEqual({
      ok: false,
      error: "invalid_or_expired",
    });
    expect(await t.auth.$deps.db.$count(verification)).toBe(0);
    expect(t.storage.keys().filter((key) => key.startsWith("verification:"))).toEqual([]);
  });

  test("leaves other addresses' credentials alone", async ({ t }) => {
    await t.seedUser({ email: "ada@example.com" });
    await t.seedUser({ email: "grace@example.com" });
    const ada = await t.requestSignIn("ada@example.com");
    const grace = await t.requestSignIn("grace@example.com");
    expect((await verifyLink(t, ada.token)).status).toBe(200);

    expect((await verifyCode(t, "grace@example.com", grace.code)).status).toBe(200);
  });
});

describe("eligibility", () => {
  test("answers an unknown address the same way, without email, user or usable token", async ({
    t,
  }) => {
    const response = await t.fetchAuth("/sign-in/magic-link", {
      body: { email: "stranger@example.com" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: true });
    await t.settle();

    expect(t.mailer.messages).toEqual([]);
    expect(await t.auth.$deps.db.$count(verification)).toBe(0);
    expect(await t.auth.$deps.db.$count(user)).toBe(0);
  });

  test("lets a pending invitee sign in, which creates their user", async ({ t }) => {
    await seedInvitation(t, "grace@example.com");
    const { token } = await t.requestSignIn("grace@example.com");

    expect((await verifyLink(t, token)).status).toBe(200);
    const [created] = await t.auth.$deps.db
      .select({ emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.email, "grace@example.com"));
    expect(created).toEqual({ emailVerified: true });
  });

  test("lets a pending invitee sign in by code", async ({ t }) => {
    await seedInvitation(t, "grace@example.com");
    const { code } = await t.requestSignIn("grace@example.com");
    expect((await verifyCode(t, "grace@example.com", code)).status).toBe(200);
  });

  test("ignores an expired invitation", async ({ t }) => {
    await seedInvitation(t, "grace@example.com", { expiresAt: new Date(Date.now() - 1000) });
    await t.fetchAuth("/sign-in/magic-link", { body: { email: "grace@example.com" } });
    await t.settle();
    expect(t.mailer.messages).toEqual([]);
    expect(await t.auth.$deps.db.$count(verification)).toBe(0);
  });

  test("ignores an invitation that is no longer pending", async ({ t }) => {
    await seedInvitation(t, "grace@example.com", { status: "canceled" });
    await t.fetchAuth("/sign-in/magic-link", { body: { email: "grace@example.com" } });
    await t.settle();
    expect(t.mailer.messages).toEqual([]);
  });

  test("refuses to create a user whose invitation lapsed after the email was sent", async ({
    t,
  }) => {
    await seedInvitation(t, "grace@example.com");
    const { token } = await t.requestSignIn("grace@example.com");
    await t.auth.$deps.db.update(invitation).set({ status: "canceled" });

    expect((await verifyLink(t, token)).body).toEqual({ ok: false, error: "invalid_or_expired" });
    expect(await t.auth.$deps.db.$count(user, eq(user.email, "grace@example.com"))).toBe(0);
  });

  test("handles mixed-case and padded addresses", async ({ t }) => {
    await t.seedUser({ email: "ada@example.com" });
    const before = t.mailer.messages.length;
    await t.fetchAuth("/sign-in/magic-link", { body: { email: "Ada@Example.COM" } });
    const message = await t.waitForEmail("ada@example.com", before);
    const code = /Sign-in code: (\d{6})/.exec(message.text)![1]!;

    expect((await verifyCode(t, "ADA@example.com", code)).status).toBe(200);
  });

  test("lets a mixed-case invitee sign in", async ({ t }) => {
    await seedInvitation(t, "grace@example.com");
    const { token } = await t.requestSignIn("Grace@Example.com");
    expect((await verifyLink(t, token)).status).toBe(200);
    expect(await t.auth.$deps.db.$count(user, eq(user.email, "grace@example.com"))).toBe(1);
  });
});

describe("rate limits", () => {
  test("limits sign-in requests per IP with 429", async ({ t }) => {
    const ip = "203.0.113.7";
    for (let i = 0; i < 5; i++) {
      // Sequential on purpose: each step depends on the ones before.
      // oxlint-disable-next-line no-await-in-loop
      const response = await t.fetchAuth("/sign-in/magic-link", {
        ip,
        body: { email: `nobody-${i}@example.com` },
      });
      expect(response.status).toBe(200);
    }
    const limited = await t.fetchAuth("/sign-in/magic-link", {
      ip,
      body: { email: "nobody@example.com" },
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ ok: false, error: "rate_limited" });
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);

    // Another client is unaffected.
    const other = await t.fetchAuth("/sign-in/magic-link", {
      ip: "203.0.113.8",
      body: { email: "nobody@example.com" },
    });
    expect(other.status).toBe(200);
  });

  test("limits code attempts per IP with 429", async ({ t }) => {
    const ip = "203.0.113.9";
    for (let i = 0; i < 5; i++) {
      // Sequential on purpose: each step depends on the ones before.
      // oxlint-disable-next-line no-await-in-loop
      await t.fetchAuth("/sign-in/email-otp", {
        ip,
        body: { email: "a@example.com", otp: "000000" },
      });
    }
    const limited = await t.fetchAuth("/sign-in/email-otp", {
      ip,
      body: { email: "a@example.com", otp: "000000" },
    });
    expect(limited.status).toBe(429);
  });
});

describe("verify request rules", () => {
  test("refuses a navigation and leaves the token usable", async ({ t }) => {
    await t.seedUser({ email: "ada@example.com" });
    const { token } = await t.requestSignIn("ada@example.com");

    const navigation = await t.fetchAuth(verifyPath(token), {
      headers: { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
    });
    expect(navigation.status).toBe(403);
    expect(await navigation.json()).toEqual({ ok: false, error: "forbidden" });

    expect((await verifyLink(t, token)).status).toBe(200);
  });

  test("refuses errorCallbackURL on verify and leaves the token usable", async ({ t }) => {
    await t.seedUser({ email: "ada@example.com" });
    const { token } = await t.requestSignIn("ada@example.com");

    const response = await t.fetchAuth(
      `${verifyPath(token)}&errorCallbackURL=https%3A%2F%2Fevil.com`,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "invalid_request" });
    expect(response.headers.get("location")).toBeNull();
    expect((await verifyLink(t, token)).status).toBe(200);
  });
});

describe("POST origin rules", () => {
  test("refuses a cross-origin code submission (login CSRF)", async ({ t }) => {
    await t.seedUser({ email: "ada@example.com" });
    const { code } = await t.requestSignIn("ada@example.com");
    const response = await t.fetchAuth("/sign-in/email-otp", {
      body: { email: "ada@example.com", otp: code },
      headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: "forbidden" });
    expect(response.headers.getSetCookie()).toEqual([]);
    // Refused before Better Auth: the code wasn't spent.
    expect((await verifyCode(t, "ada@example.com", code)).status).toBe(200);
  });

  // Kept although the rule is unit-tested: Better Auth runs an origin check of its own on the
  // forwarded request, and it must not refuse what ours accepts.
  test("accepts Origin: null on a same-origin fetch (Referrer-Policy: no-referrer)", async ({
    t,
  }) => {
    await t.seedUser({ email: "ada@example.com" });
    const response = await t.fetchAuth("/sign-in/magic-link", {
      body: { email: "ada@example.com" },
      headers: { origin: "null" },
    });
    expect(response.status).toBe(200);
    await t.waitForEmail("ada@example.com");
  });
});

describe("allowlist", () => {
  // A Better Auth endpoint that would issue a code; the matcher itself is unit-tested.
  test("404s POST /email-otp/send-verification-otp without reaching Better Auth", async ({ t }) => {
    await t.seedUser({ email: "ada@example.com" });
    const response = await t.fetchAuth("/email-otp/send-verification-otp", {
      body: { email: "ada@example.com", type: "sign-in" },
    });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
    await t.settle();
    expect(t.mailer.messages).toEqual([]);
    expect(await t.auth.$deps.db.$count(verification)).toBe(0);
  });
});

describe("issuing codes", () => {
  test("a direct sendVerificationOTP call leaves no usable code and sends nothing", async ({
    t,
  }) => {
    await t.seedUser({ email: "ada@example.com" });
    // Better Auth logs and swallows the callback's refusal.
    await t.auth.api.sendVerificationOTP({ body: { email: "ada@example.com", type: "sign-in" } });
    await t.settle();

    expect(t.mailer.messages).toEqual([]);
    expect(await t.auth.$deps.db.$count(verification)).toBe(0);
  });
});

describe("sign-out", () => {
  test("ends the session and answers `{ ok: true }`", async ({ t }) => {
    await t.seedUser({ email: "ada@example.com" });
    const headers = await t.signInAs("ada@example.com");

    const response = await t.fetchAuth("/sign-out", {
      body: {},
      headers: { cookie: headers.get("cookie")! },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.getSetCookie().some((c) => /cw\.session_token=;/.test(c))).toBe(true);
    expect(await t.auth.api.getSession({ headers })).toBeNull();
  });
});

describe("audit and sessions", () => {
  test("records sign-in by method and sign-out", async ({ t }) => {
    const ada = await t.seedUser({ email: "ada@example.com" });
    const { code } = await t.requestSignIn("ada@example.com");
    const { response } = await verifyCode(t, "ada@example.com", code);
    const headers = t.sessionHeaders(response);
    await t.fetchAuth("/sign-out", { body: {}, headers: { cookie: headers.get("cookie")! } });
    await t.signInAs("ada@example.com");

    const events = await t.auth.$deps.db
      .select({
        action: auditEvent.action,
        actorUserId: auditEvent.actorUserId,
        metadata: auditEvent.metadata,
        ipAddress: auditEvent.ipAddress,
      })
      .from(auditEvent)
      .orderBy(auditEvent.id);
    expect(events).toEqual([
      {
        action: "auth.sign_in",
        actorUserId: ada.id,
        metadata: { method: "otp" },
        ipAddress: expect.any(String),
      },
      {
        action: "auth.sign_out",
        actorUserId: ada.id,
        metadata: null,
        ipAddress: expect.any(String),
      },
      {
        action: "auth.sign_in",
        actorUserId: ada.id,
        metadata: { method: "magic_link" },
        ipAddress: expect.any(String),
      },
    ]);
  });

  test("starts a session in the most recently joined organization", async ({ t }) => {
    const ada = await t.seedUser({ email: "ada@example.com" });
    await t.seedOrganization({
      name: "Acme",
      slug: "acme",
      members: [{ userId: ada.id, role: "owner", createdAt: new Date("2026-01-01") }],
    });
    const globex = await t.seedOrganization({
      name: "Globex",
      slug: "globex",
      members: [{ userId: ada.id, role: "member", createdAt: new Date("2026-06-01") }],
    });
    await t.seedOrganization({
      name: "Initech",
      slug: "initech",
      members: [{ userId: ada.id, role: "admin", createdAt: new Date("2026-03-01") }],
    });

    const headers = await t.signInAs("ada@example.com");
    expect(await activeOrganization(t, headers)).toBe(globex.publicId);
  });

  test("continues in the organization the user last worked in", async ({ t }) => {
    // Re-authenticating (fresh-session prompts) must not drop someone into another workspace.
    const ada = await t.seedUser({ email: "ada@example.com" });
    const acme = await t.seedOrganization({
      name: "Acme",
      slug: "acme",
      members: [{ userId: ada.id, role: "owner", createdAt: new Date("2026-01-01") }],
    });
    const globex = await t.seedOrganization({
      name: "Globex",
      slug: "globex",
      members: [{ userId: ada.id, role: "member", createdAt: new Date("2026-06-01") }],
    });
    const first = await t.signInAs("ada@example.com");
    expect(
      await switchOrganization(t.auth, first, { organizationPublicId: acme.publicId }),
    ).toEqual(expect.objectContaining({ ok: true }));

    // Globex is the newer membership, so only the remembered choice can make this Acme.
    const again = await t.signInAs("ada@example.com");
    expect(await activeOrganization(t, again)).toBe(acme.publicId);
    expect(globex.publicId).not.toBe(acme.publicId);
  });

  test("falls back to the newest membership once the last organization is gone", async ({ t }) => {
    const ada = await t.seedUser({ email: "ada@example.com" });
    const acme = await t.seedOrganization({
      name: "Acme",
      slug: "acme",
      members: [{ userId: ada.id, role: "owner", createdAt: new Date("2026-01-01") }],
    });
    const globex = await t.seedOrganization({
      name: "Globex",
      slug: "globex",
      members: [{ userId: ada.id, role: "member", createdAt: new Date("2026-06-01") }],
    });
    const first = await t.signInAs("ada@example.com");
    await switchOrganization(t.auth, first, { organizationPublicId: acme.publicId });
    await t.auth.$deps.db.delete(member).where(eq(member.organizationId, acme.id));

    const again = await t.signInAs("ada@example.com");
    expect(await activeOrganization(t, again)).toBe(globex.publicId);
  });

  test("starts a session without an organization for a user with none", async ({ t }) => {
    await t.seedUser({ email: "ada@example.com" });
    await t.auth.$deps.db.insert(organization).values({ name: "Other", slug: "other" });
    const headers = await t.signInAs("ada@example.com");
    expect(await activeOrganization(t, headers)).toBeNull();
  });
});
