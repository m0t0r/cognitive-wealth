# Cognitive Wealth

A multi-tenant web platform: a Next.js app over Postgres and Redis, with passwordless, invite-only sign-in and organizations with roles. It's a pnpm and Turborepo monorepo on Node 24, TypeScript 7, Next.js 16 and React 19.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/system-context.dark.svg">
  <img alt="A person's browser talks HTTPS to the web app, a single Next.js process that uses Postgres as the source of truth, Redis for the session cache and rate limits, and an SMTP or Resend mailer. A migrate job applies migrations, and an operator creates organizations from the CLI." src="docs/diagrams/system-context.light.svg">
</picture>

## Where to read

| To understand                                                                                               | Read                                                   |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| The whole platform on one page: packages, request flow, data model, environments, decisions, open questions | [docs/architecture.md](docs/architecture.md)           |
| Why it's built this way                                                                                     | [docs/adr/](docs/adr/)                                 |
| How sign-in, sessions and tenancy work today                                                                | [docs/auth.md](docs/auth.md)                           |
| Running it locally and signing in                                                                           | [docs/dev-sign-in.md](docs/dev-sign-in.md)             |
| Signing people out in an emergency                                                                          | [docs/incident-response.md](docs/incident-response.md) |
| Commands, conventions, testing layers and the agent workflow                                                | [CLAUDE.md](CLAUDE.md)                                 |

## Quick start

Needs Node 24, pnpm 12 and Docker.

```sh
pnpm install
docker compose -f compose.yaml -f compose.dev.yaml up -d db migrate redis mailpit
cp apps/web/.env.example apps/web/.env.local
pnpm db:seed
pnpm dev     # https://cognitive-wealth.localhost
```

Create the Compose secrets first, then sign in as a seeded user: both steps are in [docs/dev-sign-in.md](docs/dev-sign-in.md).
