import { createTransport, type Transporter } from "nodemailer";
import type { Mailer } from "../types";

export interface SmtpMailerOptions {
  /** Connection URL, e.g. `smtp://localhost:1025` (Mailpit) or `smtps://user:pass@host:465`. */
  url: string;
  /** Sender, e.g. `Cognitive Wealth <no-reply@example.com>`. */
  from: string;
}

/** Sends through an SMTP server with nodemailer (Mailpit in dev and e2e). */
export function createSmtpMailer({ url, from }: SmtpMailerOptions): Mailer {
  return createNodemailerMailer(createTransport(url), from);
}

/** Wraps any nodemailer transporter; tests pass a JSON or stream transport. */
export function createNodemailerMailer(transporter: Transporter, from: string): Mailer {
  return {
    async send({ to, subject, html, text }) {
      await transporter.sendMail({ from, to, subject, html, text });
    },
  };
}
