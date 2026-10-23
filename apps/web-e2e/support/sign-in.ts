import { type Page, expect } from "@playwright/test";
import {
  type Mailpit,
  type SignInEmail,
  parseInvitationEmail,
  parseSignInEmail,
} from "@repo/testing/mailpit";

// Driving the real UI (unlike the `signIn` fixture, which uses the HTTP harness).

// Production builds (which e2e runs) use secure cookies, so Better Auth adds the `__Secure-` prefix:
// the second of `SESSION_COOKIE_NAMES` in `@repo/auth/constants`, and the device cookie of ADR 0001.
export const SESSION_COOKIE = "__Secure-cw.session_token";
export const DEVICE_COOKIE = "__Secure-cw.device";

export const SIGN_IN_SUBJECT = "Your Cognitive Wealth sign-in link";
export const INVITATION_SUBJECT = /^You're invited to join /;

/**
 * Reads the inbox before `trigger` runs, so the email returned is the one it caused, not an
 * older one to the same address.
 */
export async function nextEmail(
  mailbox: Mailpit,
  to: string,
  subject: string | RegExp,
  trigger: () => Promise<void>,
) {
  const exclude = await mailbox.messageIds(to);
  await trigger();
  return mailbox.waitForMessage({ to, subject, exclude });
}

/** On `/sign-in`: submits `email` and returns the link and code from the email it sends. */
export async function requestSignInFromUi(
  page: Page,
  mailbox: Mailpit,
  email: string,
): Promise<SignInEmail> {
  const message = await nextEmail(mailbox, email, SIGN_IN_SUBJECT, async () => {
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  });
  return parseSignInEmail(message.text);
}

/** Opens the emailed confirm link and clicks Continue, which spends the token. */
export async function confirmSignIn(page: Page, link: SignInEmail): Promise<void> {
  await page.goto(link.url);
  await page.getByRole("button", { name: "Continue to Cognitive Wealth" }).click();
}

/** Waits for the invitation email to `to` that `trigger` sends, and returns its link. */
export async function invitationLink(
  mailbox: Mailpit,
  to: string,
  trigger: () => Promise<void>,
): Promise<string> {
  return parseInvitationEmail((await nextEmail(mailbox, to, INVITATION_SUBJECT, trigger)).text).url;
}
