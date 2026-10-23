# ADR 0015: Positions are counted by trade date

- Status: accepted
- Date: 2026-10-23

Every trade has two dates: the Trade date, when it was agreed, and the Settlement date, when cash and shares actually change hands, one business day later for most US trades. A Position has to be counted from one of them, and the custodian's ledger (#35) is the first code that has to choose.

Positions are counted by **trade date**: a buy counts from the day it was agreed. Settlement is tracked as a separate number, Settled cash, which is what an Account can actually withdraw. The simulated Custodian reports its own Positions on the same trade-date basis, and Reconciliation compares our Positions with the Custodian's only on the basis the Custodian's report states.

## Why

- **It's what the Account owns.** From the Trade date the shares are the owner's and the cash is owed. Portfolio accounting and performance work on that view, and Market value and returns follow the owner's decision, not the plumbing a day later.
- **Performance needs one consistent rule.** The GIPS standards ask for trade-date accounting. Their guidance accepts a trade recognized consistently anywhere from the trade date to three days after it, so settlement date would also pass ([GIPS Q&A, 2012 handbook, archived](https://www.gipsstandards.org/qadatabase/4948/)). Trade date is the plain reading, and the same rule then holds for every Transaction.
- **Settlement still matters, so it gets its own number.** Withdrawals, fees and RMDs care about cash that has arrived. Keeping Settled cash beside the Positions answers that without bending the Positions.

## Considered options

- **Settlement date.** Positions change only when a trade settles. It matches cash in the bank, but the Account looks as if it doesn't own shares it has already bought, and every trade would shift Market value by a day.
- **Leave it to each report.** Rebuild Positions on whichever basis a screen needs. It looks flexible, but two numbers called "Position" would disagree for a day after every trade, and Reconciliation couldn't tell a real Break from a date mismatch.

## Consequences

- Every Transaction keeps both dates, so a settlement-date view can still be derived later if a report needs one.
- A real Custodian's position file may be on a settlement basis. Reconciliation must read the basis from the feed and compare like with like, or it raises a Break on the day after every trade.
- Withdrawable cash is Settled cash, never trade-date cash.
