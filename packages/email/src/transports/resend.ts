import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { Resend } from "resend";
import type { Mailer } from "../types";

export interface ResendMailerOptions {
  apiKey: string;
  /** Sender on a domain verified in Resend, e.g. `Cognitive Wealth <no-reply@example.com>`. */
  from: string;
  /** Total tries for transient failures (network, 429, 5xx). */
  maxAttempts?: number;
  /** Delay before retry `attempt` (1-based); exponential with jitter by default. */
  retryDelay?: (attempt: number) => number;
}

const defaultRetryDelay = (attempt: number) => 250 * 2 ** (attempt - 1) * (1 + Math.random());

/** No status means the request never got an answer (network error or timeout). */
function isTransient(statusCode: number | null) {
  return statusCode === null || statusCode === 429 || statusCode >= 500;
}

/**
 * Sends through the Resend API. Transient failures are retried with the same idempotency key, so a
 * retry never delivers twice. Rejections become Errors that never contain the API key.
 */
export function createResendMailer({
  apiKey,
  from,
  maxAttempts = 3,
  retryDelay = defaultRetryDelay,
}: ResendMailerOptions): Mailer {
  if (apiKey.trim() === "") throw new Error("Resend API key is empty");
  const resend = new Resend(apiKey);

  return {
    async send({ to, subject, html, text, tags, idempotencyKey = `send/${randomUUID()}` }) {
      const payload = {
        from,
        to,
        subject,
        html,
        text,
        ...(tags && { tags: Object.entries(tags).map(([name, value]) => ({ name, value })) }),
      };

      for (let attempt = 1; ; attempt++) {
        // Retries are sequential by definition.
        // oxlint-disable-next-line no-await-in-loop
        const { error } = await resend.emails.send(payload, { idempotencyKey });
        if (!error) return;
        if (attempt >= maxAttempts || !isTransient(error.statusCode)) {
          const status = error.statusCode === null ? "" : ` (HTTP ${error.statusCode})`;
          const detail = error.message.replaceAll(apiKey, "[redacted]");
          throw new Error(`Resend rejected the email: ${error.name}${status}: ${detail}`);
        }
        // oxlint-disable-next-line no-await-in-loop
        await sleep(retryDelay(attempt));
      }
    },
  };
}
