import { type Page, expect } from "@playwright/test";
import { DEVICE_COOKIE_NAMES, SESSION_COOKIE_NAMES } from "@repo/auth/constants";
import { SIGN_IN_SUBJECT, invitationSubject } from "@repo/email/copy";
import {
  type Mailpit,
  type SignInEmail,
  parseInvitationEmail,
  parseSignInEmail,
} from "@repo/testing/mailpit";

// Driving the real UI (unlike the `signIn` fixture, which uses the HTTP harness).

// Production builds (which e2e runs) use secure cookies, so Better Auth adds the `__Secure-` prefix.
export const [, SESSION_COOKIE] = SESSION_COOKIE_NAMES;
export const [, DEVICE_COOKIE] = DEVICE_COOKIE_NAMES;

export { SIGN_IN_SUBJECT };

/**
 * Reads the inbox before `trigger` runs, so the email returned is the one it caused, not an
 * older one to the same address.
 */
export async function nextEmail({
  mailbox,
  to,
  subject,
  trigger,
}: {
  mailbox: Mailpit;
  to: string;
  subject: string | RegExp;
  trigger: () => Promise<void>;
}) {
  const exclude = await mailbox.messageIds(to);
  await trigger();
  return mailbox.waitForMessage({ to, subject, exclude });
}

/** On `/sign-in`: submits `email` and returns the link and code from the email it sends. */
export async function requestSignInFromUi({
  page,
  mailbox,
  email,
}: {
  page: Page;
  mailbox: Mailpit;
  email: string;
}): Promise<SignInEmail> {
  const message = await nextEmail({
    mailbox,
    to: email,
    subject: SIGN_IN_SUBJECT,
    trigger: async () => {
      await page.getByRole("textbox", { name: "Email" }).fill(email);
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    },
  });
  return parseSignInEmail(message.text);
}

/** Opens the emailed confirm link and clicks Continue, which spends the token. */
export async function confirmSignIn(page: Page, link: SignInEmail): Promise<void> {
  await page.goto(link.url);
  await page.getByRole("button", { name: "Continue to Cognitive Wealth" }).click();
}

/** Waits for the invitation to `organizationName` that `trigger` sends `to`; returns its link. */
export async function invitationLink({
  mailbox,
  to,
  organizationName,
  trigger,
}: {
  mailbox: Mailpit;
  to: string;
  organizationName: string;
  trigger: () => Promise<void>;
}): Promise<string> {
  const message = await nextEmail({
    mailbox,
    to,
    subject: invitationSubject(organizationName),
    trigger,
  });
  return parseInvitationEmail(message.text).url;
}
