# ADR 0013: Money, shares, prices and rates are separate types

- Status: accepted
- Date: 2026-10-23

Four kinds of number move through Cognitive Wealth, and each has its own type and precision:

- **Money** is US dollars, recorded in whole cents. Every amount that is stored, sent to the Custodian or shown as a balance or fee is Money.
- **Shares** are a count of a security, fractional to six decimal places.
- **Price** is dollars per share, to as many decimal places as the source quotes (fund prices often carry four).
- **Rate** is a fraction such as a fee rate, tax rate or return, kept at full precision.

Arithmetic never uses binary floating point: TypeScript uses a decimal library, Python uses `Decimal`, and Postgres uses `numeric` with a declared scale. Intermediate results keep full precision, and a result is rounded once, when it becomes recorded Money, by a rounding rule named for the job: half-to-even for aggregates, up for an RMD, largest remainder when a fee is split across Accounts. Shares bought with cash are rounded down (toward zero) to six places, so recorded shares never cost more than the cash that bought them; brokers that state a direction all round down ([research](../research/fractional-share-rounding.md)).

## Why

Integer cents are the obvious choice, and right for Money. But shares, prices and rates aren't money, and forcing them into cents is wrong by amounts that matter:

- A $37.50 dividend reinvested at $84.2731 buys 0.444981 shares (0.4449818… rounded down), which cents can't hold.
- A fund priced at $23.4567, rounded to $23.46, values 1,000 shares $3.30 too high, so positions would disagree with the Custodian's every day.
- A 0.75% annual fee on $1M accrues $20.547945 a day. Rounding each day to cents bills $1,890.60 for a 92-day quarter instead of $1,890.41.

Separate types also stop shares being added to dollars by mistake.

## Consequences

- Postgres's `round(numeric)` rounds ties away from zero, which differs from half-to-even, so rounding happens in code and the database only stores results.
- Values cross the boundary to the Custodian as decimal strings, never as JSON numbers.
