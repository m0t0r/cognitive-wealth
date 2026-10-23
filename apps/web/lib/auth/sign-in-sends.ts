// The sign-in emails this browser asked for, counted against the server's per-requester limits
// (`SIGN_IN_REQUESTER_LIMITS`). The server answers a refused request like any other, so it can't
// reveal which addresses can sign in; the page counts its own requests instead, to say when
// another email can go out rather than offer a "Resend" that silently sends nothing. It only knows
// this browser's requests: other devices, or other people asking for the same address, can still
// stop an email it expects.
import { SIGN_IN_REQUESTER_LIMITS } from "@repo/auth/client";

type Rule = keyof typeof SIGN_IN_REQUESTER_LIMITS;

/** Each window as the server keeps it: fixed from its first request (epoch ms), with a count. */
export type SendHistory = Record<Rule, { start: number; count: number }>;

const RULES = Object.keys(SIGN_IN_REQUESTER_LIMITS).filter((rule): rule is Rule =>
  Object.hasOwn(SIGN_IN_REQUESTER_LIMITS, rule),
);

const windowEnd = (start: number, rule: Rule) =>
  start + SIGN_IN_REQUESTER_LIMITS[rule].window * 1000;

/** When the next email can go out (epoch ms), or `null` if it can now. */
export function nextSendAt(history: SendHistory | undefined, now: number): number | null {
  let at: number | null = null;
  for (const rule of RULES) {
    const window = history?.[rule];
    if (window === undefined || now >= windowEnd(window.start, rule)) continue;
    if (window.count < SIGN_IN_REQUESTER_LIMITS[rule].max) continue;
    at = Math.max(at ?? 0, windowEnd(window.start, rule));
  }
  return at;
}

/** `history` with one more request at `now`; a window that has ended starts again. */
export function recordSend(history: SendHistory | undefined, now: number): SendHistory {
  const bump = (rule: Rule) => {
    const window = history?.[rule];
    return window === undefined || now >= windowEnd(window.start, rule)
      ? { start: now, count: 1 }
      : { start: window.start, count: window.count + 1 };
  };
  return { burst: bump("burst"), hour: bump("hour") };
}

const STORAGE_KEY = "cw.sign-in-sends";
const LONGEST_WINDOW = Math.max(...RULES.map((rule) => SIGN_IN_REQUESTER_LIMITS[rule].window));

/**
 * The stored history for `email`, so a reload doesn't forget the count. Kept under a SHA-256 of
 * the normalized address, never the address itself. `undefined` without one, or without storage
 * (private windows, blocked site data, no Web Crypto).
 */
export async function loadSendHistory(email: string): Promise<SendHistory | undefined> {
  try {
    const key = await storageKey(email);
    return readAll()[key];
  } catch {
    return undefined;
  }
}

/** Stores `history` for `email`, dropping entries whose windows have all ended. Best effort. */
export async function saveSendHistory(
  email: string,
  history: SendHistory,
  now = Date.now(),
): Promise<void> {
  try {
    const key = await storageKey(email);
    const kept = Object.fromEntries(
      Object.entries(readAll()).filter(([, entry]) =>
        RULES.some((rule) => now < (entry[rule]?.start ?? 0) + LONGEST_WINDOW * 1000),
      ),
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...kept, [key]: history }));
  } catch {
    // A convenience only: without storage, the page just forgets the count on reload.
  }
}

/**
 * Every stored history; entries of any other shape (an older version, a hand edit) are dropped. A
 * hand-written check rather than a zod object schema: zod's object parser probes `new Function`,
 * which the CSP refuses (and reports) on every page that loads this.
 */
function readAll(): Record<string, SendHistory> {
  const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  if (typeof raw !== "object" || raw === null) return {};
  return Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, SendHistory] => isSendHistory(entry[1])),
  );
}

function isSendHistory(value: unknown): value is SendHistory {
  return RULES.every((rule) => {
    const window: unknown =
      typeof value === "object" && value !== null ? Reflect.get(value, rule) : null;
    return (
      typeof window === "object" &&
      window !== null &&
      typeof Reflect.get(window, "start") === "number" &&
      typeof Reflect.get(window, "count") === "number"
    );
  });
}

async function storageKey(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
