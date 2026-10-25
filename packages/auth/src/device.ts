// The device cookie (docs/auth.md, "Device cookie"): marks a browser that has signed in as a user
// before, so it can still get a sign-in email while someone floods that address. It never
// authenticates anything, so it outlives sign-out.
import { randomBytes } from "node:crypto";
import type { GenericEndpointContext } from "better-auth";
import { AUTH_BASE_PATH, DEVICE_COOKIE } from "./constants";

/** Seconds a device cookie stays valid (and its `Max-Age`). */
export const DEVICE_COOKIE_MAX_AGE = 180 * 24 * 60 * 60;

// 16 random bytes, base64url without padding.
const DEVICE_ID = /^[A-Za-z0-9_-]{22}$/;
const EPOCH_SECONDS = /^\d{1,12}$/;

export interface DeviceCookie {
  /** The user it was issued to. Callers must check it against the user they're about to help. */
  publicId: string;
  /** Epoch seconds. */
  issuedAt: number;
  deviceId: string;
}

/** The parts of Better Auth's endpoint context the cookie needs. */
export type DeviceCookieContext = Pick<
  GenericEndpointContext,
  "getSignedCookie" | "setSignedCookie"
> & {
  context: Pick<GenericEndpointContext["context"], "secret" | "createAuthCookie">;
};

// `createAuthCookie` applies our `cw` prefix, `__Secure-` and `Secure` when session cookies are
// secure. The path keeps it off every request except the auth endpoints.
function deviceCookie(ctx: DeviceCookieContext) {
  return ctx.context.createAuthCookie(DEVICE_COOKIE, {
    path: AUTH_BASE_PATH,
    maxAge: DEVICE_COOKIE_MAX_AGE,
    httpOnly: true,
    sameSite: "lax",
  });
}

/**
 * `<publicId>.<issuedAt>.<deviceId>` if it is well-formed and neither from the future nor older
 * than {@link DEVICE_COOKIE_MAX_AGE}, otherwise `null`.
 */
export function parseDeviceCookie(value: string, now: number): DeviceCookie | null {
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [publicId = "", issued = "", deviceId = ""] = parts;
  if (publicId === "" || !EPOCH_SECONDS.test(issued) || !DEVICE_ID.test(deviceId)) return null;
  const issuedAt = Number(issued);
  const age = Math.floor(now / 1000) - issuedAt;
  if (age < 0 || age > DEVICE_COOKIE_MAX_AGE) return null;
  return { publicId, issuedAt, deviceId };
}

/**
 * The request's device cookie, if it carries our signature (HMAC-SHA256 with the auth secret,
 * checked by better-call) and parses. A missing, forged or malformed cookie is just `null`: it
 * only ever grants an exemption, so there is nothing to report.
 */
export async function readDeviceCookie(
  ctx: DeviceCookieContext,
  now = Date.now(),
): Promise<DeviceCookie | null> {
  const value = await ctx.getSignedCookie(deviceCookie(ctx).name, ctx.context.secret);
  // `null`: no cookie or no signature; `false`: a signature that doesn't verify.
  return typeof value === "string" ? parseDeviceCookie(value, now) : null;
}

/** (Re)issues the device cookie for `publicId`, keeping the device ID this browser already has. */
export async function setDeviceCookie({
  ctx,
  publicId,
  now = Date.now(),
}: {
  ctx: DeviceCookieContext;
  publicId: string;
  now?: number;
}): Promise<void> {
  const existing = await readDeviceCookie(ctx, now);
  const deviceId =
    existing?.publicId === publicId ? existing.deviceId : randomBytes(16).toString("base64url");
  const { name, attributes } = deviceCookie(ctx);
  await ctx.setSignedCookie(
    name,
    `${publicId}.${Math.floor(now / 1000)}.${deviceId}`,
    ctx.context.secret,
    attributes,
  );
}
