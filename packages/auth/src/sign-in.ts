// The sign-in request: one email with a magic link and a 6-digit code, sent only to addresses that
// may sign in (ADR 0001, "Sign-in request").
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import type { Database } from "@repo/db";
import { invitation, user, verification } from "@repo/db/schema";
import { renderSignInEmail, type Mailer } from "@repo/email";
import type { GenericEndpointContext } from "better-auth";
import { getIP } from "better-auth/api";
import type { SecondaryStorage } from "./storage/types";
import { and, eq, gt, or, sql } from "drizzle-orm";
import { writeAuditEvent } from "./audit";
import { callbackPathOrDefault } from "./callback-path";
import { readDeviceCookie, type DeviceCookie } from "./device";
import { SIGN_IN_REQUESTER_LIMITS } from "./constants";
import { consumeRateLimit, type RateLimitRule } from "./rate-limit";

/** Seconds a link or code stays valid. */
export const SIGN_IN_EXPIRES_IN = 300;

/**
 * Sign-in emails per address, on top of Better Auth's per-IP limit. Requests count no matter who
 * makes them, so a single shared limit would let anyone who knows an address block its sign-in
 * emails. Instead each requester has their own budget, the address has a larger backstop against
 * inbox bombing, and a browser the user signed in from before has its own budget outside both.
 */
export const SIGN_IN_EMAIL_LIMITS = {
  /** Per address and client IP: 3 per 10 minutes and 6 per hour (`SIGN_IN_REQUESTER_LIMITS`). */
  requester: SIGN_IN_REQUESTER_LIMITS.burst,
  requesterHour: SIGN_IN_REQUESTER_LIMITS.hour,
  /** Per address, across all requesters. Above one requester's 6 an hour: it takes 2 to use up. */
  address: { window: 3600, max: 10 },
  /** Per address and known device (a valid device cookie for that user), instead of the other two. */
  device: { window: 600, max: 3 },
} as const satisfies Record<string, RateLimitRule>;

/** The rule an audit event names: both requester windows read as `requester`. */
type ThrottleRule = "requester" | "address" | "device";

/**
 * Tries at a sign-in code per address and day, across all of its codes (each code allows 3).
 * Past it, every code for the address is refused until the window ends; the link still works.
 */
export const SIGN_IN_CODE_LIMIT = {
  window: 24 * 60 * 60,
  max: 10,
} as const satisfies RateLimitRule;

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

/** The user with `email` (normalized), if there is one. */
async function findUser(db: Database, email: string): Promise<{ publicId: string } | undefined> {
  const [existing] = await db
    .select({ publicId: user.publicId })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  return existing;
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

/** The parts of Better Auth's endpoint context the emailOTP callback uses. */
interface EndpointContext {
  context: {
    internalAdapter: { deleteVerificationByIdentifier(identifier: string): Promise<void> };
  };
}

/** Runs `task` after the response, without the request waiting for it. Must never throw. */
export type BackgroundRunner = (task: () => Promise<void>) => void;

/**
 * The default {@link BackgroundRunner}: starts the task on the next turn of the event loop and
 * logs a rejection. It relies on a long-lived Node process that keeps running the task after the
 * response is sent. `apps/web` passes Next's `after()` instead, which also covers serverless hosts.
 */
export const runInBackground: BackgroundRunner = (task) => {
  setImmediate(() => {
    Promise.resolve()
      .then(task)
      .catch((error: unknown) => {
        console.error("Background task failed", error);
      });
  });
};

export interface SignInFlowDeps {
  db: Database;
  mailer: Mailer;
  storage: SecondaryStorage;
  baseURL: string;
  /** Issues a sign-in code through the emailOTP plugin (`auth.api.sendVerificationOTP`). */
  issueOtp: (email: string) => Promise<unknown>;
  /** Runs the part of a sign-in request whose cost depends on the address. */
  runInBackground: BackgroundRunner;
}

/** What a sign-in request's background task needs, captured while the request is still live. */
interface SignInRequest {
  /** Normalized. */
  email: string;
  token: string;
  callbackPath: string;
  /** The client IP, or `unknown` without a trusted IP header (which production refuses). */
  ip: string;
  userAgent: string | null;
  /** The request's device cookie, read before anyone knows whose it should be. */
  device: DeviceCookie | null;
  /** Deletes the stored link: whenever no email goes out, nothing usable may be left. */
  discard: () => Promise<void>;
}

/**
 * The magicLink and emailOTP callbacks. A code is only ever issued for a magic-link request: its
 * background task opens an `AsyncLocalStorage` slot, asks the emailOTP plugin for a code, and the
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

  /** Counts a request against one sign-in email limit; whether it's still within it. */
  async function consume(key: string, rule: keyof typeof SIGN_IN_EMAIL_LIMITS): Promise<boolean> {
    const result = await consumeRateLimit(
      deps.storage,
      `sign-in-email:${key}`,
      SIGN_IN_EMAIL_LIMITS[rule],
    );
    return result.ok;
  }

  /**
   * The rule that refuses this request, or `null`. Counts the request against every rule it
   * reaches, so it must run before a code is issued.
   */
  async function throttledBy(
    { email, ip, device }: SignInRequest,
    owner: { publicId: string } | undefined,
  ): Promise<ThrottleRule | null> {
    // A browser this user signed in from before skips the shared rules, so neither a flood of
    // requests for the address nor an attacker behind the same NAT can lock them out. The cookie
    // must name the user who owns the address: invitees have no user, so they never match.
    if (device !== null && owner !== undefined && device.publicId === owner.publicId) {
      return (await consume(`dev:${email}:${device.deviceId}`, "device")) ? null : "device";
    }
    // Each rule is only charged once the ones before it allow the request: the hour once the 10
    // minutes do, and the address once the requester is within both, so one client past its
    // limit can't keep spending the backstop that every other requester shares.
    if (!(await consume(`req:${email}:${ip}`, "requester"))) return "requester";
    if (!(await consume(`req-hour:${email}:${ip}`, "requesterHour"))) return "requester";
    if (!(await consume(`addr:${email}`, "address"))) return "address";
    return null;
  }

  /**
   * The magicLink callback. Better Auth answers `{ status: true }` once it returns, so it does
   * only what costs the same for every address: an attacker timing many requests must not learn
   * which addresses belong to clients (the plugin's own token insert, before this runs, is the
   * same for all). Everything that depends on the address runs in the background, from values
   * captured here and never from `ctx`, which may be gone by then.
   */
  async function sendMagicLink(
    { email, token, url }: { email: string; token: string; url: string },
    ctx?: GenericEndpointContext,
  ): Promise<void> {
    // The adapter outlives the request; `ctx` itself doesn't.
    const internalAdapter = ctx?.context.internalAdapter;
    const discard = async () => {
      await internalAdapter?.deleteVerificationByIdentifier(magicLinkIdentifier(token));
    };

    // Every outcome returns normally, so the HTTP response is `{ status: true }` either way.
    try {
      const headers = ctx?.request?.headers ?? ctx?.headers;
      const request: SignInRequest = {
        email: normalizeEmail(email),
        token,
        callbackPath: callbackPathOrDefault(new URL(url).searchParams.get("callbackURL")),
        ip: (ctx && headers ? getIP(headers, ctx.context.options) : null) ?? "unknown",
        userAgent: headers?.get("user-agent") ?? null,
        // Read whether or not the address has a user: the HMAC check costs the same for all.
        device: ctx ? await readDeviceCookie(ctx) : null,
        discard,
      };
      deps.runInBackground(() => processSignInRequest(request));
    } catch (error) {
      // Only if capturing or scheduling failed, which no address can cause.
      console.error("Sign-in request failed", error);
      await discard().catch(() => {});
    }
  }

  /** Eligibility, limits, the code and the email: everything whose cost depends on the address. */
  async function processSignInRequest(request: SignInRequest): Promise<void> {
    const { email, discard } = request;
    try {
      const owner = await findUser(deps.db, email);
      if (owner === undefined && !(await hasPendingInvitation(deps.db, email))) {
        return await discard();
      }

      const rule = await throttledBy(request, owner);
      if (rule !== null) {
        await discard();
        // Never throws. No email in metadata: the target's publicId identifies the user, and
        // an invitee's address stays out of the log.
        await writeAuditEvent(deps.db, {
          action: "auth.sign_in_throttled",
          actorUserId: null,
          target: owner && { type: "user", publicId: owner.publicId },
          ipAddress: request.ip === "unknown" ? null : request.ip,
          userAgent: request.userAgent,
          metadata: { rule },
        });
        return;
      }

      // A server-side `auth.api` call, so it works after the response; the slot travels with
      // this task's async context.
      const slot: { code?: string } = {};
      await codeSlot.run(slot, () => deps.issueOtp(email));
      if (slot.code === undefined) throw new Error("The emailOTP plugin issued no code");

      const link = confirmUrl(deps.baseURL, request.token, request.callbackPath);
      await deliver(deps.mailer, email, link, slot.code);
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
