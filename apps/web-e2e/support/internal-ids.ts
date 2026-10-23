import type { Page } from "@playwright/test";

/**
 * Keys that only ever hold internal IDs (Better Auth's foreign keys and our own). DTOs name
 * their references `…PublicId`, which these exact-key patterns don't match.
 */
const INTERNAL_KEYS = [
  "userId",
  "organizationId",
  "activeOrganizationId",
  "memberId",
  "inviterId",
  "sessionId",
  "actorUserId",
];

// The payloads are JSON (auth responses), or JSON embedded in JavaScript strings (the RSC payload
// inlined in HTML as `self.__next_f.push([1,"…\"id\":1…"])`), so a quote may be escaped: `\\*"`.
const INTERNAL_KEY = new RegExp(`\\\\*"(${INTERNAL_KEYS.join("|")})\\\\*"\\s*:`, "g");

/**
 * An `"id"` key with a whole-number value, bare (`"id":3`) or as a string (`"id":"3"`). Internal
 * IDs are small (identity columns restart at 1 for every test), so a bare number would match
 * half the page; only an `id` key whose whole value is one of the journey's IDs counts. Values
 * like `"id":"sign-in-email"` or `"id":"base-ui-:r1:"` don't match.
 */
const ID_VALUE = /\\*"id\\*"\s*:\s*(?:(\d+)(?![\w.])|\\*"(\d+)\\*")/g;

/** Every place `body` carries an internal-ID key, or an `id` holding one of `ids`. */
export function findInternalIds(body: string, ids: ReadonlySet<number>): string[] {
  const found: string[] = [];
  for (const match of body.matchAll(INTERNAL_KEY)) found.push(match[0]);
  for (const match of body.matchAll(ID_VALUE)) {
    const value = Number(match[1] ?? match[2]);
    if (ids.has(value)) found.push(match[0]);
  }
  return found;
}

export interface CapturedBody {
  url: string;
  contentType: string;
  body: string;
}

const CAPTURED_TYPES = /^(text\/html|text\/x-component|application\/json)/;

/**
 * Records the body of every HTML, RSC (`text/x-component`) and JSON response `page` receives
 * from here on. `page.on("response")` can't do this: Chromium keeps no body for a streamed
 * response (RSC) or for one whose page has navigated on (the verify fetch). So each response is
 * paused (CDP `Fetch`, response stage), read, and passed on unchanged: requests still go through
 * Chromium's own network stack, with its real `Sec-Fetch-*` headers and cookies.
 */
export async function captureResponseBodies(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const bodies: CapturedBody[] = [];
  const errors: string[] = [];
  const pending: Array<Promise<void>> = [];

  // The fields of CDP's `Fetch.requestPaused` this reads.
  async function capture(event: {
    requestId: string;
    request: { url: string };
    responseStatusCode?: number;
    responseHeaders?: Array<{ name: string; value: string }>;
  }) {
    const status = event.responseStatusCode ?? 0;
    const contentType =
      event.responseHeaders?.find((header) => header.name.toLowerCase() === "content-type")
        ?.value ?? "";
    // Redirects have no body.
    if ((status < 300 || status >= 400) && CAPTURED_TYPES.test(contentType)) {
      const { body, base64Encoded } = await cdp.send("Fetch.getResponseBody", {
        requestId: event.requestId,
      });
      bodies.push({
        url: event.request.url,
        contentType,
        body: base64Encoded ? Buffer.from(body, "base64").toString("utf8") : body,
      });
    }
    await cdp.send("Fetch.continueRequest", { requestId: event.requestId });
  }

  cdp.on("Fetch.requestPaused", (event) => {
    pending.push(
      capture(event).catch((error: unknown) => {
        errors.push(`${event.request.url}: ${String(error)}`);
      }),
    );
  });
  await cdp.send("Fetch.enable", {
    patterns: (["Document", "Fetch", "XHR"] as const).map((resourceType) => ({
      urlPattern: "*",
      resourceType,
      requestStage: "Response" as const,
    })),
  });

  return {
    /** Every body so far; throws if one couldn't be read, so nothing is skipped silently. */
    collect: async (): Promise<CapturedBody[]> => {
      await Promise.all(pending);
      if (errors.length > 0) throw new Error(`Unreadable responses:\n${errors.join("\n")}`);
      return bodies;
    },
  };
}
