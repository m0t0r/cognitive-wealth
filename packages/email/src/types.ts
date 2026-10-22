export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Provider tags for analytics (Resend). Names and values may only contain ASCII letters,
   * digits, `_` and `-`. The SMTP transport ignores them.
   */
  tags?: Record<string, string>;
  /** Makes a retried send a no-op at the provider (Resend). The SMTP transport ignores it. */
  idempotencyKey?: string;
}

export interface Mailer {
  /** Resolves once the provider accepted the message; rejects with an Error otherwise. */
  send(message: EmailMessage): Promise<void>;
}
