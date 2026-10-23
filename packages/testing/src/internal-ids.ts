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

/**
 * Every place `body` (a response body: JSON, HTML or an RSC payload) carries an internal-ID key,
 * or an `id` holding one of `ids`. The E2E journey in `internal-ids.spec.ts` runs it over
 * everything Chromium receives.
 */
export function findInternalIds(body: string, ids: ReadonlySet<number>): string[] {
  const found: string[] = [];
  for (const match of body.matchAll(INTERNAL_KEY)) found.push(match[0]);
  for (const match of body.matchAll(ID_VALUE)) {
    const value = Number(match[1] ?? match[2]);
    if (ids.has(value)) found.push(match[0]);
  }
  return found;
}
