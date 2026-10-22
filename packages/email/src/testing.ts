import type { EmailMessage, Mailer } from "./types";

export interface MemoryMailer extends Mailer {
  /** Every message sent so far, oldest first. */
  readonly messages: EmailMessage[];
}

/** A mailer that records messages instead of sending them. Create one per test. */
export function createMemoryMailer(): MemoryMailer {
  const messages: EmailMessage[] = [];
  return {
    messages,
    send(message) {
      messages.push(structuredClone(message));
      return Promise.resolve();
    },
  };
}
