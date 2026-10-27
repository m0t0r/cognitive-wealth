import { setTimeout as sleep } from "node:timers/promises";

/** A message as the harness sees it. `date` is when Mailpit received it, by Mailpit's clock. */
export interface MailpitMessage {
  id: string;
  subject: string;
  text: string;
  html: string;
  to: string[];
  date: Date;
}

export interface WaitForMessageOptions {
  /** Recipient address, matched exactly (case-insensitive). */
  to: string;
  /** Exact subject, or a pattern. */
  subject?: string | RegExp;
  /** Only messages Mailpit received at or after this time (Mailpit's clock, ms precision). */
  after?: Date;
  /**
   * Skip these message IDs. Take them with `messageIds(to)` before triggering the email: unlike
   * `after`, this doesn't depend on the host and container clocks agreeing.
   */
  exclude?: ReadonlySet<string>;
  /** Default 10s. */
  timeoutMs?: number;
}

export interface Mailpit {
  /** Polls until a matching message arrives and returns the newest match. */
  waitForMessage(options: WaitForMessageOptions): Promise<MailpitMessage>;
  /** IDs of the messages to `to` that Mailpit holds right now. */
  messageIds(to: string): Promise<Set<string>>;
}

export interface SignInEmail {
  /** The confirm page URL, `<app>/sign-in/confirm#token=…&next=…`. */
  url: string;
  token: string;
  /** The decoded `next` path; `/` when the link carries none. */
  next: string;
  /** The 6-digit code. */
  code: string;
}

export interface InvitationEmail {
  url: string;
}

// Subset of Mailpit's v1 API (`/api/v1/swagger.json`): `MessagesSummary` and `Message`.
interface Address {
  Address: string;
}

interface MessageSummary {
  ID: string;
  Subject: string;
  To: Address[] | null;
  Created: string;
}

interface MessageResponse {
  ID: string;
  Subject: string;
  To: Address[] | null;
  Text: string;
  HTML: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAddresses(value: unknown): value is Address[] | null {
  return (
    value === null ||
    (Array.isArray(value) &&
      value.every((item) => isRecord(item) && typeof item.Address === "string"))
  );
}

function isSummary(value: unknown): value is MessageSummary {
  return (
    isRecord(value) &&
    typeof value.ID === "string" &&
    typeof value.Subject === "string" &&
    typeof value.Created === "string" &&
    isAddresses(value.To)
  );
}

function isMessage(value: unknown): value is MessageResponse {
  return (
    isRecord(value) &&
    typeof value.ID === "string" &&
    typeof value.Subject === "string" &&
    typeof value.Text === "string" &&
    typeof value.HTML === "string" &&
    isAddresses(value.To)
  );
}

const POLL_INTERVAL_MS = 100;
const SEARCH_LIMIT = 50;

/**
 * A client for Mailpit's v1 API at `baseUrl`. Credentials in the URL (`http://user:pass@host`)
 * are sent as HTTP Basic auth, for a Mailpit started with `--ui-auth-file`.
 */
export function createMailpit(baseUrl: string): Mailpit {
  const url = new URL(baseUrl);
  const headers: Record<string, string> = { accept: "application/json" };
  if (url.username || url.password) {
    const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
    headers.authorization = `Basic ${Buffer.from(credentials).toString("base64")}`;
    url.username = "";
    url.password = "";
  }
  const root = url.toString().replace(/\/+$/, "");

  async function get<T>(path: string, isExpected: (body: unknown) => body is T): Promise<T> {
    const response = await fetch(`${root}${path}`, { headers, signal: AbortSignal.timeout(5_000) });
    const text = await response.text();
    if (!response.ok) throw new Error(`Mailpit GET ${path} failed: ${response.status} ${text}`);
    const body: unknown = JSON.parse(text);
    if (!isExpected(body)) throw new Error(`Unexpected Mailpit response to GET ${path}: ${text}`);
    return body;
  }

  /** Mailpit's `to:` search is a substring match, so callers filter the results exactly. */
  async function search(to: string): Promise<MessageSummary[]> {
    const address = to.toLowerCase();
    const query = encodeURIComponent(`to:"${address}"`);
    const { messages } = await get(
      `/api/v1/search?query=${query}&limit=${SEARCH_LIMIT}`,
      (body): body is { messages: MessageSummary[] } =>
        isRecord(body) && Array.isArray(body.messages) && body.messages.every(isSummary),
    );
    return messages.filter((message) =>
      (message.To ?? []).some((recipient) => recipient.Address.toLowerCase() === address),
    );
  }

  return {
    async messageIds(to) {
      return new Set((await search(to)).map((message) => message.ID));
    },

    async waitForMessage({ to, subject, after, exclude, timeoutMs = 10_000 }) {
      const deadline = Date.now() + timeoutMs;
      const matches = (message: MessageSummary) =>
        !exclude?.has(message.ID) &&
        (after === undefined || new Date(message.Created).getTime() >= after.getTime()) &&
        (subject === undefined ||
          (typeof subject === "string"
            ? message.Subject === subject
            : subject.test(message.Subject)));

      for (;;) {
        // Polling is sequential by nature: each attempt waits for the previous one.
        // oxlint-disable-next-line no-await-in-loop
        const found = (await search(to)).find(matches);
        if (found) {
          // oxlint-disable-next-line no-await-in-loop
          const message = await get(`/api/v1/message/${found.ID}`, isMessage);
          return {
            id: message.ID,
            subject: message.Subject,
            text: message.Text,
            html: message.HTML,
            to: (message.To ?? []).map((recipient) => recipient.Address),
            date: new Date(found.Created),
          };
        }
        if (Date.now() >= deadline) {
          const filters = [
            subject === undefined ? undefined : `subject ${String(subject)}`,
            after ? `after ${after.toISOString()}` : undefined,
          ].filter(Boolean);
          throw new Error(
            `No email to ${to}${filters.length > 0 ? ` (${filters.join(", ")})` : ""} arrived in Mailpit within ${timeoutMs}ms`,
          );
        }
        // oxlint-disable-next-line no-await-in-loop
        await sleep(POLL_INTERVAL_MS);
      }
    },
  };
}

/** The value of a `<label>: <value>` line, tolerating CRLF and surrounding whitespace. */
function line({ text, label, kind }: { text: string; label: string; kind: string }): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const value = new RegExp(`^[ \\t]*${escaped}:[ \\t]*(\\S+)[ \\t]*\\r?$`, "m").exec(text)?.[1];
  if (!value) {
    throw new Error(
      `${kind} email has no "${label}: …" line. Plain text was:\n${text.slice(0, 1_000)}`,
    );
  }
  return value;
}

/** Reads the link and code from a sign-in email's plain text (docs/auth.md, "Email"). */
export function parseSignInEmail(text: string): SignInEmail {
  const url = line({ text, label: "Sign-in link", kind: "Sign-in" });
  const code = line({ text, label: "Sign-in code", kind: "Sign-in" });
  if (!/^\d{6}$/.test(code)) throw new Error(`Sign-in code is not 6 digits: ${code}`);

  if (!URL.canParse(url)) throw new Error(`Sign-in link is not a URL: ${url}`);
  const fragment = new URLSearchParams(new URL(url).hash.slice(1));
  const token = fragment.get("token");
  if (!token) throw new Error(`Sign-in link has no #token: ${url}`);
  return { url, token, next: fragment.get("next") ?? "/", code };
}

/** Reads the accept link from an invitation email's plain text. */
export function parseInvitationEmail(text: string): InvitationEmail {
  const url = line({ text, label: "Invitation link", kind: "Invitation" });
  if (!URL.canParse(url)) throw new Error(`Invitation link is not a URL: ${url}`);
  return { url };
}
