# web

Cognitive Wealth's web app: a [Next.js](https://nextjs.org) 16 App Router app on React 19. It signs Advisors in by email link through Better Auth ([`@repo/auth`](../../packages/auth)), scopes every query to the viewer's Firm (its organization) ([`@repo/db`](../../packages/db)), and renders the UI from [`@repo/design-system`](../../packages/design-system). What the product is and the phase plan are in [docs/product.md](../../docs/product.md); how the pieces fit is in [docs/architecture.md](../../docs/architecture.md).

## Prerequisites

- Node 24+ and pnpm 12, with `pnpm install` run at the repo root.
- Postgres, Redis and Mailpit from Compose, and `.env.local`:

  ```sh
  docker compose -f compose.yaml -f compose.dev.yaml up -d db migrate redis mailpit
  cp apps/web/.env.example apps/web/.env.local
  pnpm db:seed
  ```

  `.secrets/` must exist first; `compose.yaml`'s header has the loop that creates it.

## Running

From the repo root:

| Command                                        | What it does                                                                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter web dev`                        | `next dev` at `https://cognitive-wealth.localhost` (portless)                                                        |
| `pnpm dev:sign-in owner@cognitive-wealth.test` | signs a seeded user in through the real email flow, for `agent-browser --state` ([guide](../../docs/dev-sign-in.md)) |
| `pnpm --filter web test`                       | unit (`*.test.ts`) and UI (`*.test.tsx`) tests                                                                       |
| `pnpm --filter web test:integration`           | integration tests against Postgres (`*.integration.test.ts`)                                                         |
| `pnpm --filter web check-types`                | `next typegen`, then `tsc --noEmit`                                                                                  |
| `pnpm e2e`                                     | builds the app and runs the Playwright suite in `apps/web-e2e` (needs Docker)                                        |

The root `pnpm dev` starts it with the other apps. A git worktree is served at `https://<branch>.cognitive-wealth.localhost`, and `PORTLESS=0` falls back to `http://localhost:3000`. Mailpit's inbox is at `http://127.0.0.1:8025`.

## Layout

```
app/(auth)/          sign-in, sign-in/confirm, invite/[publicId], welcome, no-workspace
app/(app)/           the signed-in app: home and settings (members)
app/api/auth/        the Better Auth handler, behind the browser allowlist (ADR 0004)
app/api/health/      readiness probe: the app is up and the database answers
app/design-system/   a preview of @repo/design-system's foundations and components
components/          app components (app shell, auth forms, members)
lib/auth/            @repo/auth adapted to Next: getViewer, requireTenant, after() for emails
proxy.ts             the optimistic signed-in cookie check
Dockerfile           the production image (Compose builds it)
```

## Conventions

The auth, tenancy, testing and accessibility rules are in the root [CLAUDE.md](../../CLAUDE.md) and [docs/auth.md](../../docs/auth.md). Next.js 16 changes APIs from earlier versions; [AGENTS.md](AGENTS.md) points to the docs bundled with the installed version.
