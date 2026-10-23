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
  - `member.role` and `invitation.role` hold exactly one of `owner`, `admin`, `member` (CHECK constraints, migration `0003_role_check`). Better Auth stores a comma-separated list when asked for several roles; nothing may write one.
- `schema/audit.ts`
  - `audit_event`: id, created_at, action (text), actor_user_id → user (set null), organization_id → organization (set null), target_type, target_id (text, a publicId), ip_address, user_agent, metadata jsonb. **Append-only for the `app` role**: the migration revokes `update, delete` from `app` when that role exists (guard it so PGlite, which has no `app` role, still migrates).

Better Auth sees `publicId` through `additionalFields` (`{ type: "string", required: false, input: false }`) on user, organization, member and invitation. The database generates the value.

`@repo/db` also exports the full schema object for the adapter (`@repo/db/schema`, an index that re-exports every table).

## Auth server (`@repo/auth`)

Framework-agnostic: it takes `Headers` and returns data or throws typed errors. `apps/web/lib/auth/*` adapts it to `next/headers` and `redirect()`.

Configuration (`createAuth(deps)`, a factory so tests inject PGlite, a memory mailer and memory storage):

- `baseURL`: `BETTER_AUTH_URL`, else `PORTLESS_URL` outside production; an origin only (no path or query). Production requires `https`, except on loopback (`localhost`, `*.localhost`, `127.0.0.0/8`, `[::1]`: the Compose stack and e2e), since a sign-in link's fragment is readable by anyone who can rewrite plain-http pages. `secret`: `BETTER_AUTH_SECRET` or `BETTER_AUTH_SECRET_FILE`.
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

### Session cache trade-off

- **What:** with `secondaryStorage`, Better Auth's `findSession` serves the session and a snapshot of its user from Redis without checking Postgres. The entry lives as long as the session (TTL = its expiry, up to 7 days, extended on refresh).
- **Consequence:** changes made outside Better Auth's functions (SQL deletes of sessions, a user delete that cascades, direct updates to user rows) don't sign anyone out or refresh the cached user until the entry expires. A Redis miss, flush or eviction of a session entry falls back to Postgres, which is safe. Better Auth's `active-sessions-<user id>` lists are not: they are rewritten without a transaction (two concurrent sign-ins can each drop the other's token) and LRU can evict one while its sessions stay cached. Better Auth's `deleteUserSessions` finds cached sessions only through that list, so `revokeUserSessions` reads the user's tokens from Postgres and deletes each cached entry itself. Membership and tenant checks always read Postgres (`getViewer`), so removing a member still takes effect on the next request.
- **Why accepted:** fast session lookups; the gap only opens through a deliberate bypass of Better Auth.
- **Rules:** revoke sessions and delete or deactivate users only through Better Auth (`auth.api.revokeSessions`/`revokeOtherSessions`, the internal adapter's `deleteUserSessions`/`deleteUser`) or `revokeUserSessions`, never raw SQL. Domain code that disables an account must also revoke the user's sessions.

### Sign-in request (one email, link and code)

`sendMagicLink({ email, token, url })` runs inside Better Auth's `POST /sign-in/magic-link` handler, which answers `{ status: true }` as soon as it returns. Its latency must not reveal which addresses can sign in (account enumeration), so in-request it does only work that costs the same for every address: normalize the email, read and verify the device cookie (whether or not the address has a user), resolve the client IP and capture the user agent. The magic-link plugin's own token insert, before the callback, is also the same for all. Everything below runs in a **background task** from those captured values (never the request context, which may be gone), through `runInBackground` in `AuthDeps`. `apps/web` passes Next's `after()`, which keeps the task alive on every host Next supports: `next start` and the Docker image drain pending callbacks on SIGTERM (give the platform a 10 to 30 second stop grace period), and serverless platforms supply `waitUntil` to it. **Deployment requirement:** a host that freezes the process after the response without wiring `waitUntil` into `after()` would silently never send sign-in emails. The package default (for non-Next callers) starts the task in-process, which only works on a long-lived Node process. Verified live on the standalone build: the email arrives through `after()`, and warm responses for known and unknown addresses take the same time (5.2 ms against 4.4 ms on average, within noise). Any failure in the task is logged and the link deleted; the response never changes.

1. Run an **eligibility check**: an existing user, or a pending, unexpired invitation for that email. If not eligible, return without sending. The HTTP response is identical either way (`{ status: true }`).
2. **Sign-in email limits** (Redis counters), all checked before a code is issued. Requests count no matter who makes them, so a single per-address limit would let anyone who knows an address block that user's sign-in emails (there is no password fallback, and the code comes in the same email). Instead:
   - **Known device:** if the request carries a valid device cookie for the user who owns the address, only `sign-in-email:dev:<email>:<device id>` applies (3 per 10 minutes) and the next two rules are skipped. A browser the user signed in from before can always get an email, even while the address is flooded or an attacker shares their NAT.
   - **Per requester:** otherwise `sign-in-email:req:<email>:<client IP>`, 3 per hour. The IP comes from Better Auth's `getIP` (the trusted header); `unknown` when there is none, which production refuses. Its hourly total stays below the address backstop, so it takes at least 4 requesters to use the backstop up (at 3 per 10 minutes, one requester could spend all 10 alone).
   - **Per address:** only if the requester rule passed, `sign-in-email:addr:<email>`, 10 per hour, a backstop against inbox bombing from many IPs. Because it runs second, one requester stuck at its limit can't keep spending the budget everyone else shares.

   When a rule trips: no email, the stored link is deleted, the response is still `{ status: true }`, and `auth.sign_in_throttled` is audited with `metadata: { rule }`, the IP and the user's publicId as target (never the email).

   The **device cookie** (`cw.device`, `__Secure-cw.device` with secure cookies) is a Better Auth signed cookie (HMAC-SHA256 with the auth secret, via better-call's `setSignedCookie`/`getSignedCookie`) holding `<user publicId>.<issued at, epoch seconds>.<random 16-byte base64url device id>`. `hooks.after` sets it on every successful sign-in, keeping the device id when the browser already holds a valid one for the same user: `HttpOnly`, `SameSite=Lax`, `Secure` like the session cookie, `Path=/api/auth` (browsers send it only to auth endpoints), `Max-Age` 180 days. It marks a device and authenticates nothing, so sign-out leaves it. It counts only if the signature verifies, it is well-formed, it was issued neither in the future nor more than 180 days ago, and its publicId is the existing user's with that email (invitees never match). Anything else is treated as no cookie.

3. Issue the code: call `auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } })` inside an `AsyncLocalStorage` slot. The emailOTP callback writes the code into the slot and **throws if no slot exists**, so codes are only ever issued alongside a link.
4. Build the confirm URL: `${baseURL}/sign-in/confirm#token=<token>&next=<callbackPath>`. The token is in the **fragment**, so opening the link sends it to no server, log or Referer. It reaches the server once, in the confirm page's same-origin verify call (`GET /magic-link/verify?token=…`), which spends it; a deployment whose proxy logs query strings records only spent tokens, or ones refused before the token check (`429`, `5xx`), which expire within 5 minutes. `callbackPath` comes from the `callbackURL` query of Better Auth's `url`. Accept it only if it starts with a single `/` (not `//` or `/\`), otherwise use `/`.
5. Render the sign-in email and send it (awaited inside the background task, never by the request). Pass `idempotencyKey: "sign-in/<random uuid>"` (never derived from the token) and `tags: { category: "sign_in" }`.

Defense in depth: `databaseHooks.user.create.before` returns `false` unless the email has a pending, unexpired invitation. The seed and CLIs insert users with Drizzle directly, so they never reach the hook and need no "trusted" flag.

After any successful sign-in (`hooks.after` on `/magic-link/verify` and `/sign-in/email-otp`), delete every other pending sign-in credential for that email: the `sign-in-otp-<email>` verification row and magic-link rows whose value has that email. One email creates at most one session. If that cleanup (or setting the device cookie) fails, the hook deletes the session it just created and the sign-in fails with `unknown`: a failure never leaves a session next to a live sibling.

**Codes and enumeration.** A code allows 3 tries (`allowedAttempts`), and the route handler also counts every code attempt per address, `sign-in-code:<email>`, 10 per day: past it, every code for the address is refused until the window ends (the link in the email still works). Without it, 10 codes an hour at 3 tries each would allow about 30 guesses an hour at a 6-digit code, all day. Both refusals, and Better Auth's `TOO_MANY_ATTEMPTS`, answer exactly like a wrong code (`400 invalid_or_expired`): only an address that was sent a code can use one up, so a distinct answer would tell anyone who guesses 4 times which addresses are users or invitees. The sign-in page counts the tries itself to say a code is used up.

### Browser-facing HTTP surface

`app/api/auth/[...all]/route.ts` exports `createAuthRouteHandler(auth)`. Anything not listed returns `404` without reaching Better Auth's router.

| Method and path            | Extra rule                                                                                                                | Response the browser sees                                                        | Rate limit (per IP) |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------- |
| `POST /sign-in/magic-link` | body `{ email, callbackURL? }`, callbackURL must be a relative path                                                       | `{ status: true }`                                                               | 5 / 60s             |
| `GET /magic-link/verify`   | `Sec-Fetch-Site: same-origin` and `Sec-Fetch-Mode` ≠ `navigate`; no `callbackURL`/`newUserCallbackURL`/`errorCallbackURL` | body replaced with `{ ok: true }` (or `{ ok: false, error }`), `Set-Cookie` kept | 10 / 60s            |
| `POST /sign-in/email-otp`  | body `{ email, otp }`; at most 10 attempts per address per day                                                            | body replaced with `{ ok: true }` (or `{ ok: false, error }`), `Set-Cookie` kept | 5 / 60s             |
| `POST /sign-out`           | none                                                                                                                      | `{ ok: true }`                                                                   | default             |

The `Sec-Fetch-*` rule means opening the verify URL as a page (a scanner, prefetch, or link click) never consumes a token. Only a same-origin `fetch` from our confirm page does (`Sec-Fetch-Mode` `cors` or `same-origin`; `navigate`, `no-cors` and a missing header are refused). Error bodies use a small fixed set of codes (`invalid_or_expired`, `rate_limited`, `invalid_request`, `forbidden`, `unknown`), never Better Auth messages. A used-up or over-budget code is `invalid_or_expired`, like a wrong one (see "Codes and enumeration"). When an answer falls back to `unknown`, the handler logs the route, Better Auth's status and error code (fixed identifiers; never bodies, tokens or addresses), so an unexpected Better Auth answer, e.g. after an upgrade, shows up in the server log.

The handler rebuilds every request it forwards from checked parts: exact, case-sensitive path match (no trailing slash), strict JSON bodies of at most 4 KiB with only the listed fields, no query string on POSTs and only `token` on verify. Every POST must carry `Origin` equal to the app's origin (or `Origin: null` with `Sec-Fetch-Site: same-origin`, which browsers send under `Referrer-Policy: no-referrer`), and any `Sec-Fetch-Site` other than `same-origin` is refused. This is login-CSRF protection on top of Better Auth's own check, which skips cookie-less requests to `/sign-in/email-otp`. Better Auth answers a bad verify token by redirecting to `/?error=INVALID_TOKEN`; the handler turns that into `400 { ok: false, error: "invalid_or_expired" }` and never passes a `Location` on.

### Tenant and session API (server only)

- `getViewer(auth, headers)` returns `null` or `{ user: PublicUser, session: { createdAt, expiresAt, isFresh }, tenant: Tenant | null, memberships: PublicMembership[], internal: { userId, organizationId, memberId } }`. `internal` stays on the server; it never goes into props or responses. The result carries a unique-symbol brand that only `getViewer` sets, so a `Viewer` can't be built by hand.
- `requireTenant(auth, headers)` returns `Result<TenantViewer>` (a `Viewer` whose `tenant` and `internal.organizationId`/`memberId` are non-null), failing with `unauthenticated` or `no_tenant`. `tenantOf(viewer)` does the same for a viewer already looked up.
- On session creation (`databaseHooks.session.create.before`), set `activeOrganizationId` to the organization of the user's latest session while they still belong to it (so signing in again, e.g. to confirm a sensitive action, doesn't switch workspaces), otherwise to their most recently created membership.
- If the active org is missing, or the user is no longer a member, `getViewer` falls back to another membership (and updates the session) or returns `tenant: null`.
- **Reads take a verified viewer**, not `headers`, so a page looks the session up once per request (`apps/web/lib/auth/viewer.ts` caches it with React `cache`) and passes it down:
  - `listMemberships(viewer: Viewer): PublicMembership[]`
  - `listMembers(auth, viewer: TenantViewer): Promise<PublicMember[]>`
  - `listInvitations(auth, viewer: TenantViewer): Promise<PublicInvitation[]>`: the tenant's `pending` invitations, expired ones included, so the members page can mark them **Expired** and offer to send them again
  - `listMyInvitations(auth, viewer: Viewer): Promise<PublicInvitation[]>`: invitations addressed to the viewer's own normalized email that they can still answer (`pending`, not expired), newest first, for `/no-workspace`. It never returns another address's invitations.
- **Mutations** take `headers` (Better Auth's `auth.api.*` needs them) plus `publicId`s, resolve the viewer's tenant, resolve the `publicId`s to internal IDs within it, call `auth.api.*`, write an `audit_event`, and return DTOs:
  - switch org, invite, change role, remove member, cancel invitation, get/accept/decline invitation, update profile name
  - **Tenant mutations** (`inviteMember`, `changeMemberRole`, `removeMember`, `cancelInvitation`, and every later one, all through `mutateTenant`) also take a required `organizationPublicId`: the workspace the caller's page showed. If it isn't the viewer's verified active organization (another tab switched the session), they return `{ error: "tenant_changed" }` before any other check or side effect: no input validation, rate-limit hit, Better Auth call, email or audit row. The tenant is the session's, not the URL's, so without this a page left open in one tab would act on whatever workspace another tab switched to. Only `unauthenticated` and `no_tenant` come first. The web app sends the `organizationPublicId` of the tenant DTO the page rendered, and on `tenant_changed` says "You switched workspace in another tab. This page now shows <workspace>." and re-renders the page in the active tenant.
  - role changes, member removal, invitation cancellation and **inviting someone as owner or admin** require a **fresh** session (created within 1 hour); otherwise they return `{ error: "reauth_required" }`. An elevated invite grants as much as a role change: without the gate, a stolen old session could invite a new owner, accept it from a fresh sign-in, and remove the real owners from there.
  - `inviteMember` makes Better Auth's permission checks (`invitation:create`; owner invitations only from owners) and the already-a-member check itself, before the per-inviter rate limit, so an invite that would be refused doesn't spend the hourly budget.
  - Better Auth awaits `sendInvitationEmail` but logs and swallows its errors. The callback marks a failure in an `AsyncLocalStorage` slot (`trackInvitationEmail`), and `inviteMember` then returns `{ error: "email_failed" }` after auditing the stored invitation (`metadata: { role, emailSent: false }`) and the one it replaced. Inviting again replaces it and sends a new email.
  - An invitation stays only as good as its inviter: accepting checks (`organizationHooks.beforeAcceptInvitation`) that the inviter is still a member whose role grants `invitation:create`, and that an owner invitation still comes from an owner; otherwise Better Auth's `INVITER_IS_NO_LONGER_A_MEMBER_OF_THE_ORGANIZATION` (`not_found`). `getInvitation` and `listMyInvitations` apply the same rule, and removing someone or changing their role cancels the pending invitations they could no longer send (audited with `metadata: { reason: "inviter_removed" | "inviter_role_changed" }`). Better Auth only checks the inviter when the invitation is created, so without this a removed owner could rejoin through an invitation sent to another address of theirs.
  - inviting an address again replaces its pending invitations in that organization, expired ones included. Better Auth's `cancelPendingInvitationsOnReInvite` only sees unexpired ones (its `findPendingInvitation` filters expired rows out), so `inviteMember` cancels the rest through `auth.api.cancelInvitation` once the new invitation exists, and audits each replaced one as `org.invitation.cancelled` with `metadata: { replacedBy }`. A resend is an ordinary invite: same permission, same 20-per-hour limit.
- `revokeUserSessions(auth, userPublicId)`: signs a user out everywhere at once. It reads the user's session tokens from Postgres, calls Better Auth's internal adapter (`deleteUserSessions`, which deletes the Postgres rows and the cached entries it finds through `active-sessions-<userId>`), then deletes each token's cached entry itself (see "Session cache trade-off"), and audits `auth.sessions_revoked`; `not_found` for an unknown publicId. A storage error is thrown, never reported as success. For incident response and for domain code that disables an account.
- Server-side rate limiter (`consumeRateLimit(storage, key, { window, max })` over `secondaryStorage.increment`), used by the invite action (20 per hour per user) and anything else costly.
- DTOs: `PublicUser { publicId, name, email, image }`, `PublicOrganization { publicId, name, slug, logo }`, `PublicMember { publicId, role, user: PublicUser, createdAt }`, `PublicInvitation { publicId, email, role, status, expiresAt, organization: PublicOrganization, inviter: { name } }`. Mappers drop every internal ID.

Client (`@repo/auth/client`): typed `fetch` helpers for the allowlisted calls (`requestSignIn`, `verifyMagicLink`, `verifyCode`, `signOut`), each returning `{ ok: true } | { ok: false, error: AuthErrorCode }`. Not Better Auth's React client: the allowlist replaces response bodies with `{ ok }`, which that client doesn't expect.

Audit events: `auth.sign_in` (method), `auth.sign_out`, `auth.sessions_revoked`, `org.invitation.created|accepted|declined|cancelled`, `org.member.role_changed|removed`, `org.switched`, `user.profile_updated`. Writing an audit event never blocks the user action: on failure, log and continue. The client-set user agent is cut to 512 characters.

Profile names are one line of printable text, 1 to 100 characters: no C0 or C1 control characters, line or paragraph separators, or bidi controls (U+200E, U+200F, U+202A–U+202E, U+2066–U+2069), since names appear in invitation emails sent to other people.

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
- **Deliberate exception:** the local Compose stack (published on loopback only) and e2e set `AUTH_TRUSTED_IP_HEADER=x-forwarded-for` without `AUTH_TRUSTED_PROXIES`, so they trust a client-set `x-forwarded-for`. That is acceptable there only because nothing beyond loopback reaches them. A real deployment must use a header its edge proxy overwrites, or `x-forwarded-for` with `AUTH_TRUSTED_PROXIES`.

Environment variables (server, read at request time; declared in `turbo.json` `dev.passThroughEnv`):
`BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_SECRET_FILE`, `AUTH_TRUSTED_IP_HEADER`, `AUTH_TRUSTED_PROXIES`, `REDIS_URL`, `REDIS_PASSWORD_FILE`, `REDIS_KEY_PREFIX`, `EMAIL_TRANSPORT`, `EMAIL_FROM`, `SMTP_URL`, `RESEND_API_KEY`, `RESEND_API_KEY_FILE`, `MAILPIT_URL` (harness only).

Environments: `NODE_ENV` is the build mode, and every deployed image (and e2e, and Compose) is `production`. It only drives fail-closed guards: a production build refuses to start without explicit config (`apps/web/instrumentation.ts` checks `authOptionsFromEnv` and `mailerFromEnv` when the server starts, not on the first sign-in), and never gets a relaxed check. Differences between environments are explicit capability settings (`EMAIL_TRANSPORT`, `BETTER_AUTH_URL`, `AUTH_TRUSTED_IP_HEADER`, …), not branches on an environment name. When the first multi-environment deployment lands, add `APP_ENV` as a label only (an enum, required with no default in production, used for error-tracking and log tags). It must never enable a dev tool or weaken a security check.

### Incident response

See "Session cache trade-off": SQL alone doesn't reach the Redis cache.

- **Sign out one user** (immediate): `revokeUserSessions(auth, userPublicId)`. Or SQL `delete from session where user_id = …` **plus** deleting that user's Redis keys (their session tokens and `active-sessions-<user id>`, under `REDIS_KEY_PREFIX`); the SQL alone leaves cached sessions valid for up to 7 days.
- **Sign out everyone** (immediate once both steps are done): `delete from session`, then flush the app's Redis keys (prefix `REDIS_KEY_PREFIX`, default `cw:`) through an admin connection, since the app's ACL user can't `SCAN`. Or simply restart Redis: it has no persistence, so this also resets rate-limit counters.
- **Strongest** (immediate on deploy): rotate `BETTER_AUTH_SECRET`. It invalidates every signed session and device cookie, whatever Postgres or Redis still hold.

## Dev and test sign-in harness (`@repo/testing`)

- `@repo/testing/mailpit`: `createMailpit(baseUrl)` with `waitForMessage({ to, subject?, after?, timeoutMs? })` (polls the Mailpit API), plus `parseSignInEmail(text) → { url, token, next, code }` and `parseInvitationEmail(text) → { url }`.
- `@repo/testing/sign-in`: `signIn({ appUrl, email, mailpitUrl, ip? })`, built only on the public HTTP surface:
  1. `POST /api/auth/sign-in/magic-link` with `Origin: appUrl`.
  2. Wait for the email in Mailpit and parse the token.
  3. `GET /api/auth/magic-link/verify?token=…` with `Sec-Fetch-Site: same-origin`, `Sec-Fetch-Mode: cors`.
  4. Return the cookies and a Playwright `storageState`.
- CLI: `pnpm dev:sign-in <email> [--link] [--state <file>] [--app <url>] [--ip <addr>]`
  - The default does the full sign-in and writes `.dev/auth/<email>.json` (gitignored, mode 0600), loadable with `agent-browser --state <file>` or Playwright `storageState`.
  - `--link` only prints the confirm URL and code, for walking through the UI by hand.
  - `--ip <addr>` passes one IP to `signIn`/`requestSignInEmail` as `x-forwarded-for`, so sessions against a stack that trusts it (Compose) get separate rate-limit buckets.
  - Refuses unless the app and Mailpit hosts are loopback or `*.localhost`.
- Seed (`pnpm db:seed`, refuses when `NODE_ENV=production` or the database host isn't local, read both as WHATWG `URL` reads it and as postgres.js does: after the first `@`, percent-decoded, every host of a comma-separated list):
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
- `/sign-in/confirm`: reads `#token`/`#next`, clears the fragment with `history.replaceState`, shows "Continue to Cognitive Wealth"; the click calls verify by `fetch`, then navigates to `next`. Never auto-submits. A link signs in whoever it was sent to, in any browser, so someone already signed in sees "You're signed in as <email>. Continuing signs you in with the account this link was sent to instead." before the click.
- `/welcome`: a user with an empty name sets it before entering the app.
- `/sign-in?next=/invite/…` is headed "Sign in to view your invitation", without naming the organization to a signed-out visitor.
- `/sign-in/confirm`: a token that fails the shape check (the verify route's own pattern, `SIGN_IN_TOKEN_PATTERN`) is never sent, and verify's `invalid_request` is treated like `invalid_or_expired`: both show "This sign-in link has expired or was already used" with "Get a new sign-in link" (keeping `next`).
- `/invite/[publicId]`: signed out, it redirects to `/sign-in?next=/invite/<id>`; signed in, it shows the org, inviter and role with Accept/Decline. Decline is confirmed in an AlertDialog, then the card says "Invitation declined" and links to the viewer's workspace (or onward to `/no-workspace`). A wrong account sees a neutral "This invitation is for someone else" with Sign out, plus "Go to your workspace" when they have one. An invitation that can't be used (expired, cancelled, answered) links to the viewer's workspace, or without one to `/no-workspace`.
- `/no-workspace`: signed in without memberships. Lists the viewer's own open invitations (`listMyInvitations`), each linking to `/invite/<publicId>`; with none, says to ask an owner or admin to invite them.
- `/` (app home): requires a tenant; app shell with org switcher, account menu (sign out) and a placeholder.
- `/settings`: redirects to `/settings/members`.
- `/settings/members`
  - members and pending invitations
  - invite form for owners and admins
  - change role, remove, cancel; destructive actions confirmed in an AlertDialog, and so is making someone an owner or changing an owner's role (owners have full control, including removing other owners)
  - expired invitations carry an "Expired" badge and offer **Resend** (`inviteMember` with the same email and role) next to Cancel
  - an Actions column only when the viewer can act on at least one row of that table
  - dates in the viewer's locale and time zone (`components/local-date.tsx`: UTC on the server and during hydration, the local date right after; an inline script would need the per-request CSP nonce)
  - focus never drops to the page: when a row goes (removed, cancelled, resent), it moves to the next row's actions, else the section heading; after an invitation is sent, to the emptied email field
  - every action sends the page's `organizationPublicId`; `tenant_changed`, `forbidden`, `not_found` and `no_tenant` refresh the page so it shows the current workspace, role and rows
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

Each behaviour has one owning layer: test it there, and give other layers at most one representative case.

| Level                                         | Owns                                                                                                                                                                                                                      | Shouldn't repeat                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Unit                                          | Pure logic with many edge cases: callback-path sanitizer, allowlist path matcher, Sec-Fetch and origin rules, env parsing, device-cookie parsing, DTO mappers                                                             | Anything needing Better Auth or a database                             |
| Integration (PGlite + real Better Auth)       | The main home for auth and security rules: replay and expiry, sibling cleanup, eligibility gate, throttle rules, roles and permissions, tenant scoping (incl. `tenant_changed`), fresh-session gating, audit rows, timing | Browser behaviour                                                      |
| UI (RTL + happy-dom)                          | Component state machines: sign-in steps, resend cooldown, the confirm page not calling verify before a click, dialog confirms, focus after a row goes, refresh on stale-page errors                                       | The full journey, or server rules                                      |
| E2E (real Chromium, Redis, Mailpit, Postgres) | Only what needs the real stack; one representative case per category already covered by integration tests                                                                                                                 | The full permission matrix, every error variant, every rate-limit rule |

Beyond the table, E2E owns what only a browser or the deployed build can show: cookie flags, security headers and CSP, the scanner simulation (navigating to verify never spends a token), axe scans of every route in light and dark, keyboard journeys and aria snapshots.
