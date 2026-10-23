# ADR 0005: Sessions in Postgres, cached in Redis

- Status: accepted
- Date: 2026-10-22

Sessions last 7 days, sliding (refreshed once a day), and count as fresh for sensitive actions for 1 hour. Postgres is the source of truth. Better Auth's `secondaryStorage` caches each session, with a snapshot of its user, in Redis. Its cookie cache is off, so every request looks the session up on the server.

Redis holds only what we can lose: the session cache and rate-limit counters. Verification tokens (links and codes) stay in Postgres.

## Why

Session lookups are fast, and a Redis miss, flush or eviction falls back to Postgres, which is safe. The gap opens only when something bypasses Better Auth.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../diagrams/session-cache.dark.svg">
  <img alt="Every request looks the session token up in Redis: a hit serves the cached session and user without checking Postgres; a miss, flush or eviction reads Postgres and re-caches. Signing someone out through revokeUserSessions or Better Auth's APIs deletes the Postgres rows and each cached entry, so they are signed out on the next request; a raw SQL delete or update leaves Redis holding the session, so they stay signed in for up to 7 days." src="../diagrams/session-cache.light.svg">
</picture>

## Consequences

- Better Auth serves a cached session without checking Postgres, for as long as the session lives (up to 7 days). Deleting session rows with SQL, deleting a user so their sessions cascade, or updating user rows directly doesn't sign anyone out or refresh the cached user.
- **Rule:** revoke sessions and delete or deactivate users only through Better Auth (`auth.api.revokeSessions`/`revokeOtherSessions`, the internal adapter's `deleteUserSessions`/`deleteUser`) or `revokeUserSessions`, never raw SQL. Domain code that disables an account must also revoke the user's sessions. For emergencies, see [docs/incident-response.md](../incident-response.md).
- Better Auth's per-user `active-sessions-<user id>` lists are rewritten without a transaction, so two concurrent sign-ins can each drop the other's token, and LRU can evict a list while its sessions stay cached. `deleteUserSessions` finds cached sessions only through that list, so `revokeUserSessions` also reads the user's tokens from Postgres and deletes each cached entry itself.
- Membership and tenant checks always read Postgres (`getViewer`), so removing a member takes effect on their next request.
