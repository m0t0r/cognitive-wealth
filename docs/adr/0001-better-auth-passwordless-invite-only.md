# ADR 0001: Better Auth, passwordless and invite-only

- Status: accepted
- Date: 2026-10-22

Authentication runs on Better Auth inside our own app and Postgres (Drizzle adapter, `magicLink`, `emailOTP` and `organization` plugins), not on a hosted identity provider. Sign-in is passwordless: one email carries both a magic link and a 6-digit code, so people can finish on the device that got the email or type the code on another one. There is no password sign-in.

Sign-up is invite-only. A sign-in email goes only to an existing user or to an address with a pending, unexpired invitation; everyone else gets the same response and no email. Users never create organizations: an operator does, with `pnpm org:create` (or the seed in development).

## Consequences

- With no password fallback, the sign-in email is the only way in, so its limits must never let someone else lock a user out by requesting emails for their address ([docs/auth.md](../auth.md), "Sign-in email limits").
- Users and sessions live in our database, so we own revocation and incident response ([ADR 0005](0005-sessions-cached-in-redis.md), [docs/incident-response.md](../incident-response.md)).
- Better Auth's defaults shape other decisions: its ID handling ([ADR 0003](0003-internal-bigint-ids-public-uuids.md)) and its large HTTP surface ([ADR 0004](0004-browser-reaches-better-auth-through-an-allowlist.md)).
