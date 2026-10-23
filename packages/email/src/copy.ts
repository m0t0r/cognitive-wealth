// Copy and formatting shared by the HTML templates and the plain-text renderers, so both
// versions of an email always say the same thing. Plain TS with no imports, so the e2e suite can
// import it (`@repo/email/copy`) to match subjects.

export const BRAND = "Cognitive Wealth";

/** Collapses whitespace (including newlines) so a value can't add lines to a header or text body. */
export function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const PLURAL = new Intl.PluralRules("en");

/** "1 minute", "5 minutes": the locale's plural rule picks the whole phrase. */
export function minutes(count: number): string {
  return PLURAL.select(count) === "one" ? `${count} minute` : `${count} minutes`;
}

export function signInExpiryNotice(expiresInMinutes: number): string {
  return `This link and code expire in ${minutes(expiresInMinutes)} and can be used once.`;
}

export const SIGN_IN_SUBJECT = `Your ${BRAND} sign-in link`;

export function invitationSubject(organizationName: string): string {
  return `You're invited to join ${singleLine(organizationName)} on ${BRAND}`;
}

export const SIGN_IN_IGNORE_NOTICE = "If you didn't request this email, you can safely ignore it.";

export const INVITATION_IGNORE_NOTICE =
  "If you weren't expecting this invitation, you can safely ignore this email.";

const ROLE_LABELS: Record<string, string> = {
  owner: "an owner",
  admin: "an admin",
  member: "a member",
};

/** "a member", "an admin", or the raw role for anything custom. */
export function roleLabel(role: string): string {
  const clean = singleLine(role);
  return ROLE_LABELS[clean] ?? clean;
}

const EXPIRY_FORMAT = new Intl.DateTimeFormat("en", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "UTC",
});

/** The recipient's time zone is unknown, so dates are spelled out in UTC. */
export function formatExpiry(expiresAt: Date | string | number): string {
  return `${EXPIRY_FORMAT.format(new Date(expiresAt))} UTC`;
}

export function invitationHeadline(organizationName: string): string {
  return `Join ${singleLine(organizationName)} on ${BRAND}`;
}

export function invitationSummary(props: {
  organizationName: string;
  inviterName?: string | null;
  role: string;
}): string {
  const inviter = singleLine(props.inviterName ?? "");
  const invited = inviter === "" ? "You've been invited" : `${inviter} has invited you`;
  return `${invited} to join ${singleLine(props.organizationName)} as ${roleLabel(props.role)}.`;
}
