// Browser side of the allowlisted endpoints. Verify, code and sign-out responses are replaced by
// `{ ok }` on the server, which Better Auth's client doesn't expect, so these helpers call them
// with `fetch` and return a typed result instead of using Better Auth's client.
import { AUTH_BASE_PATH } from "./constants";
import type { AuthErrorCode } from "./route-handler";

export {
  DEFAULT_CALLBACK_PATH,
  callbackPathOrDefault,
  sanitizeCallbackPath,
} from "./callback-path";
export type { AuthErrorCode } from "./route-handler";

export type AuthResult = { ok: true } | { ok: false; error: AuthErrorCode };

/** Asks for the sign-in email. Resolves `ok` whether or not the address may sign in. */
export function requestSignIn(email: string, callbackPath?: string): Promise<AuthResult> {
  return post(
    "/sign-in/magic-link",
    callbackPath === undefined ? { email } : { email, callbackURL: callbackPath },
  );
}

/** Spends the token from the confirm link; sets the session cookie on success. */
export function verifyMagicLink(token: string): Promise<AuthResult> {
  const query = new URLSearchParams({ token });
  return send(`${AUTH_BASE_PATH}/magic-link/verify?${query.toString()}`, { method: "GET" });
}

/** Signs in with the 6-digit code from the same email. */
export function verifyCode(email: string, code: string): Promise<AuthResult> {
  return post("/sign-in/email-otp", { email, otp: code });
}

export function signOut(): Promise<AuthResult> {
  return post("/sign-out", {});
}

function post(path: string, body: unknown): Promise<AuthResult> {
  return send(`${AUTH_BASE_PATH}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ERROR_CODES: readonly AuthErrorCode[] = [
  "invalid_or_expired",
  "too_many_attempts",
  "rate_limited",
  "invalid_request",
  "forbidden",
  "unknown",
];

async function send(url: string, init: RequestInit): Promise<AuthResult> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      credentials: "same-origin",
      redirect: "error",
      headers,
    });
  } catch {
    return { ok: false, error: "unknown" };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return { ok: true };
  const error =
    typeof body === "object" && body !== null && "error" in body ? body.error : undefined;
  return { ok: false, error: isAuthErrorCode(error) ? error : "unknown" };
}

function isAuthErrorCode(value: unknown): value is AuthErrorCode {
  return (ERROR_CODES as readonly unknown[]).includes(value);
}
