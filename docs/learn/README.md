# Learn

Primers on the wealth-management domain, written for an engineer who is new to finance and starting from zero. Each one explains a few ideas in plain words, with worked examples in real numbers, and lands before the code that depends on it. Each climbs in levels: the basics first, then how it works, then the real world, so you can stop at any level and come back later.

Read them in this order:

1. [The ledger, Positions and the three dates](01-ledger-positions-and-dates.md): what shares, funds and Accounts are; what a Custodian is and why one has to exist; Transactions and the Ledger; why Positions are worked out instead of stored; Trade date, Settlement date and As-of date; fixing mistakes; Market value and cash; and what real Custodians add.
2. [Account types: taxable, IRAs, Roth and the rest](02-account-types.md): why a Household has several Accounts; the three tax buckets; Taxable accounts, Traditional and Roth IRAs, 401(k)s, Custodial accounts and 529 plans; the rules that come with a tax break (limits, early withdrawals, RMDs); who can own what; Rollovers and Roth conversions; why inflation doesn't favour a Roth IRA; and what the code does with Registration types.
3. [The Custodian feed and Ingestion](03-custodian-feed-and-ingestion.md): how a Custodian sends each day's records as files; what a Delivery holds and why each file is needed; the Manifest and Content hashes, and why an incomplete Delivery is never loaded; idempotent Ingestion, and why every row is checked; late files, Redeliveries, Restatements and Breaks; and what the code builds in which slice.
4. [Prices, dividends and the cash sweep](04-prices-dividends-and-the-cash-sweep.md): what a price and a Return are; how a fund's price is set; Factor returns and Factor exposures, and how they make an invented fund's price; Treasury yields, and why bond prices fall when they rise; a dividend's four dates, why the price drops on the Ex-dividend date and which row the Ledger gets; how the Cash sweep's interest builds up daily and is paid monthly; why the Factor file is pinned; how real sweeps set their rate; and what #45, #46 and #47 build.

Every domain term a primer uses is defined in [GLOSSARY.md](../../GLOSSARY.md). The decisions behind the system, and their reasons, are the ADRs in [docs/adr/](../adr/). Where a primer and an ADR disagree, the ADR wins.

## Writing a primer

The reader is a senior TypeScript engineer who is learning finance from scratch: no background in investing, custody, accounting or billing. Assume nothing. A primer that is too simple costs the reader a few minutes. A primer that skips a step loses them. [The ledger primer](01-ledger-positions-and-dates.md) is the model; follow its shape.

**Climb in three levels.** Label each Part with its level, and let each level use only what the levels before it explained. Add a "How to read this" table at the top, and say that it's fine to stop after any level.

1. **The basics:** everyday comparisons and small, round numbers.
2. **How it works:** one running example, followed step by step.
3. **The real world:** what the example left out, and what it means for the code.

**One question per section.**

- Make the heading a question the reader would ask ("What is a Custodian?").
- Start with a bolded **Short answer:** of one sentence.
- Then explain with an everyday comparison, then show it with numbers.
- For every new concept, answer both "what is it?" and "why does it exist?"

**Worked numbers.**

- Use one running example across the whole primer, followed one step (or one day) at a time: what happened, the rows written, and the totals after.
- Every number must add up. Check them with a script using exact decimals, and show the check in the PR body.
- Name the rounding rule behind every rounded number (shares and Money round differently; ADR 0013 names the rules), so nobody implementing it has to guess. The reviewer recomputes each one.

**Words.**

- Plain words and short sentences, addressed to "you". No idioms.
- Explain a word the first time it's used. When a later Part explains it, say so in brackets ("Part 5 explains it").
- Name each thing one way throughout ("row", never "row" and "line").
- Capitalized terms are Glossary terms. Add any new one to `GLOSSARY.md` in the same PR.
- Refer to people in the examples by name, not by pronoun.

**Facts.**

- Cite a primary source for every regulatory fact, such as the eCFR rule or an SEC release.
- Label a deliberate simplification as one ("the example pays interest on Friday to keep the week short").
- When the primer sets a rule for the simulated world (when a Transaction is written, which date decides something, how a rate is set), cite how real Custodians do it, or label it as a simplification and name the slice that decides it. A rule the primer makes up is neither a fact nor an example's shortcut, so it needs one of the two.
- Have a reviewer check the primer for factual errors and for places a beginner would get lost (see **Independent review** below).

**Pictures.** Add a diagram where it explains faster than text: who does what, a timeline, or what is stored versus worked out. Write it in `docs/diagrams/` and render it with `pnpm docs:diagrams`. Look at it with `pnpm docs:diagrams:preview <name>`, which writes PNGs to `.dev/diagrams/`.

**Independent review.** The reader learns the domain from these primers and can't check them, so a primer must be correct before it's opened as a PR. Every new primer, and every section added to one later, gets a review by an independent reviewer: a subagent with a fresh context, given the changed text, the cited sources and these rules, but not the author's conclusions. The owner is never the reviewer. The reviewer:

1. Opens every cited source again (following [web research](../agents/web-research.md) when a page is blocked) and checks each quote word for word, its attribution, and that the text claims no more than the source says.
2. Searches for evidence against the primer's main claims, not only for it, and checks every rule the primer sets for the simulated world against how real Custodians do it.
3. Recomputes every worked number, and checks dates, names and Glossary terms against the other primers.
4. Checks the text against the rules on this page, as a reader starting from zero.

The author fixes every finding, or answers it with evidence, before the PR is opened. Then the PR body says what the reviewer verified and what it changed.

**Keep the slice's issue in step.** A primer's "what it means for the code" section often promises more than, or something different from, the issue that builds it, when that issue was triaged first. In the same PR, edit the issue's Agent Brief to match the primer (`gh issue edit <n> --body-file …`), or change the primer to match the issue, so whoever picks up the slice doesn't have to reconcile them.

**End with practice.** Finish with a numbered recap and "Check yourself" questions, each answer in a `<details>` block so the reader tries first.
