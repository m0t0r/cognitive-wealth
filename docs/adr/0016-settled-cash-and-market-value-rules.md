# ADR 0016: How Settled cash and Market value are worked out

- Status: accepted
- Date: 2026-10-24

The custodian works out two numbers from its Ledger and prices (#84): Settled cash, the cash an Account can withdraw, and Market value, what its Positions are worth. Settled cash follows the shape two large firms use for withdrawable cash, Fidelity's "Available to withdraw" and Interactive Brokers' "Settled Cash": money going out counts from its Trade date, money coming in from its Settlement date. Statements print each Market value line to the cent. The research for #84 ([note](../research/settled-cash-and-market-value.md)) leaves three cases to decide. The first two are inferences, since no firm states the rule. For the third, four firms' statements agree. This records what the custodian does in each.

1. **A Reversal takes its direction from the row it undoes, not from its own sign.** It shares that row's Trade and Settlement dates, so the pair counts from the same day and cancels on every As-of date.
2. **A day with no price uses the latest price on or before it.** A Saturday uses Friday's close, and a date after the last stored price uses that last price. There is no limit on how old the price may be.
3. **A Security with no price on or before the As-of date is left out of the total**, not valued at $0.00. The result names the Securities it left out.

## Why

- **Reversal direction.** Counted by its own sign, a Reversal of an unsettled sale is money out, so it counts at once, while the sale it undoes doesn't count until it settles. If Dana's Wednesday sale of $1,520.00 were reversed that same Wednesday, Settled cash on Wednesday would be $1,520.00 lower than if the sale had never happened. By Thursday, when the sale would have settled, the two agree again. The note finds no custodian document saying how a cancelled row affects withdrawable cash. Fidelity's and IBKR's withdrawable-cash formulas never include an unsettled sale, though, so cancelling one should leave nothing to take back. Taking the direction from the original gives that result. This is an inference, with medium confidence.
- **Carrying the last price.** Fidelity's live-balances help page (about the balances screen, not statements) uses the most recent closing value "if the current market price is unavailable or the market is closed". SEC Rule 15g-6, which covers penny stocks only, dates a statement's information "as of the last trading day of the period". Neither says in terms what a statement dated on a weekend shows, and no source sets a limit on how stale a price may be. The inference is medium confidence.
- **Leaving unpriced Securities out.** Vanguard, Fidelity and Schwab show no value for an unpriced holding ("—", "Unavailable" or "N/A") and say the total leaves it out. Fidelity's sample statement says the total "Excludes unpriced securities". UBS's page states only the exclusion. Most of these sources are old: Schwab's is a hypothetical 2005 sample, Fidelity's a 2015 sample and Vanguard's a guide for statements before June 2016. The note rates the practice medium-high confidence. Showing $0.00 would say the Security is worthless, and leaving it out without saying so would hide that the total is incomplete. So the result carries the excluded identifiers beside the total.

The total is rounded once, from the exact sum of every `Shares × Price` ([ADR 0013](0013-money-shares-prices-and-rates-are-separate-types.md)). No source says whether a total must equal the sum of its rounded lines. This choice keeps the total exact, and it can differ from the lines by a cent or so.

## Considered options

- **Pair each Reversal with its original and drop both.** It gives the same numbers on every As-of date, but needs a second pass over the rows. Taking the direction from the original row is one join in the same query.
- **Value a day with no price at nothing, or refuse to answer.** Every weekend would then make an Account look empty, or the question unanswerable, which no custodian does.
- **Value an unpriced Security at $0.00.** It's simpler, but it reports a loss that hasn't happened. None of the four firms in the note does.

## Consequences

- A Reversal posted after its original settled is counted only in answers given on or after its Posting date (`known_on`), like any Correction. Asked earlier, the original still stands.
- The direction comes from the row a Reversal names, one level deep, so a Reversal can't undo a Reversal: it would take its direction from the wrong row. A wrong Reversal is fixed with a new Transaction instead. The database refuses such a row with a trigger, since a check constraint can't see the row being undone, and the ledger fixture refuses it too.
- Prices have no Posting date yet, so a price corrected later changes past Market values. A limit on carried prices, and corrected prices, are left for later.
- The Custodian feed (#37) prints each Position's line value, rounded to the cent, beside a total rounded once. A reader checking the total by hand can be a cent or so out.
