export type { EmailMessage, Mailer } from "./types";
export { renderInvitationEmail, renderSignInEmail, type RenderedEmail } from "./render";
export type { InvitationEmailProps } from "./templates/invitation";
export type { SignInEmailProps } from "./templates/sign-in";
export { createSmtpMailer, type SmtpMailerOptions } from "./transports/smtp";
export { createResendMailer, type ResendMailerOptions } from "./transports/resend";
export { mailerFromEnv, type EmailEnv } from "./env";
