# ADR 0012: Domain code lives in one package per area

- Status: accepted
- Date: 2026-10-23

Domain logic lives in workspace packages, one per area, created only when that area's phase starts: `@repo/money` for the shared money types, then `@repo/households`, `@repo/portfolio`, `@repo/billing`, `@repo/planning` and `@repo/ai`. Like `@repo/auth`, each one is framework-agnostic and imported as source: it takes plain inputs and returns DTOs or typed results, and `apps/web` only adapts it to pages and actions. Tables stay in `@repo/db`.

Dependencies point one way, from the areas that use numbers to the areas that produce them: billing and planning depend on portfolio, never the reverse, and `@repo/ai` depends on all of them to reach their calculations as tools.

## Why

The calculations behind Computed facts ([ADR 0010](0010-cognitive-ai-states-only-computed-facts.md)) have to be pure, deterministic and unit-tested without Next.js. A package per area keeps each one small and lets its imports show its dependencies. One `packages/domain` would let billing reach into planning without anyone noticing.

## Consequences

- A cross-area feature, like a planning Scenario that needs fee projections, goes through the other package's public exports, not its internals.
