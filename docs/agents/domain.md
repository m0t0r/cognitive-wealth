# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root, or
- **`GLOSSARY-MAP.md`** at the repo root if it exists: it points at one `GLOSSARY.md` per context. Read each one relevant to the topic.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in. In multi-context repos, also check `src/<context>/docs/adr/` for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo (most repos):

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

Multi-context repo (presence of `GLOSSARY-MAP.md` at the root):

```
/
├── GLOSSARY-MAP.md
├── docs/adr/                          ← system-wide decisions
└── src/
    ├── ordering/
    │   ├── GLOSSARY.md
    │   └── docs/adr/                  ← context-specific decisions
    └── billing/
        ├── GLOSSARY.md
        └── docs/adr/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_

## Finance rules come from research, not the maintainer

When a decision depends on how finance works in the real world (how a Reversal counts toward Settled cash, what Market value uses on a day with no price, how a total rounds), don't put it to the maintainer as a preference: they aren't a finance expert. Research it against primary sources (regulations, custodian documents) with `/mattpocock-skills:research`, save it in `docs/research/`, have a reviewer subagent fact-check it, and bring the maintainer the cited answer. This holds in every skill that asks questions (`triage`, `grilling`, `domain-modeling`). Ask the maintainer only about real product or engineering trade-offs, and say which kind each question is.

## A new ADR is listed in two places

An ADR in `docs/adr/` adds, in the same commit, its row to the Decisions table in `docs/architecture.md` and its node (with an edge from each ADR it builds on) to `docs/diagrams/decisions.mmd`, re-rendered with `pnpm docs:diagrams`, and updates the diagram's `alt` text there. A consequence that promises work in another issue matches what that issue's spec asks for.

## Worked numbers in ADRs and issue briefs

When an ADR gives a worked example, name the rule that produces each rounded figure (which value rounds, to how many places, in which direction), and have the reviewer recompute it. An issue brief that copies a figure from an ADR cites that rule too, so its acceptance criterion can't be met by guessing one.
