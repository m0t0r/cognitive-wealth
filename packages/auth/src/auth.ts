import { AsyncLocalStorage } from "node:async_hooks";
import type { Database } from "@repo/db";
import * as schema from "@repo/db/schema";
import { member, session as sessionTable } from "@repo/db/schema";
import { renderInvitationEmail, type Mailer } from "@repo/email";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getIP, getSessionFromCtx } from "better-auth/api";
import { emailOTP } from "better-auth/plugins/email-otp";
import { magicLink } from "better-auth/plugins/magic-link";
import { organization } from "better-auth/plugins/organization";
import { and, desc, eq, sql } from "drizzle-orm";
import { ac, can, roles } from "./access";
import { writeAuditEvent } from "./audit";
import { AUTH_BASE_PATH, COOKIE_PREFIX } from "./constants";
import { setDeviceCookie } from "./device";
import {
  SIGN_IN_EXPIRES_IN,
  createSignInFlow,
  runInBackground,
  type BackgroundRunner,
  deleteSiblingCredentials,
  hasPendingInvitation,
  normalizeEmail,
} from "./sign-in";
import type { SecondaryStorage } from "./storage/types";

/** Sessions last 7 days, sliding daily; sensitive actions need one created within the hour. */
export const SESSION_EXPIRES_IN = 7 * 24 * 60 * 60;
export const SESSION_UPDATE_AGE = 24 * 60 * 60;
export const SESSION_FRESH_AGE = 60 * 60;
export const INVITATION_EXPIRES_IN = 7 * 24 * 60 * 60;

/**
 * Better Auth reads the client IP from `ipAddressHeaders` and defaults to `x-forwarded-for`,
 * which clients can forge when nothing in front overwrites it. Without a configured header we
 * point it at one nothing sends, so the IP is unresolved instead of attacker-chosen.
 */
export const UNSET_IP_HEADER = "x-cw-client-ip-unset";

/** Per-IP limits for the browser-facing endpoints (see the route handler's allowlist). */
export const ROUTE_RATE_LIMITS = {
  "/sign-in/magic-link": { window: 60, max: 5 },
  "/magic-link/verify": { window: 60, max: 10 },
  "/sign-in/email-otp": { window: 60, max: 5 },
} as const;

export interface AuthDeps {
  db: Database;
  mailer: Mailer;
  secondaryStorage: SecondaryStorage;
  /** The app's origin; links in emails and the origin check use it. */
  baseURL: string;
  secret: string;
  /** The header holding the client IP, set by a proxy that overwrites it. */
  trustedIpHeader?: string | undefined;
  /** Proxies that append to `trustedIpHeader` (IPs or CIDRs). */
  trustedProxies?: string[] | undefined;
  /** Default: only when `baseURL` is https. `authOptionsFromEnv` also turns it on in production. */
  secureCookies?: boolean | undefined;
  /**
   * Runs a sign-in request's address-dependent work after the response, so its timing doesn't
   * reveal which addresses can sign in. Default: in this process, which suits a long-lived Node
   * server (the standalone server); a serverless deploy must pass its `waitUntil`.
   */
  runInBackground?: BackgroundRunner | undefined;
  /** Appended after ours, e.g. `nextCookies()`, which must come last. */
  plugins?: BetterAuthPlugin[] | undefined;
}

// Better Auth reads `publicId` (the database generates it) but never accepts it as input.
const publicIdField = { publicId: { type: "string", required: false, input: false } } as const;

const SIGN_IN_METHODS: Record<string, "magic_link" | "otp"> = {
  "/magic-link/verify": "magic_link",
  "/sign-in/email-otp": "otp",
};

/** Builds the Better Auth instance. Pure: everything it touches comes in through `deps`. */
export function createAuth(deps: AuthDeps) {
  const { db, mailer, secondaryStorage: storage, baseURL } = deps;
  const origin = new URL(baseURL).origin;

  // `sendMagicLink` asks the emailOTP plugin for a code through `auth.api`, which exists only
  // once `betterAuth()` returns.
  let issueOtp: (email: string) => Promise<unknown> = notInitialized;
  const signIn = createSignInFlow({
    db,
    mailer,
    storage,
    baseURL: origin,
    issueOtp: (email) => issueOtp(email),
    runInBackground: deps.runInBackground ?? runInBackground,
  });

  // Better Auth awaits `sendInvitationEmail` but logs and swallows its errors, so `createInvitation`
  // succeeds whether or not the email went out. The callback marks a failure here instead, for
  // `trackInvitationEmail` to report.
  const invitationEmail = new AsyncLocalStorage<{ failed: boolean }>();

  const ourPlugins = [
    emailOTP({
      otpLength: 6,
      expiresIn: SIGN_IN_EXPIRES_IN,
      storeOTP: "hashed",
      allowedAttempts: 3,
      sendVerificationOTP: signIn.sendVerificationOTP,
    }),
    magicLink({
      expiresIn: SIGN_IN_EXPIRES_IN,
      storeToken: "hashed",
      // Sign-up stays on so invitees can sign in; `databaseHooks.user.create.before` and the
      // eligibility check in `sendMagicLink` make it invite-only.
      disableSignUp: false,
      sendMagicLink: signIn.sendMagicLink,
    }),
    organization({
      ac,
      roles,
      allowUserToCreateOrganization: false,
      creatorRole: "owner",
      teams: { enabled: false },
      invitationExpiresIn: INVITATION_EXPIRES_IN,
      cancelPendingInvitationsOnReInvite: true,
      requireEmailVerificationOnInvitation: true,
      organizationHooks: {
        // Better Auth checks the inviter's rights when the invitation is created, never again.
        // Without this, someone removed from a workspace (or demoted) could rejoin with their old
        // role through an invitation they sent to another address of theirs.
        async beforeAcceptInvitation({ invitation: accepted }) {
          if (!(await inviterMayGrant(db, accepted))) throw inviterGoneError();
        },
      },
      async sendInvitationEmail({ invitation, organization: org, inviter }) {
        try {
          const { publicId } = invitation as typeof invitation & { publicId?: unknown };
          if (typeof publicId !== "string") throw new Error("Invitation has no publicId");
          const email = await renderInvitationEmail({
            url: new URL(`/invite/${encodeURIComponent(publicId)}`, origin).toString(),
            organizationName: org.name,
            inviterName: inviter.user.name,
            role: invitation.role,
            expiresAt: invitation.expiresAt,
          });
          await mailer.send({
            to: invitation.email,
            ...email,
            tags: { category: "invitation" },
            idempotencyKey: `invitation/${publicId}`,
          });
        } catch (error) {
          const tracked = invitationEmail.getStore();
          if (tracked) tracked.failed = true;
          throw error;
        }
      },
      schema: {
        organization: { additionalFields: publicIdField },
        member: { additionalFields: publicIdField },
        invitation: { additionalFields: publicIdField },
      },
    }),
  ];

  const auth = betterAuth({
    appName: "Cognitive Wealth",
    baseURL: origin,
    basePath: AUTH_BASE_PATH,
    secret: deps.secret,
    trustedOrigins: [origin],
    telemetry: { enabled: false },
    database: drizzleAdapter(db, { provider: "pg", schema }),
    secondaryStorage: storage,
    // Tokens and codes stay in Postgres; Redis only holds what we can lose.
    verification: { storeInDatabase: true },
    user: { additionalFields: publicIdField },
    session: {
      expiresIn: SESSION_EXPIRES_IN,
      updateAge: SESSION_UPDATE_AGE,
      freshAge: SESSION_FRESH_AGE,
      cookieCache: { enabled: false },
      storeSessionInDatabase: true,
    },
    emailAndPassword: { enabled: false },
    rateLimit: {
      enabled: true,
      storage: "secondary-storage",
      window: 60,
      max: 100,
      customRules: ROUTE_RATE_LIMITS,
    },
    advanced: {
      database: { generateId: "serial" },
      // Better Auth turns both checks off when NODE_ENV=test; pin them on so tests run what
      // production runs.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      cookiePrefix: COOKIE_PREFIX,
      useSecureCookies: deps.secureCookies ?? origin.startsWith("https:"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
      ipAddress: {
        ipAddressHeaders: [deps.trustedIpHeader ?? UNSET_IP_HEADER],
        trustedProxies: deps.trustedProxies,
      },
      // No `backgroundTasks`: `sendMagicLink` schedules its own work through `runInBackground`.
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-out") return;
        // Read before the endpoint deletes the session.
        const session = await getSessionFromCtx(ctx).catch(() => null);
        if (!session) return;
        const headers = ctx.request?.headers ?? ctx.headers;
        await writeAuditEvent(db, {
          action: "auth.sign_out",
          actorUserId: Number(session.user.id),
          ipAddress: headers ? getIP(headers, ctx.context.options) : null,
          userAgent: headers?.get("user-agent"),
        });
      }),
      after: createAuthMiddleware(async (ctx) => {
        const method = SIGN_IN_METHODS[ctx.path];
        const created = ctx.context.newSession;
        if (method === undefined || !created) return;
        try {
          // The credential just used is consumed; the other one (link or code) must die too.
          await deleteSiblingCredentials(db, { storage, email: created.user.email });
          // Mark this browser as one the user signs in from, so it keeps getting sign-in emails
          // while others flood the address (`sendMagicLink`). Reissued on every sign-in to
          // restart its 180 days.
          const { publicId } = created.user as typeof created.user & { publicId?: unknown };
          if (typeof publicId !== "string") throw new Error("Signed-in user has no publicId");
          await setDeviceCookie({ ctx, publicId });
        } catch (error) {
          // The session already exists. If a sibling may still be live, the sign-in fails as a
          // whole: end the session too, so a failure never leaves one behind.
          await ctx.context.internalAdapter.deleteSession(created.session.token);
          throw error;
        }
        const headers = ctx.request?.headers ?? ctx.headers;
        await writeAuditEvent(db, {
          action: "auth.sign_in",
          actorUserId: Number(created.user.id),
          ipAddress: headers ? getIP(headers, ctx.context.options) : null,
          userAgent: headers?.get("user-agent"),
          metadata: { method },
        });
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // Defense in depth for invite-only sign-up: sign-in requests are already gated, but no
          // path may create a user without a pending invitation. The seed and CLIs write users
          // with Drizzle directly, so they never reach this hook.
          async before(data) {
            return hasPendingInvitation(db, normalizeEmail(data.email));
          },
        },
      },
      session: {
        create: {
          async before(data) {
            return {
              data: { activeOrganizationId: await initialOrganizationId(db, data.userId) },
            };
          },
        },
      },
    },
    // `nextCookies()` and the like go last.
    plugins: [...ourPlugins, ...(deps.plugins ?? [])],
  });

  issueOtp = (email) => auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } });

  /** Runs `create` (an `auth.api.createInvitation` call) and says whether its email went out. */
  async function trackInvitationEmail<T>(
    create: () => Promise<T>,
  ): Promise<{ result: T; emailSent: boolean }> {
    const tracked = { failed: false };
    const result = await invitationEmail.run(tracked, create);
    return { result, emailSent: !tracked.failed };
  }

  return Object.assign(auth, { $deps: { db, storage, baseURL: origin, trackInvitationEmail } });
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * Whether the inviter could still send `invitation` today: they are still a member, their role
 * still grants `invitation:create`, and an owner invitation still comes from an owner. Checked on
 * accept (and before showing an invitation), since Better Auth only checks when it's created.
 */
export async function inviterMayGrant(
  db: Database,
  invitation: { inviterId: string | number; organizationId: string | number; role: string | null },
): Promise<boolean> {
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(
        eq(member.userId, Number(invitation.inviterId)),
        eq(member.organizationId, Number(invitation.organizationId)),
      ),
    )
    .limit(1);
  if (row === undefined || !can(row.role, "invitation:create")) return false;
  return invitation.role !== "owner" || row.role === "owner";
}

/** Better Auth's own error for an inviter who has left, so callers map it like its check. */
function inviterGoneError(): APIError {
  return new APIError("BAD_REQUEST", {
    code: "INVITER_IS_NO_LONGER_A_MEMBER_OF_THE_ORGANIZATION",
    message: "Inviter is no longer a member of the organization",
  });
}

function notInitialized(): Promise<never> {
  return Promise.reject(new Error("Auth is not initialized"));
}

/**
 * Where a new session starts, as Better Auth's string ID: the organization the user's latest
 * session was in, if they still belong to it, so signing in again (e.g. to confirm a sensitive
 * action) doesn't switch workspaces. Otherwise their most recently created membership.
 */
async function initialOrganizationId(
  db: Database,
  userId: string | number,
): Promise<string | null> {
  const id = Number(userId);
  const [continued] = await db
    .select({ organizationId: member.organizationId })
    .from(sessionTable)
    .innerJoin(
      member,
      and(
        eq(member.userId, id),
        // `activeOrganizationId` is read as a string; compare the bigint columns in SQL.
        sql`${member.organizationId} = ${sessionTable.activeOrganizationId}`,
      ),
    )
    .where(eq(sessionTable.userId, id))
    .orderBy(desc(sessionTable.updatedAt), desc(sessionTable.id))
    .limit(1);
  if (continued !== undefined) return String(continued.organizationId);

  const [latest] = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, id))
    .orderBy(desc(member.createdAt), desc(member.id))
    .limit(1);
  return latest === undefined ? null : String(latest.organizationId);
}
