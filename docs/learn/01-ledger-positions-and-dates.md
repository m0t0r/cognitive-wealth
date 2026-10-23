# The ledger, Positions and the three dates

How a Custodian keeps the record of an Account, and what Cognitive Wealth does with it. Read this before the custodian's ledger is built (#35). Terms in capitals are defined in [GLOSSARY.md](../../GLOSSARY.md).

Out of scope here: Tax lots, Cost basis and Reconciliation (phase 2), the Close, and the Custodian feed. Each has its own primer.

## 1. The Custodian holds the money

A Firm gives advice. It doesn't hold its clients' money. The money sits at a Custodian: a regulated institution, such as a bank or a broker-dealer, that keeps the Account, carries out trades, collects dividends and sends statements.

This isn't only a habit. The SEC's custody rule says an adviser that has custody of client funds or securities must keep them with a qualified custodian ([17 CFR 275.206(4)-2](<https://www.ecfr.gov/current/title-17/chapter-II/part-275/section-275.206(4)-2>)).

So the Custodian is the **Book of record** for holdings and Transactions: when Cognitive Wealth and the Custodian disagree about how many shares an Account holds, the Custodian is right. Cognitive Wealth never invents a holding. It copies the Custodian's Transactions, rebuilds the Positions from them, and checks its answer against the Custodian's own report ([ADR 0009](../adr/0009-custodian-is-the-book-of-record.md)).

There is no real Custodian here, so a simulated one runs as its own Python service. It plays the Custodian's part, and everything below describes its records.

## 2. Accounts and Transactions

An **Account** is one custodial account, identified by the Custodian's account number, such as an individual brokerage account or a Roth IRA. It holds two kinds of thing: cash, and shares of Securities (funds and stocks).

A **Transaction** is one dated movement the Custodian records in an Account. Every Transaction changes cash, shares, or both:

| Kind         | What happens                                            | Cash               | Shares                 |
| ------------ | ------------------------------------------------------- | ------------------ | ---------------------- |
| Contribution | The owner puts money in, say by bank transfer           | up                 | –                      |
| Withdrawal   | The owner takes money out                               | down               | –                      |
| Buy          | The Account buys shares of a Security                   | down by the cost   | up                     |
| Sell         | The Account sells shares                                | up by the proceeds | down                   |
| Dividend     | A fund or company pays its holders part of its earnings | up                 | –                      |
| Interest     | The cash itself earns interest                          | up                 | –                      |
| Fee          | Money taken out to pay a bill, such as an Advisory fee  | down               | –                      |
| Transfer     | Cash or shares move between Accounts                    | up or down         | up or down, no trading |

A buy and a sell are the only kinds called a _trade_. A transfer moves things without buying or selling them: 100 shares that arrive from another firm raise the shares by 100 and leave cash alone.

A buy has two parts, called _legs_: cash goes down and shares go up. Buying 40 shares at $150.25 is one Transaction with a cash leg of −$6,010.00 and a share leg of +40. Each unit balances on its own: dollars add to dollars and shares to shares, never one to the other ([ADR 0013](../adr/0013-money-shares-prices-and-rates-are-separate-types.md) makes them separate types for that reason).

## 3. Positions are rebuilt from the ledger

The Custodian keeps every Transaction of an Account, in order, in its **Ledger**. The Ledger is append-only: rows are added and never changed or deleted.

A **Position** is how much of one Security an Account holds on a given date. It isn't stored as a balance that each Transaction updates. It's computed by adding up the Account's Transactions to that date.

Why not keep a balance and update it? Because a balance only knows today. With a Ledger:

- **Any date can be answered.** The Position on 3 March is the sum of the Transactions up to 3 March.
- **Every number has a reason.** If cash is $6,476.65, the rows that add up to it are right there.
- **Mistakes can be fixed without losing history.** See section 5.
- **Two systems can compare notes.** Cognitive Wealth rebuilds the Positions from the Custodian's Transactions and compares them with the Custodian's own Positions. If they agree, nothing was lost on the way.

In code, this is a fold: `positions = transactions.reduce(apply, empty)`. An engineer who has used event sourcing or Redux has seen the idea: the Transactions are the events and the Positions are the state.

### A week in one Account

Dana opens an individual Account and the Advisor invests it in two invented exchange-traded funds: the Larkspur Stock Fund and the Larkspur Bond Fund. Both trade on an exchange like stocks. Here is the Account's Ledger. Cash and share columns show the change each row makes.

| #   | Trade date | Settlement date | Kind         | Security   | Shares | Price   | Cash       |
| --- | ---------- | --------------- | ------------ | ---------- | ------ | ------- | ---------- |
| 1   | Thu 26 Feb | Thu 26 Feb      | Contribution |            |        |         | +5,000.00  |
| 2   | Thu 26 Feb | Fri 27 Feb      | Buy          | Bond Fund  | +300   | $10.00  | −3,000.00  |
| 3   | Mon 2 Mar  | Mon 2 Mar       | Contribution |            |        |         | +10,000.00 |
| 4   | Mon 2 Mar  | Tue 3 Mar       | Buy          | Stock Fund | +40    | $150.25 | −6,010.00  |
| 5   | Tue 3 Mar  | Tue 3 Mar       | Dividend     | Bond Fund  |        |         | +9.00      |
| 6   | Wed 4 Mar  | Thu 5 Mar       | Sell         | Stock Fund | −10    | $152.00 | +1,520.00  |
| 7   | Wed 4 Mar  | Wed 4 Mar       | Fee          |            |        |         | −45.00     |
| 8   | Thu 5 Mar  | Thu 5 Mar       | Withdrawal   |            |        |         | −1,000.00  |

All dates are in 2026. The dividend in row 5 is $0.03 a share on 300 shares. The fee in row 7 is the quarter's Advisory fee. How dividends are declared and paid is in a later primer; here it's only cash arriving.

Adding the rows up to the end of each day gives the Positions:

| End of day | Rows added | Cash     | Stock Fund | Bond Fund |
| ---------- | ---------- | -------- | ---------- | --------- |
| Fri 27 Feb | 1–2        | 2,000.00 | 0          | 300       |
| Mon 2 Mar  | 3–4        | 5,990.00 | 40         | 300       |
| Tue 3 Mar  | 5          | 5,999.00 | 40         | 300       |
| Wed 4 Mar  | 6–7        | 7,474.00 | 30         | 300       |
| Thu 5 Mar  | 8          | 6,474.00 | 30         | 300       |

Check Monday: $2,000.00 + $10,000.00 − $6,010.00 = $5,990.00. Check Wednesday: $5,999.00 + $1,520.00 − $45.00 = $7,474.00.

Nothing in the second table is stored. Delete it, and the first table rebuilds it.

## 4. The three dates

Every Transaction carries more than one date, and each answers a different question.

### Trade date: when it was agreed

The **Trade date** is the day the Transaction happened: the day the buy order was filled, or the day the dividend was paid. On Monday 2 March, Dana's Account agreed to buy 40 shares at $150.25. From that moment the shares are Dana's and the $6,010.00 is owed, so the Positions above count both on Monday. Positions counted this way are called trade-date Positions, and they're what Cognitive Wealth shows.

### Settlement date: when it became final

The **Settlement date** is the day the cash and the shares actually change hands. For most US securities trades it's one business day after the Trade date, written **T+1**. A business day is a weekday the markets are open, so a Friday trade settles on Monday.

T+1 is a rule, not a convention. SEC Rule 15c6-1 says a broker-dealer can't make a contract to buy or sell a security that settles "later than the first business day after the date of the contract", unless the parties expressly agree otherwise ([17 CFR 240.15c6-1](https://www.ecfr.gov/current/title-17/chapter-II/part-240/section-240.15c6-1)). The SEC shortened the cycle from two business days to one, with compliance from 28 May 2024 ([SEC press release 2023-29](https://www.sec.gov/newsroom/press-releases/2023-29)). Cash movements such as contributions, fees and dividends aren't trades, so here they settle on the day they happen.

Settlement matters for one number in particular: **Settled cash**, the cash that has actually arrived. Dana can only withdraw settled cash. Between the Trade date and the Settlement date, the cash from a sale is Dana's but not yet in the Account.

Here is the same week, with settled cash next to cash. A row counts toward settled cash on its Settlement date:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../diagrams/ledger-week.dark.svg">
  <img alt="A timeline of Monday 2 to Friday 6 March 2026. The buy in row 4 is agreed on Monday with $6,010.00 owed, and settles on Tuesday when the cash is paid. The sell in row 6 is agreed on Wednesday with $1,520.00 in transit, and settles on Thursday when the cash arrives. The dividend in rows 5, 9 and 10 shows $9.00 in the Ledger from Tuesday until the Correction to $10.50 is posted on Friday." src="../diagrams/ledger-week.light.svg">
</picture>

| End of day | Cash     | Settled cash | Why they differ                                     |
| ---------- | -------- | ------------ | --------------------------------------------------- |
| Fri 27 Feb | 2,000.00 | 2,000.00     | Row 2's buy settled today                           |
| Mon 2 Mar  | 5,990.00 | 12,000.00    | Row 4's $6,010.00 for the buy is owed, not yet paid |
| Tue 3 Mar  | 5,999.00 | 5,999.00     | Row 4 settled: 12,000.00 − 6,010.00 + 9.00          |
| Wed 4 Mar  | 7,474.00 | 5,954.00     | Row 6's $1,520.00 from the sale hasn't arrived      |
| Thu 5 Mar  | 6,474.00 | 6,474.00     | Row 6 settled: 5,954.00 + 1,520.00 − 1,000.00       |

On Wednesday, Dana could withdraw at most $5,954.00, even though the Account's cash is $7,474.00. By Thursday the two agree again.

### As-of date: which day a figure describes

The **As-of date** is the business day a number describes. "Cash as of 3 March is $5,999.00" is a statement about the end of 3 March, computed from every Transaction with a Trade date up to 3 March.

The As-of date isn't the day the number was computed. A report as of 3 March can be produced on 4 March or a year later. With an unchanging Ledger it gives the same answer every time, which is the point: a statement or a bill can be reproduced exactly from the data it was built on.

But the Ledger does grow, sometimes with rows about the past. That's what the next section is about, and it's why the Custodian also records a fourth date for every row: the **Posting date**, the day the row was written to the Ledger. For rows 1 to 8 it's the same as the Trade date.

## 5. Fixing a mistake without editing

On Friday 6 March the Custodian finds that row 5 was wrong: the Bond Fund paid $0.035 a share, not $0.03, so Dana should have received $10.50, not $9.00.

The Ledger is append-only, so row 5 is never edited. Instead the Custodian appends rows 9 and 10, which together make a **Correction**. Row 11 is posted the same day:

| #   | Trade date | Posting date | Kind              | Security  | Cash   | Notes                |
| --- | ---------- | ------------ | ----------------- | --------- | ------ | -------------------- |
| 9   | Tue 3 Mar  | Fri 6 Mar    | Reversal of row 5 | Bond Fund | −9.00  | Exactly undoes row 5 |
| 10  | Tue 3 Mar  | Fri 6 Mar    | Dividend          | Bond Fund | +10.50 | The right amount     |
| 11  | Fri 6 Mar  | Fri 6 Mar    | Interest          |           | +1.15  | Not part of the fix  |

Row 9 is a **Reversal**: a copy of row 5 with every amount negated, pointing back at row 5. Row 10 is the right dividend. Both keep the original Trade date, 3 March, because that's when the dividend really happened. Their Posting date, 6 March, says when the Custodian learned it. Row 11 is unrelated: interest the cash has earned, paid the same day (section 6).

Rows 5, 9 and 10 together add $9.00 − $9.00 + $10.50 = $10.50, the right dividend. Cash at the end of Friday is $6,474.00 − $9.00 + $10.50 + $1.15 = $6,476.65.

Now the As-of date and the Posting date work together. Ask "what was cash as of 3 March?":

| Asked on  | Rows counted: Trade date by 3 Mar, posted by the day asked | Cash as of Tue 3 Mar               |
| --------- | ---------------------------------------------------------- | ---------------------------------- |
| Wed 4 Mar | 1–5                                                        | 5,999.00                           |
| Mon 9 Mar | 1–5, 9, 10                                                 | 5,999.00 − 9.00 + 10.50 = 6,000.50 |

Both answers are right for what was known at the time. The statement sent on 4 March showed $5,999.00 and can still be reproduced, by counting only the rows posted by 4 March. The answer on 9 March uses the corrected rows. Had row 5 been edited in place, the old statement couldn't be explained any more.

This is why an append-only Ledger never deletes or edits: a fix is a new fact about the past, recorded on the day it was learned.

## 6. Market value and cash

### Market value

The Positions say how many shares Dana holds. What they're worth is the **Market value**: shares × the Security's price on the As-of date.

At the end of Friday 6 March the Stock Fund closed at $153.40 and the Bond Fund at $10.02:

| Position   | Shares   | Price on 6 Mar | Market value |
| ---------- | -------- | -------------- | ------------ |
| Stock Fund | 30       | $153.40        | 4,602.00     |
| Bond Fund  | 300      | $10.02         | 3,006.00     |
| Cash sweep | 6,476.65 | $1.00          | 6,476.65     |
| Total      |          |                | 14,084.65    |

The price changes every day; the shares only change with a Transaction. So Market value moves daily even in a week with no trades, and it's always derived, never stored as a fact of its own.

As a check, the total should equal the money put in, minus the money taken out, plus income and price changes:

- Money in and out: $15,000.00 contributed − $1,000.00 withdrawn − $45.00 fee = $13,955.00
- Income: $10.50 dividend + $1.15 interest = $11.65
- Stock Fund: bought 40 for $6,010.00, sold 10 for $1,520.00, 30 left worth $4,602.00: a gain of $4,602.00 + $1,520.00 − $6,010.00 = $112.00
- Bond Fund: bought 300 for $3,000.00, now worth $3,006.00: a gain of $6.00

$13,955.00 + $11.65 + $112.00 + $6.00 = $14,084.65. It matches.

### Cash is a Position too

Cash in a brokerage Account doesn't sit idle. The Custodian moves it every night into a **Cash sweep**: a bank deposit or a money market fund that pays interest. Row 11's $1.15 is that interest.

The sweep is modelled as one more Security, priced at exactly $1.00 a share. Then cash is just a Position like any other: 6,476.65 shares of the sweep, worth $6,476.65. Every Transaction's cash leg moves sweep shares, and the same fold that counts fund shares counts cash. How the sweep's interest is set comes in a later primer.

## 7. What this means for the code

The custodian's ledger slice (#35) stores facts and derives everything else.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../diagrams/ledger-fold.dark.svg">
  <img alt="Two stored, append-only inputs: the Ledger of Transactions, each with a Trade, Settlement and Posting date, and Prices, one per Security per business day. For an As-of date, adding the rows with a Trade date up to it gives the Positions, and adding the rows with a Settlement date up to it gives Settled cash. Positions times prices give Market value." src="../diagrams/ledger-fold.light.svg">
</picture>

**Stored**, and never changed once written:

- The Ledger's Transactions: Account, kind, Security, the change in shares, the change in cash, Trade date, Settlement date, Posting date, and, for a Reversal, the row it reverses
- Each Security's price for each business day

**Derived** from those, on demand, for any As-of date:

- Positions: shares per Security and cash, by trade date
- Settled cash, by settlement date
- Market value: Positions × prices

Two rules come with it:

- **Corrections are rows.** The code has no update or delete for a Transaction. A fix appends a Reversal and a replacement.
- **Each number keeps its type.** Cash is dollars in whole cents, shares are a count to six decimal places, and prices keep the decimal places they're quoted with ([ADR 0013](../adr/0013-money-shares-prices-and-rates-are-separate-types.md)). A Market value is computed at full precision and rounded to cents once.

A good test for the slice is the week above: load rows 1 to 11 and the prices, and the derived numbers must be exactly the ones in these tables.
