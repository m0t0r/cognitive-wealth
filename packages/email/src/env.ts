import { readFileSync } from "node:fs";
import { createResendMailer } from "./transports/resend";
import { createSmtpMailer } from "./transports/smtp";
import type { Mailer } from "./types";

export type EmailEnv = Record<string, string | undefined>;

export type EmailConfig =
  | { transport: "smtp"; from: string; url: string }
  | { transport: "resend"; from: string; apiKey: string };

export const DEV_SMTP_URL = "smtp://localhost:1025";
export const DEV_EMAIL_FROM = "Cognitive Wealth <no-reply@cognitive-wealth.localhost>";

/**
 * Reads the email settings:
 * - `EMAIL_TRANSPORT`: `smtp` or `resend`
 * - `EMAIL_FROM`: the sender
 * - `SMTP_URL`: for `smtp`
 * - `RESEND_API_KEY` or `RESEND_API_KEY_FILE` (read and trimmed): for `resend`
 *
 * In production (`NODE_ENV=production`) `EMAIL_TRANSPORT`, `EMAIL_FROM` and the chosen
 * transport's settings must all be set. Elsewhere it defaults to Mailpit on
 * `smtp://localhost:1025` with a `cognitive-wealth.localhost` sender.
 */
export function emailConfigFromEnv(env: EmailEnv = process.env): EmailConfig {
  const production = env.NODE_ENV === "production";
  const transport = value(env, "EMAIL_TRANSPORT");
  const from = value(env, "EMAIL_FROM");

  if (production && (transport === undefined || from === undefined)) {
    throw new Error("EMAIL_TRANSPORT and EMAIL_FROM must be set in production");
  }

  switch (transport ?? "smtp") {
    case "smtp": {
      const url = value(env, "SMTP_URL");
      if (production && url === undefined) {
        throw new Error("SMTP_URL must be set when EMAIL_TRANSPORT=smtp in production");
      }
      return { transport: "smtp", from: from ?? DEV_EMAIL_FROM, url: url ?? DEV_SMTP_URL };
    }
    case "resend":
      return { transport: "resend", from: from ?? DEV_EMAIL_FROM, apiKey: resendApiKey(env) };
    default:
      throw new Error('EMAIL_TRANSPORT must be "smtp" or "resend"');
  }
}

/** Builds the mailer that the environment selects; see {@link emailConfigFromEnv}. */
export function mailerFromEnv(env: EmailEnv = process.env): Mailer {
  const config = emailConfigFromEnv(env);
  return config.transport === "smtp"
    ? createSmtpMailer({ url: config.url, from: config.from })
    : createResendMailer({ apiKey: config.apiKey, from: config.from });
}

function resendApiKey(env: EmailEnv): string {
  const key = value(env, "RESEND_API_KEY");
  const file = value(env, "RESEND_API_KEY_FILE");
  if (key !== undefined && file !== undefined) {
    throw new Error("Set only one of RESEND_API_KEY and RESEND_API_KEY_FILE");
  }
  if (key !== undefined) return key;
  if (file === undefined) {
    throw new Error(
      "RESEND_API_KEY or RESEND_API_KEY_FILE must be set when EMAIL_TRANSPORT=resend",
    );
  }

  let contents: string;
  try {
    contents = readFileSync(file, "utf8").trim();
  } catch {
    throw new Error("Could not read RESEND_API_KEY_FILE");
  }
  if (contents === "") throw new Error("RESEND_API_KEY_FILE is empty");
  return contents;
}

/** An unset or blank variable counts as missing. */
function value(env: EmailEnv, name: string): string | undefined {
  const raw = env[name]?.trim();
  return raw === undefined || raw === "" ? undefined : raw;
}
