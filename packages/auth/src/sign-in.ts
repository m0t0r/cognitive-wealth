// The sign-in request: one email with a magic link and a 6-digit code, sent only to addresses that
// may sign in (ADR 0001, "Sign-in request").
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import type { Database } from "@repo/db";
import { invitation, user, verification } from "@repo/db/schema";
import { renderSignInEmail, type Mailer } from "@repo/email";
import type { SecondaryStorage } from "./storage/types";
import { and, eq, gt, or, sql } from "drizzle-orm";
import { callbackPathOrDefault } from "./callback-path";
import { consumeRateLimit, type RateLimitRule } from "./rate-limit";

/** Seconds a link or code stays valid. */
export const SIGN_IN_EXPIRES_IN = 300;
/** Sign-in emails per address, on top of Better Auth's per-IP limit. */
export const SIGN_IN_EMAIL_LIMIT: RateLimitRule = { window: 600, max: 3 };

const MAGIC_LINK_PREFIX = "magic-link:";

/** Better Auth's emails are stored lowercased; the magic-link plugin passes the raw input. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The verification identifier the magic-link plugin stores for `token` (`storeToken: "hashed"`). */
export function magicLinkIdentifier(token: string): string {
  return `${MAGIC_LINK_PREFIX}${createHash("sha256").update(token).digest("base64url")}`;
}

/** The emailOTP plugin's identifier for a sign-in code. */
export function signInOtpIdentifier(email: string): string {
  return `sign-in-otp-${email}`;
}

/** `${baseURL}/sign-in/confirm#token=…&next=…`: the token stays in the fragment, off the wire. */
export function confirmUrl(baseURL: string, token: string, callbackPath: string): string {
  const url = new URL("/sign-in/confirm", baseURL);
  url.hash = new URLSearchParams({ token, next: callbackPath }).toString();
  return url.toString();
}

/** May `email` (normalized) sign in: an existing user, or a pending, unexpired invitation. */
export async function isEligibleForSignIn(db: Database, email: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  return existing !== undefined || (await hasPendingInvitation(db, email));
}

export async function hasPendingInvitation(db: Database, email: string): Promise<boolean> {
  const [pending] = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        // Better Auth lowercases invitation emails; other writers might not.
        eq(sql`lower(${invitation.email})`, email),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  return pending !== undefined;
}

/** The parts of Better Auth's endpoint context the flow uses. */
interface EndpointContext {
  context: {
    internalAdapter: { deleteVerificationByIdentifier(identifier: string): Promise<void> };
  };
}

export interface SignInFlowDeps {
  db: Database;
  mailer: Mailer;
  storage: SecondaryStorage;
  baseURL: string;
  /** Issues a sign-in code through the emailOTP plugin (`auth.api.sendVerificationOTP`). */
  issueOtp: (email: string) => Promise<unknown>;
}

/**
 * The magicLink and emailOTP callbacks. A code is only ever issued inside a magic-link request:
 * `sendMagicLink` opens an `AsyncLocalStorage` slot, asks the emailOTP plugin for a code, and the
 * plugin's callback writes the code into that slot. Without a slot the callback refuses.
 */
export function createSignInFlow(deps: SignInFlowDeps) {
  const codeSlot = new AsyncLocalStorage<{ code?: string }>();

  async function sendVerificationOTP(
    { email, otp, type }: { email: string; otp: string; type: string },
    ctx?: EndpointContext,
  ): Promise<void> {
    const slot = codeSlot.getStore();
    if (slot === undefined || type !== "sign-in") {
      // Reached only by a direct server-side call (the HTTP route is not allowlisted). The
      // plugin already stored the code; delete it so nothing usable is left, then refuse.
      await ctx?.context.internalAdapter.deleteVerificationByIdentifier(`${type}-otp-${email}`);
      throw new Error("Sign-in codes are only issued together with a magic link");
    }
    slot.code = otp;
  }

  async function sendMagicLink(
    { email, token, url }: { email: string; token: string; url: string },
    ctx?: EndpointContext,
  ): Promise<void> {
    const normalized = normalizeEmail(email);
    // The plugin stored the link before calling us. Whenever no email goes out, delete it, so
    // an ineligible address never holds a usable token.
    const discard = async () => {
      await ctx?.context.internalAdapter.deleteVerificationByIdentifier(magicLinkIdentifier(token));
    };

    // Every outcome returns normally, so the HTTP response is `{ status: true }` either way.
    try {
      if (!(await isEligibleForSignIn(deps.db, normalized))) return await discard();

      const limit = await consumeRateLimit(
        deps.storage,
        `sign-in-email:${normalized}`,
        SIGN_IN_EMAIL_LIMIT,
      );
      if (!limit.ok) return await discard();

      const slot: { code?: string } = {};
      await codeSlot.run(slot, () => deps.issueOtp(normalized));
      if (slot.code === undefined) throw new Error("The emailOTP plugin issued no code");

      const callbackPath = callbackPathOrDefault(new URL(url).searchParams.get("callbackURL"));
      const link = confirmUrl(deps.baseURL, token, callbackPath);
      // Not awaited, so response timing doesn't reveal whether the address was eligible.
      void deliver(deps.mailer, normalized, link, slot.code).catch((error: unknown) => {
        console.error("Failed to send sign-in email", error);
      });
    } catch (error) {
      console.error("Sign-in request failed", error);
      await discard().catch(() => {});
    }
  }

  return { sendMagicLink, sendVerificationOTP };
}

async function deliver(mailer: Mailer, to: string, url: string, code: string): Promise<void> {
  const email = await renderSignInEmail({
    url,
    code,
    expiresInMinutes: SIGN_IN_EXPIRES_IN / 60,
  });
  await mailer.send({
    to,
    ...email,
    tags: { category: "sign_in" },
    // Random, never derived from the token: the key is visible to the email provider.
    idempotencyKey: `sign-in/${randomUUID()}`,
  });
}

/**
 * Deletes every other pending sign-in credential for `email` after a successful sign-in: the
 * sign-in code and all magic links, so one email creates at most one session. The magic-link
 * plugin keeps the address as typed, so links match case-insensitively. Returns how many rows
 * went.
 */
export async function deleteSiblingCredentials(
  db: Database,
  storage: SecondaryStorage,
  email: string,
): Promise<number> {
  const normalized = normalizeEmail(email);
  const deleted = await db
    .delete(verification)
    .where(
      or(
        eq(verification.identifier, signInOtpIdentifier(normalized)),
        and(
          sql`starts_with(${verification.identifier}, ${MAGIC_LINK_PREFIX})`,
          // CASE keeps the jsonb cast off rows that aren't magic links.
          sql`lower(case when starts_with(${verification.identifier}, ${MAGIC_LINK_PREFIX}) then ${verification.value}::jsonb ->> 'email' end) = ${normalized}`,
        ),
      ),
    )
    .returning({ identifier: verification.identifier });
  // Better Auth also caches verification rows in secondary storage. Consuming one always goes
  // through the database, so a stale cache entry can't sign anyone in; drop it anyway.
  await Promise.all(
    deleted.map(async ({ identifier }) => {
      await storage.delete(`verification:${identifier}`);
    }),
  );
  return deleted.length;
}
