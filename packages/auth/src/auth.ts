import type { Database } from "@repo/db";
import * as schema from "@repo/db/schema";
import { member } from "@repo/db/schema";
import { renderInvitationEmail, type Mailer } from "@repo/email";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware, getIP, getSessionFromCtx } from "better-auth/api";
import { emailOTP } from "better-auth/plugins/email-otp";
import { magicLink } from "better-auth/plugins/magic-link";
import { organization } from "better-auth/plugins/organization";
import { desc, eq } from "drizzle-orm";
import { ac, roles } from "./access";
import { writeAuditEvent } from "./audit";
import { AUTH_BASE_PATH, COOKIE_PREFIX } from "./constants";
import {
  SIGN_IN_EXPIRES_IN,
  createSignInFlow,
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
  });

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
      async sendInvitationEmail({ invitation, organization: org, inviter }) {
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
      // No `backgroundTasks`: the combined email needs the emailOTP callback awaited in-request.
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
        // The credential just used is consumed; the other one (link or code) must die too. Not
        // caught: if this fails, the sign-in fails rather than leave a live sibling behind.
        await deleteSiblingCredentials(db, storage, created.user.email);
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
              data: { activeOrganizationId: await latestMembershipOrganizationId(db, data.userId) },
            };
          },
        },
      },
    },
    // `nextCookies()` and the like go last.
    plugins: [...ourPlugins, ...(deps.plugins ?? [])],
  });

  issueOtp = (email) => auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } });

  return Object.assign(auth, { $deps: { db, storage, baseURL: origin } });
}

export type Auth = ReturnType<typeof createAuth>;

function notInitialized(): Promise<never> {
  return Promise.reject(new Error("Auth is not initialized"));
}

/** The organization of the user's most recently created membership, as Better Auth's string ID. */
async function latestMembershipOrganizationId(
  db: Database,
  userId: string | number,
): Promise<string | null> {
  const [latest] = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, Number(userId)))
    .orderBy(desc(member.createdAt), desc(member.id))
    .limit(1);
  return latest === undefined ? null : String(latest.organizationId);
}
