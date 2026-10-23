# ADR 0008: Production mode everywhere; environments differ by explicit settings

- Status: accepted
- Date: 2026-10-22

`NODE_ENV` is the build mode, and every deployed image, the Compose stack and e2e run with `production`. `NODE_ENV` only drives fail-closed guards: a production build refuses to start without explicit configuration, and never gets a relaxed check. `apps/web/instrumentation.ts` runs those checks (`authOptionsFromEnv`, `mailerFromEnv`) when the server starts, so a misconfigured deployment fails to boot instead of failing every sign-in.

Differences between environments are explicit capability settings (`EMAIL_TRANSPORT`, `BETTER_AUTH_URL`, `AUTH_TRUSTED_IP_HEADER`, …), never branches on an environment name.

## Consequences

- e2e and the Compose stack exercise the same guards as a real deployment, so each has to set every required variable.
- When the first multi-environment deployment lands, add `APP_ENV` as a label only: an enum, required with no default in production, used for error-tracking and log tags. It must never enable a dev tool or weaken a security check.
