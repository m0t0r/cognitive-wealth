// Client-safe: the confirm page runs this on `#next` before navigating, and the server runs it on
// the `callbackURL` it puts into the sign-in email.

/** Where users land when no usable path was given. */
export const DEFAULT_CALLBACK_PATH = "/";

const MAX_LENGTH = 2048;

// RFC 3986 path, query and fragment characters plus `%` for escapes. Everything else (whitespace,
// control characters, `\`, quotes, `<>`, `^`, `` ` ``, `{|}`) is refused rather than escaped.
const ALLOWED = /^[A-Za-z0-9\-._~!$&'()*+,;=:@/?#%]*$/;

// Any base works; it only lets `URL` resolve the path. `.invalid` can never be a real host.
const PROBE_ORIGIN = "https://callback.invalid";

/**
 * Returns `path` if it is a same-origin relative path (a single leading `/`, then a path, query
 * or hash), normalized; otherwise `null`. Refuses protocol-relative (`//`, `/\`) and absolute
 * URLs, and any of those hidden behind percent-encoding or dot segments.
 */
export function sanitizeCallbackPath(path: unknown): string | null {
  if (typeof path !== "string" || path.length === 0 || path.length > MAX_LENGTH) return null;
  if (!ALLOWED.test(path)) return null;

  // Check every decoding of the value, so a layer that decodes it once more (a router, the confirm
  // page's URLSearchParams) can't turn it into `//evil.com`.
  let decoded = path;
  for (let i = 0; i < 4; i++) {
    if (!isSafeShape(decoded)) return null;
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return null;
    }
    if (next === decoded) break;
    decoded = next;
    // Still changing after the last round: too deeply encoded to be anything legitimate.
    if (i === 3) return null;
  }

  let url: URL;
  try {
    url = new URL(path, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PROBE_ORIGIN) return null;
  // Dot segments can collapse into a protocol-relative path (`/.//evil.com` → `//evil.com`).
  const normalized = `${url.pathname}${url.search}${url.hash}`;
  return isSafeShape(normalized) ? normalized : null;
}

/** Like {@link sanitizeCallbackPath}, with `/` for anything refused. */
export function callbackPathOrDefault(path: unknown): string {
  return sanitizeCallbackPath(path) ?? DEFAULT_CALLBACK_PATH;
}

function isSafeShape(value: string): boolean {
  if (!value.startsWith("/")) return false;
  const second = value[1];
  if (second === "/" || second === "\\") return false;
  // Decoded layers may reveal these (an encoded space is fine); the raw value can't contain them
  // (see ALLOWED).
  // oxlint-disable-next-line no-control-regex
  return !/[\u0000-\u001f\u007f\\]/.test(value);
}
