import { render } from "@react-email/render";
import { createElement } from "react";
import {
  BRAND,
  INVITATION_IGNORE_NOTICE,
  SIGN_IN_IGNORE_NOTICE,
  formatExpiry,
  invitationHeadline,
  invitationSummary,
  signInExpiryNotice,
} from "./copy";
import {
  InvitationEmail,
  invitationSubject,
  type InvitationEmailProps,
} from "./templates/invitation";
import { SIGN_IN_SUBJECT, SignInEmail, type SignInEmailProps } from "./templates/sign-in";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Renders the sign-in email. The plain text is built here rather than converted from the
 * HTML, because a harness parses it: it always contains the lines
 * `Sign-in link: <url>` and `Sign-in code: <6 digits>`.
 */
export async function renderSignInEmail(props: SignInEmailProps): Promise<RenderedEmail> {
  assertUrl(props.url);
  if (!/^\d{6}$/.test(props.code)) throw new Error("Sign-in code must be exactly 6 digits");
  if (!Number.isInteger(props.expiresInMinutes) || props.expiresInMinutes < 1) {
    throw new Error("expiresInMinutes must be a positive integer");
  }

  const text = lines(
    `Sign in to ${BRAND}`,
    "",
    "Open the link below to sign in, or enter the code on the sign-in page.",
    "",
    `Sign-in link: ${props.url}`,
    `Sign-in code: ${props.code}`,
    "",
    signInExpiryNotice(props.expiresInMinutes),
    "",
    SIGN_IN_IGNORE_NOTICE,
  );
  return {
    subject: SIGN_IN_SUBJECT,
    html: await render(createElement(SignInEmail, props)),
    text,
  };
}

/**
 * Renders the invitation email. The plain text always contains the line
 * `Invitation link: <url>`; user-provided names are collapsed to one line so they can't
 * add lines of their own.
 */
export async function renderInvitationEmail(props: InvitationEmailProps): Promise<RenderedEmail> {
  assertUrl(props.url);
  if (Number.isNaN(new Date(props.expiresAt).getTime())) {
    throw new Error("expiresAt must be a valid date");
  }

  const text = lines(
    invitationHeadline(props.organizationName),
    "",
    invitationSummary(props),
    "",
    `Invitation link: ${props.url}`,
    "",
    `This invitation expires on ${formatExpiry(props.expiresAt)}.`,
    "",
    INVITATION_IGNORE_NOTICE,
  );
  return {
    subject: invitationSubject(props.organizationName),
    html: await render(createElement(InvitationEmail, props)),
    text,
  };
}

function lines(...parts: string[]): string {
  return `${parts.join("\n")}\n\n-- \n${BRAND}\n`;
}

/** Only absolute http(s) URLs, with nothing that could break a line or an attribute. */
function assertUrl(url: string): void {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    throw new Error("Email link must be an absolute URL");
  }
  if (protocol !== "https:" && protocol !== "http:") {
    throw new Error("Email link must use http or https");
  }
  if (/\s/.test(url)) throw new Error("Email link must not contain whitespace");
}
