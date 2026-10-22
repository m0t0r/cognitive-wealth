/**
 * Response security headers, aimed at an A+ on securityheaders.com: all six graded headers present
 * and no `'unsafe-inline'`/`'unsafe-eval'` in production `script-src`. The CSP is nonce-based, so
 * `proxy.ts` builds it per request; everything else is static and set in `next.config.ts`.
 */

export interface CspOptions {
  /** `next dev` needs `'unsafe-eval'` (React's error overlay) and unnonced inline styles. */
  dev?: boolean;
}

/**
 * Sonner injects its stylesheet as an unnonced `<style>` at import time, so it's allowed by hash.
 * `security-headers.test.ts` recomputes this from the installed version; update it when it fails.
 */
export const SONNER_STYLE_HASH = "'sha256-StEaX+se6YS7pqjzrzMIA0KaX9zF/8zAhvQXZAe5epY='";

/** Sonner appends that `<style>` empty and fills it after, so the empty string is checked first. */
export const EMPTY_STYLE_HASH = "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='";

export function contentSecurityPolicy(nonce: string, { dev = false }: CspOptions = {}): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // `'strict-dynamic'` lets nonced scripts load Next's chunks without listing them.
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(dev ? ["'unsafe-eval'"] : []),
    ],
    "style-src": [
      "'self'",
      ...(dev ? ["'unsafe-inline'"] : [`'nonce-${nonce}'`, SONNER_STYLE_HASH, EMPTY_STYLE_HASH]),
    ],
    // React server-renders `style` attributes (Base UI's visually hidden inputs), which no nonce
    // can cover. Attribute CSS can't run script; `<style>` elements stay nonce-only.
    "style-src-attr": ["'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}

/** For responses without a page (API routes): nothing may load or frame them. */
export const API_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'";

/** Deny every powerful feature the app doesn't use; loosen one at a time when a feature lands. */
const PERMISSIONS_POLICY = [
  "accelerometer",
  "autoplay",
  "browsing-topics",
  "camera",
  "display-capture",
  "geolocation",
  "gyroscope",
  "magnetometer",
  "microphone",
  "midi",
  "payment",
  "publickey-credentials-get",
  "screen-wake-lock",
  "serial",
  "usb",
  "xr-spatial-tracking",
]
  .map((feature) => `${feature}=()`)
  .join(", ");

export interface StaticHeaderOptions {
  /** Send HSTS. Off in dev so `*.localhost` never gets pinned to HTTPS. */
  hsts?: boolean;
}

export function staticSecurityHeaders({ hsts = true }: StaticHeaderOptions = {}) {
  return [
    ...(hsts
      ? [
          {
            key: "Strict-Transport-Security",
            // No `preload`: submitting to the preload list is a separate, hard-to-undo decision.
            value: "max-age=63072000; includeSubDomains",
          },
        ]
      : []),
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
    // Not graded; isolates the window from cross-origin openers. No CORP: email clients must be
    // able to load the app's images.
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
}
