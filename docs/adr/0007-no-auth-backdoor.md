# ADR 0007: No auth backdoor, even for dev and tests

- Status: accepted
- Date: 2026-10-22

The app has no test-only sign-in route, bypass flag or seeded session. Development, agents and e2e tests sign in through the real flow: a harness requests the email, reads it from Mailpit's API, and verifies the token the way the confirm page does ([docs/dev-sign-in.md](../dev-sign-in.md)).

## Why

A backdoor is one misconfiguration away from production, and tests that skip the real flow don't cover it. For the same reason, Better Auth's origin and CSRF checks are pinned on (`disableOriginCheck: false`, `disableCSRFCheck: false`): Better Auth turns its origin check off when `NODE_ENV=test`, and tests must run what production runs.

## Consequences

- Dev and e2e need Mailpit and Redis running.
- Sign-in is rate limited per client IP, so e2e workers and tests send unique `x-forwarded-for` addresses and unique email addresses. The local Compose stack and e2e trust a client-set `x-forwarded-for` to allow that, which is safe only because nothing beyond loopback reaches them ([docs/auth.md](../auth.md), "Client IP").
- The harness refuses non-local hosts, so it can't be pointed at a real deployment.
