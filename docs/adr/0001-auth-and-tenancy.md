# ADR 0001: Authentication and multi-tenancy

- Status: accepted
- Date: 2026-10-22
- Scope: `@repo/db`, `@repo/auth`, `@repo/email`, `@repo/testing`, `apps/web`, `apps/web-e2e`, Compose

This is the spec for the auth foundation. Code that disagrees with it is a bug in one or the other: fix the code, or change this file in the same commit.

## Decisions

| Topic       | Decision                                                                                                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Library     | Better Auth `1.7.12` (`better-auth`), Drizzle adapter (`provider: "pg"`, schema passed explicitly). The CLI is `npx auth@latest`; `auth migrate` does not apply to Drizzle, `auth generate` is only a reference.                    |
| Sign-in     | Passwordless only. One email carries a **magic link and a 6-digit code** (magicLink + emailOTP plugins). No `emailAndPassword`.                                                                                                     |
| Sign-up     | **Invite-only.** A magic link/code is only emailed to an existing user or to an address with a pending, unexpired invitation. Everyone else gets the same response and no email. Orgs are created by the seed or `pnpm org:create`. |
| Tenancy     | Better Auth `organization` plugin. The tenant is the session's `activeOrganizationId`; URLs carry no tenant. Roles: `owner`, `admin`, `member`. Teams off.                                                                          |
| IDs         | `bigint generated always as identity` PKs (`advanced.database.generateId: "serial"`). Tables users can see have `public_id uuid not null unique default uuidv7()` (native in Postgres 18 and PGlite 0.5).                           |
| ID exposure | Internal IDs never reach the browser. The browser reaches a short allowlist of Better Auth endpoints whose responses carry no IDs; everything else is Server Actions/Server Components that take `publicId`s and return DTOs.       |
| Sessions    | 7 days, sliding (`updateAge` 1 day), `freshAge` 1 hour for sensitive actions. Cookie cache **off**. Sessions in Postgres (source of truth) and cached in Redis.                                                                     |
| Redis       | Redis 8.8 holds only what we can lose: rate-limit counters and the session cache. Verification tokens stay in Postgres (`verification.storeInDatabase: true`).                                                                      |
| Email       | React Email templates in `@repo/email`. Transport `smtp` (Mailpit in dev/e2e) or `resend` (production). Previews with `email dev`.                                                                                                  |
| Dev sign-in | No backdoor in the app. The real flow runs end to end; a harness reads the email from Mailpit's API and completes sign-in from outside.                                                                                             |
| RLS         | Deferred to domain modeling. Tenant scoping is explicit via `requireTenant()` and org-scoped queries.                                                                                                                               |

## Flagged limitations

1. `generateId: "serial"` disables Better Auth's deterministic "reserve" single-use checks (SAML assertion IDs, DPoP, JWT assertions). We use none of those plugins; adding SSO or an OAuth provider later needs a re-check.
2. With serial IDs Better Auth requires a verified email for invitation actions. Magic-link and OTP sign-in mark the email verified, so this holds.
3. Better Auth exchanges IDs as strings and converts with `Number()`; IDs above 2^53 would lose precision (not reachable in practice).
4. uuidv7 embeds its creation time, so a `publicId` reveals when a row was created.
5. Better Auth's rate limiter and origin check only run on HTTP requests through its router. Server-side `auth.api.*` calls (Server Actions) skip both; we apply our own limiter there, and Next checks Server Action origins.
6. `session.activeOrganizationId` is a plain string field to Better Auth (no `references`), so it is not converted like FKs. It is a bigint column mapped to a JS string (custom column type) with an FK `on delete set null`.

## Data model (`@repo/db`)

Conventions: snake_case columns, `timestamptz`, helpers in `src/schema/_helpers.ts`. No serial, no composite PKs. Files Node runs directly keep `.ts` import extensions.

New helpers:

- `id()`: `bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity()`
- `publicId()`: `uuid("public_id").notNull().unique().default(sql\`uuidv7()\`)`
- `bigintString(name)`: a `customType` stored as `bigint`, read and written as a JS `string`

Tables (Better Auth model name → table):

- `schema/auth.ts`
  - `user`: id, public_id, name, email (unique, must be lowercase), email_verified, image, created_at, updated_at
  - `session`: id, token (unique), user_id → user (cascade), expires_at, ip_address, user_agent, active_organization_id `bigintString` → organization (set null), created_at, updated_at
  - `account`: Better Auth's core columns, user_id → user (cascade)
  - `verification`: id, identifier (indexed), value, expires_at, created_at, updated_at
- `schema/organization.ts`
  - `organization`: id, public_id, name, slug (unique), logo, metadata, created_at
  - `member`: id, public_id, organization_id → organization (cascade), user_id → user (cascade), role, created_at, **unique (organization_id, user_id)**
  - `invitation`: id, public_id, organization_id → organization (cascade), email, role, status, expires_at, created_at, inviter_id → user (cascade); indexes on (organization_id) and (email)
- `schema/audit.ts`
  - `audit_event`: id, created_at, action (text), actor_user_id → user (set null), organization_id → organization (set null), target_type, target_id (text, a publicId), ip_address, user_agent, metadata jsonb. **Append-only for the `app` role**: the migration revokes `update, delete` from `app` when that role exists (guard it so PGlite, which has no `app` role, still migrates).

Better Auth sees `publicId` through `additionalFields` (`{ type: "string", required: false, input: false }`) on user, organization, member and invitation. The database generates the value.

`@repo/db` also exports the full schema object for the adapter (`@repo/db/schema`, an index that re-exports every table).

## Auth server (`@repo/auth`)

Framework-agnostic: it takes `Headers` and returns data or throws typed errors. `apps/web/lib/auth/*` adapts it to `next/headers` and `redirect()`.

Configuration (`createAuth(deps)`, a factory so tests inject PGlite, a memory mailer and memory storage):

- `baseURL`: `BETTER_AUTH_URL`, else `PORTLESS_URL` outside production; an origin only (no path or query). `secret`: `BETTER_AUTH_SECRET` or `BETTER_AUTH_SECRET_FILE`.
- `advanced`: `database.generateId: "serial"`, `cookiePrefix: "cw"`, default cookie attributes (HttpOnly, SameSite=Lax, Secure on https/production via `useSecureCookies`, which adds the `__Secure-` name prefix). `disableOriginCheck` and `disableCSRFCheck` are pinned to `false`: Better Auth turns its origin check off when `NODE_ENV=test`, and tests must run what production runs. Client IP (for rate limits and audit): `ipAddress.ipAddressHeaders = [AUTH_TRUSTED_IP_HEADER]` and `ipAddress.trustedProxies = AUTH_TRUSTED_PROXIES` (comma-separated IPs or CIDRs). Better Auth 1.7 accepts a header only when it holds a single IP, or, with `trustedProxies`, walks the chain right to left past the trusted hops. Its default reads `x-forwarded-for`, which a directly exposed server would let clients forge. So when `AUTH_TRUSTED_IP_HEADER` is unset, point `ipAddressHeaders` at a header nothing sends (`x-cw-client-ip-unset`). Production requires `AUTH_TRUSTED_IP_HEADER` and refuses to start without it, because an unresolved IP puts everyone in one shared rate-limit bucket. Use a header your edge proxy overwrites (e.g. `cf-connecting-ip`, `x-real-ip`), or `x-forwarded-for` with `AUTH_TRUSTED_PROXIES`. Everything else that needs the client IP (the Server Action limiter, audit events) calls Better Auth's own `getIP(headers, auth.options)` from `better-auth/api`, so there's one set of trust rules. Never use "first header that holds an IP" helpers (e.g. remix-utils `getClientIPAddress`): clients can set any of those headers. **No `backgroundTasks` handler**: the combined email depends on awaited callbacks.
- `session`: `expiresIn` 7d, `updateAge` 1d, `freshAge` 1h, cookie cache disabled, `storeSessionInDatabase: true`.
- `secondaryStorage`: our Redis adapter over `redis@6` (`get`, `set` with TTL, `delete`, `increment` = atomic INCR plus EXPIRE on first hit, `getAndDelete` = GETDEL), keys prefixed with `REDIS_KEY_PREFIX` (default `cw:`).
- `verification.storeInDatabase: true`.
- `rateLimit`: enabled in every environment, `storage: "secondary-storage"`; custom rules for the allowlisted paths (below).
- Plugins:
  - `magicLink({ storeToken: "hashed", expiresIn: 300, disableSignUp: false, sendMagicLink })`
  - `emailOTP({ storeOTP: "hashed", otpLength: 6, expiresIn: 300, allowedAttempts: 3, sendVerificationOTP })`
  - `organization({ allowUserToCreateOrganization: false, creatorRole: "owner", invitationExpiresIn: 7d, cancelPendingInvitationsOnReInvite: true, requireEmailVerificationOnInvitation: true, sendInvitationEmail, schema: { …publicId additionalFields } })` with access control from `@repo/auth/access`
  - `nextCookies()` last, so Server Actions that call `auth.api` set cookies

### Sign-in request (one email, link and code)

`sendMagicLink({ email, token, url })` runs inside Better Auth's `POST /sign-in/magic-link` handler:

1. Normalize the email. Run an **eligibility check**: an existing user, or a pending, unexpired invitation for that email. If not eligible, return without sending. The HTTP response is identical either way (`{ status: true }`).
2. A per-email limit (Redis counter, 3 per 10 minutes). Over the limit: no email, same response.
3. Issue the code: call `auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } })` inside an `AsyncLocalStorage` slot. The emailOTP callback writes the code into the slot and **throws if no slot exists**, so codes are only ever issued alongside a link.
4. Build the confirm URL: `${baseURL}/sign-in/confirm#token=<token>&next=<callbackPath>`. The token is in the **fragment**, so it never reaches a server, log or Referer. `callbackPath` comes from the `callbackURL` query of Better Auth's `url`. Accept it only if it starts with a single `/` (not `//` or `/\`), otherwise use `/`.
5. Render the sign-in email and send it **without awaiting delivery** (`void mailer.send(...).catch(log)`), so response timing doesn't reveal eligibility. Pass `idempotencyKey: "sign-in/<random uuid>"` (never derived from the token) and `tags: { category: "sign_in" }`.

Defense in depth: `databaseHooks.user.create.before` returns `false` unless the email has a pending, unexpired invitation. The seed and CLIs insert users with Drizzle directly, so they never reach the hook and need no "trusted" flag.

After any successful sign-in (`hooks.after` on `/magic-link/verify` and `/sign-in/email-otp`), delete every other pending sign-in credential for that email: the `sign-in-otp-<email>` verification row and magic-link rows whose value has that email. One email creates at most one session.

### Browser-facing HTTP surface

`app/api/auth/[...all]/route.ts` exports `createAuthRouteHandler(auth)`. Anything not listed returns `404` without reaching Better Auth's router.

| Method and path            | Extra rule                                                                                                                | Response the browser sees                                                        | Rate limit (per IP) |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------- |
| `POST /sign-in/magic-link` | body `{ email, callbackURL? }`, callbackURL must be a relative path                                                       | `{ status: true }`                                                               | 5 / 60s             |
| `GET /magic-link/verify`   | `Sec-Fetch-Site: same-origin` and `Sec-Fetch-Mode` ≠ `navigate`; no `callbackURL`/`newUserCallbackURL`/`errorCallbackURL` | body replaced with `{ ok: true }` (or `{ ok: false, error }`), `Set-Cookie` kept | 10 / 60s            |
| `POST /sign-in/email-otp`  | body `{ email, otp }`                                                                                                     | body replaced with `{ ok: true }` (or `{ ok: false, error }`), `Set-Cookie` kept | 5 / 60s             |
| `POST /sign-out`           | none                                                                                                                      | `{ ok: true }`                                                                   | default             |

The `Sec-Fetch-*` rule means opening the verify URL as a page (a scanner, prefetch, or link click) never consumes a token. Only a same-origin `fetch` from our confirm page does (`Sec-Fetch-Mode` `cors` or `same-origin`; `navigate`, `no-cors` and a missing header are refused). Error bodies use a small fixed set of codes (`invalid_or_expired`, `too_many_attempts`, `rate_limited`, `invalid_request`, `forbidden`, `unknown`), never Better Auth messages.

The handler rebuilds every request it forwards from checked parts: exact, case-sensitive path match (no trailing slash), strict JSON bodies of at most 4 KiB with only the listed fields, no query string on POSTs and only `token` on verify. Every POST must carry `Origin` equal to the app's origin (or `Origin: null` with `Sec-Fetch-Site: same-origin`, which browsers send under `Referrer-Policy: no-referrer`), and any `Sec-Fetch-Site` other than `same-origin` is refused. This is login-CSRF protection on top of Better Auth's own check, which skips cookie-less requests to `/sign-in/email-otp`. Better Auth answers a bad verify token by redirecting to `/?error=INVALID_TOKEN`; the handler turns that into `400 { ok: false, error: "invalid_or_expired" }` and never passes a `Location` on.

### Tenant and session API (server only)

- `getViewer(auth, headers)` returns `null` or `{ user: PublicUser, session: { createdAt, expiresAt, isFresh }, tenant: Tenant | null, memberships: PublicMembership[], internal: { userId, organizationId } }`. `internal` stays on the server; it never goes into props or responses.
- On session creation (`databaseHooks.session.create.before`), set `activeOrganizationId` to the user's most recently created membership.
- If the active org is missing, or the user is no longer a member, `getViewer` falls back to another membership (and updates the session) or returns `tenant: null`.
- Organization operations take `headers` plus `publicId`s, resolve them to internal IDs after checking membership, call `auth.api.*`, write an `audit_event`, and return DTOs:
  - switch org, list members/invitations, invite, change role, remove member, cancel invitation, get/accept/decline invitation, update profile name
  - role changes, member removal and invitation cancellation require a **fresh** session (created within 1 hour); otherwise they return `{ error: "reauth_required" }`
- Server-side rate limiter (`consumeRateLimit(storage, key, { window, max })` over `secondaryStorage.increment`), used by the invite action (20 per hour per user) and anything else costly.
- DTOs: `PublicUser { publicId, name, email, image }`, `PublicOrganization { publicId, name, slug, logo }`, `PublicMember { publicId, role, user: PublicUser, createdAt }`, `PublicInvitation { publicId, email, role, status, expiresAt, organization: PublicOrganization, inviter: { name } }`. Mappers drop every internal ID.

Client (`@repo/auth/client`): `createAuthClient` from `better-auth/react` with `magicLinkClient()` and `emailOTPClient()`, used only for the allowlisted calls.

Audit events: `auth.sign_in` (method), `auth.sign_out`, `org.invitation.created|accepted|declined|cancelled`, `org.member.role_changed|removed`, `org.switched`, `user.profile_updated`. Writing an audit event never blocks the user action: on failure, log and continue.

## Email (`@repo/email`)

- Templates (React Email, `src/templates/`): `sign-in.tsx` (link button plus code, expiry note, "didn't ask for this?" line), `invitation.tsx` (org, inviter, role, accept button, expiry), shared `components/layout.tsx`. Each exports `PreviewProps` for `email dev`.
- `render*Email(props)` returns `{ subject, html, text }`. **Plain-text contract** (parsed by the harness, enforced by tests):
  - sign-in: a line `Sign-in link: <url>` and a line `Sign-in code: <6 digits>`
  - invitation: a line `Invitation link: <url>`
- `Mailer { send(message: { to, subject, html, text, tags?, idempotencyKey? }): Promise<void> }`
  - `createSmtpMailer({ url, from })` (nodemailer), `createResendMailer({ apiKey, from })` (Resend API; retries network errors, 429 and 5xx up to 3 attempts with backoff and jitter, reusing one idempotency key, so a retry never sends twice). Invitations use `idempotencyKey: "invitation/<invitation publicId>"`
  - `mailerFromEnv()`: `EMAIL_TRANSPORT` = `smtp` | `resend`; production requires it and `EMAIL_FROM` to be set explicitly. Dev default is smtp to `smtp://localhost:1025`, from `Cognitive Wealth <no-reply@cognitive-wealth.localhost>`.
  - `@repo/email/testing`: `createMemoryMailer()` that records messages.
- Templates import components from `react-email` (v6); `@react-email/components` is deprecated.
- Preview: the package's `dev` script runs `email dev` through portless at `https://emails.cognitive-wealth.localhost`.
- Before production sending (follow-ups, need the verified domain): SPF, DKIM and DMARC records for the `EMAIL_FROM` domain, and a signed Resend webhook endpoint that records bounces and complaints so we stop emailing suppressed addresses.

## Infrastructure

- `compose.yaml`
  - `redis` (`redis:8.8.3-alpine`, tag@digest, hardened like `db`): password from an ACL file built from a mounted secret, never in argv or env; no persistence needed.
  - `mailpit` (`axllent/mailpit:v1.31.6`, tag@digest, hardened): UI and API on `127.0.0.1:8025`.
  - `web` gets `REDIS_URL`, `REDIS_PASSWORD_FILE`, `SMTP_URL`, `EMAIL_TRANSPORT=smtp`, `EMAIL_FROM`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET_FILE`.
  - New secrets: `redis_password`, `better_auth_secret`.
- `compose.dev.yaml` also publishes Redis on `127.0.0.1:6379` and Mailpit SMTP on `127.0.0.1:1025` for `pnpm dev`.
- E2E global setup also starts Redis and Mailpit containers (images read from `compose.yaml`, like Postgres). Each worker's server gets a unique `REDIS_KEY_PREFIX`, `AUTH_TRUSTED_IP_HEADER=x-forwarded-for` and `SMTP_URL`. Each test sends a unique `x-forwarded-for` and uses unique email addresses, so rate limits and mailboxes never collide.

Environment variables (server, read at request time; declared in `turbo.json` `dev.passThroughEnv`):
`BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_SECRET_FILE`, `AUTH_TRUSTED_IP_HEADER`, `AUTH_TRUSTED_PROXIES`, `REDIS_URL`, `REDIS_PASSWORD_FILE`, `REDIS_KEY_PREFIX`, `EMAIL_TRANSPORT`, `EMAIL_FROM`, `SMTP_URL`, `RESEND_API_KEY`, `RESEND_API_KEY_FILE`, `MAILPIT_URL` (harness only).

Environments: `NODE_ENV` is the build mode, and every deployed image (and e2e, and Compose) is `production`. It only drives fail-closed guards: a production build refuses to start without explicit config, and never gets a relaxed check. Differences between environments are explicit capability settings (`EMAIL_TRANSPORT`, `BETTER_AUTH_URL`, `AUTH_TRUSTED_IP_HEADER`, …), not branches on an environment name. When the first multi-environment deployment lands, add `APP_ENV` as a label only (an enum, required with no default in production, used for error-tracking and log tags). It must never enable a dev tool or weaken a security check.

## Dev and test sign-in harness (`@repo/testing`)

- `@repo/testing/mailpit`: `createMailpit(baseUrl)` with `waitForMessage({ to, subject?, after?, timeoutMs? })` (polls the Mailpit API), plus `parseSignInEmail(text) → { url, token, next, code }` and `parseInvitationEmail(text) → { url }`.
- `@repo/testing/sign-in`: `signIn({ appUrl, email, mailpitUrl, ip? })`, built only on the public HTTP surface:
  1. `POST /api/auth/sign-in/magic-link` with `Origin: appUrl`.
  2. Wait for the email in Mailpit and parse the token.
  3. `GET /api/auth/magic-link/verify?token=…` with `Sec-Fetch-Site: same-origin`, `Sec-Fetch-Mode: cors`.
  4. Return the cookies and a Playwright `storageState`.
- CLI: `pnpm dev:sign-in <email> [--link] [--state <file>] [--app <url>]`
  - The default does the full sign-in and writes `.dev/auth/<email>.json` (gitignored, mode 0600), loadable with `agent-browser --state <file>` or Playwright `storageState`.
  - `--link` only prints the confirm URL and code, for walking through the UI by hand.
  - Refuses unless the app and Mailpit hosts are loopback or `*.localhost`.
- Seed (`pnpm db:seed`, refuses when `NODE_ENV=production` or the database host isn't local):
  - users `owner@cognitive-wealth.test` (owner of Acme and Globex), `admin@cognitive-wealth.test` (admin of Acme), `member@cognitive-wealth.test` (member of Acme)
  - orgs `Acme` (`acme`) and `Globex` (`globex`)
  - idempotent
- `pnpm org:create --name <name> [--slug <slug>] --owner <email>`: creates the owner user if missing, then the org.

## Web (`apps/web`)

Routes:

- `/sign-in`
  - email form, then a "check your email" state with a 6-digit code field
  - "resend" with a cooldown
  - friendly messages for `?error=` codes
  - `?next=` preserved
- `/sign-in/confirm`: reads `#token`/`#next`, clears the fragment with `history.replaceState`, shows "Continue to Cognitive Wealth"; the click calls verify by `fetch`, then navigates to `next`. Never auto-submits.
- `/welcome`: a user with an empty name sets it before entering the app.
- `/invite/[publicId]`: signed out, it redirects to `/sign-in?next=/invite/<id>`; signed in, it shows the org, inviter and role with Accept/Decline. A wrong account sees a neutral "This invitation is for a different email".
- `/no-workspace`: signed in without memberships.
- `/` (app home): requires a tenant; app shell with org switcher, account menu (sign out) and a placeholder.
- `/settings/members`
  - members and pending invitations
  - invite form for owners and admins
  - change role, remove, cancel; destructive actions confirmed in an AlertDialog
  - re-auth prompt when not fresh
- `/design-system`: the former `/` preview (public).

`proxy.ts` (Next 16): optimistic session-cookie check for app routes (redirect to `/sign-in?next=`), a per-request nonce CSP, and security headers:

- `frame-ancestors 'none'`
- `Referrer-Policy: no-referrer` on `/sign-in/*` and `/invite/*`, `strict-origin-when-cross-origin` elsewhere
- `X-Content-Type-Options: nosniff`
- HSTS in production

Real authorization always happens on the server (layouts, pages, actions).

UI: shadcn and `@repo/design-system` components only (add missing ones with the shadcn CLI from `apps/web`), guided by the better-layout and better-interface skills. WCAG 2.2 AA; every new route goes into the e2e axe `ROUTES`.

## Testing

- Unit:
  - callbackPath sanitizer, allowlist matcher and `Sec-Fetch` rule, response stripping
  - DTO mappers, email plain-text contract, Mailpit parsers, Redis adapter (against a fake)
- Integration (PGlite plus memory mailer and storage):
  - serial IDs, publicIds and the FK behaviour
  - Better Auth schema check passes against the migrated database
  - sign-in by link and by code, replay, expiry, sibling-credential cleanup
  - eligibility (unknown email gets no mail and no user), invite acceptance only with a matching email
  - roles and permissions, active-org lifecycle, fresh-session gating, audit events, append-only audit for `app`
- UI (RTL plus axe): sign-in form states, confirm page, members table, invite form.
- E2E:
  - sign-in by link and by code (new invitee, existing user), replay and expiry
  - scanner simulation (navigating to verify is rejected and the token survives)
  - unknown email gets no mail
  - invitation with two browser contexts, role enforcement, org switching, removing a member ends their access
  - sign-out, `next` and open-redirect handling
  - the allowlist (everything else 404s)
  - cookie flags, cross-origin POST rejected, rate limits, no internal ID in HTML or auth responses, security headers
  - axe on every route in light and dark, keyboard journeys, aria snapshots
