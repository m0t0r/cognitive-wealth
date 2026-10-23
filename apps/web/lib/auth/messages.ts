// Client-safe copy for the error codes `@repo/auth` returns. Messages never say whether an email
// address has an account, and always say what to do next.
import type { AuthErrorCode } from "@repo/auth/client";
import type { TenantErrorCode } from "@repo/auth";

const SIGN_IN_ERRORS: Record<AuthErrorCode, string> = {
  invalid_or_expired:
    "That sign-in link or code has expired or was already used. Send a new email.",
  too_many_attempts: "Too many tries with this code. Send a new email to get a new code.",
  rate_limited: "Too many sign-in attempts. Wait a minute, then try again.",
  invalid_request: "Check the email address and try again.",
  forbidden: "Unable to sign in from this page. Reload it and try again.",
  unknown: "Unable to reach Cognitive Wealth. Check your connection and try again.",
};

/**
 * Where a sign-in error shows up, for codes whose advice depends on it:
 * - `request`: asking for the email
 * - `code`: entering the 6-digit code
 * - `link`: the confirm page, spending the link's token
 * - `arrival`: a `?error=` code on `/sign-in`
 */
export type SignInErrorContext = "request" | "code" | "link" | "arrival";

const SIGN_IN_ERRORS_IN: Record<SignInErrorContext, Partial<Record<AuthErrorCode, string>>> = {
  request: {},
  code: {
    invalid_or_expired: "That code didn't work. Check it and try again, or send a new email.",
  },
  link: { invalid_or_expired: "This sign-in link has expired or was already used." },
  arrival: {
    invalid_or_expired:
      "That sign-in link has expired or was already used. Enter your email to get a new one.",
  },
};

export function signInErrorMessage(
  code: AuthErrorCode,
  context: SignInErrorContext = "request",
): string {
  return SIGN_IN_ERRORS_IN[context][code] ?? SIGN_IN_ERRORS[code];
}

/** Copy for a `?error=` code on arrival; anything unrecognized gets a neutral message. */
export function arrivalErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return isSignInErrorCode(code)
    ? signInErrorMessage(code, "arrival")
    : "Unable to sign you in. Enter your email to get a new sign-in link.";
}

function isSignInErrorCode(code: string): code is AuthErrorCode {
  return Object.hasOwn(SIGN_IN_ERRORS, code);
}

const TENANT_ERRORS: Record<TenantErrorCode, string> = {
  unauthenticated: "Your session has ended. Reload the page and sign in again.",
  no_tenant: "You're no longer a member of this workspace. Reload the page.",
  not_found: "That person or invitation is no longer here. Reload the page to see the latest.",
  forbidden: "Your role doesn't allow this. Ask a workspace owner for help.",
  reauth_required: "Sign in again to continue.",
  rate_limited: "Too many requests. Wait a while, then try again.",
  invalid_input: "Check the details and try again.",
  last_owner: "A workspace needs at least one owner. Make someone else an owner first.",
  already_member: "That person is already a member of this workspace.",
  wrong_recipient: "This invitation was sent to a different email address.",
  unknown: "Unable to finish that. Try again.",
};

export function tenantErrorMessage(code: TenantErrorCode): string {
  return TENANT_ERRORS[code];
}
