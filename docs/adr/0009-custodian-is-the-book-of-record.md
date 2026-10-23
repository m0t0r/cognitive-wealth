# ADR 0009: The custodian is the book of record, simulated as a separate service

- Status: accepted
- Date: 2026-10-23

A Firm doesn't hold its clients' money: a Custodian does, and the Custodian's records of Accounts, holdings and transactions win any disagreement. Cognitive Wealth therefore never creates holdings or transactions itself. It ingests them from the Custodian, rebuilds positions from the transactions, and reconciles them against the Custodian's own position report every business day. Cognitive Wealth is the book of record only for what a Firm owns: the relationship, fees, plans and recommendations.

There is no real custodian, so a simulated one runs as its own service, with its own database and a published contract (daily files and an API). Cognitive Wealth reaches it only through that contract, never through shared code or a shared database, exactly as it would reach a real custodian.

## Considered options

- **Cognitive Wealth owns the holdings.** Seeds would write positions and transactions straight into our database. Simpler, but it skips the work that defines a wealth platform: ingesting someone else's data, trade versus settlement dates, corrections to history, and breaks between what we computed and what the custodian says.

## Consequences

- Every holding and transaction carries the dates it happened, settled and reached us, so a past report or fee can be reproduced from the data it was computed on.
- A difference between our positions and the custodian's is a recorded break to resolve, never something to overwrite silently.
- The simulator is a second deployable with its own data, so it brings a second service into tracing, deployment and local development.
