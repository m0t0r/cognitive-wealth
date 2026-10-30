# The Close: a Custodian's daily rhythm

This primer is for you if you've read [the ledger primer](01-ledger-positions-and-dates.md), [the Custodian feed primer](03-custodian-feed-and-ingestion.md) and [the prices primer](04-prices-dividends-and-the-cash-sweep.md) and want to know how their pieces fit into one day. Those primers explained prices, dividends, interest, Positions and Deliveries one at a time. This one puts them in order.

By the end you'll know:

- what the Close is, and why a Custodian has one each Business day
- what happens in a Close, step by step, and what goes wrong in another order
- which days are Business days, and why the stock market's calendar and the bond market's differ
- why a closed day is never rewritten, and how a mistake is fixed anyway
- how the simulated Custodian catches up after being switched off
- what real Custodians do, and what no public source says
- what #49 and #50 need from all this

Read it before one day's Close (#49) and the Catch-up (#50) are built. Each section answers one question. It starts with the short answer, then explains it, then shows it with numbers. Words with a capital letter, such as Close or Business day, are defined in [GLOSSARY.md](../../GLOSSARY.md).

## How to read this

The primer climbs in three levels. Each level uses only what the levels before it explained.

| Level                 | Parts   | What you get                                                                                |
| --------------------- | ------- | ------------------------------------------------------------------------------------------- |
| **1. The basics**     | 1 and 2 | Everyday comparisons and small numbers: the daily routine, its order, the calendar          |
| **2. How it works**   | 3 to 5  | Dana's Account: one Close step by step, three different Closes, a week with the laptop off  |
| **3. The real world** | 6 and 7 | What real Custodians and markets do, what's still undecided, and what it means for the code |

On a first read, it's fine to stop after Level 1, take a break, and come back. Level 3 makes most sense once Levels 1 and 2 feel familiar.

Not covered here: how the price and interest recipes work ([the prices primer](04-prices-dividends-and-the-cash-sweep.md); #46 and #47 decide them), the day the world's history starts (#50), and how Cognitive Wealth reads a Delivery ([the Custodian feed primer](03-custodian-feed-and-ingestion.md)).

## Part 1: The daily routine (Level 1)

### What is the Close?

**Short answer:** the routine that finishes one Business day at the Custodian: it fixes that day's numbers, in a set order, and sends out its Delivery.

Remember the chain of shops from the Custodian feed primer. Each evening, after the doors shut, a shop does the same few jobs in the same order: it settles what's owed, counts the till and the shelves, and sends head office the day's report. Nobody does these jobs at noon, because the numbers are still moving at noon. Nobody does them in a different order, because the report has to describe the finished count.

A Custodian's **Close** is that routine. In the simulated Custodian it has five steps:

1. **Prices:** record today's price for every Security.
2. **Dividends:** write a row for any dividend whose Pay date is today.
3. **Interest:** build up today's interest on cash, and pay it if the month's payment is due.
4. **Positions:** work out what each Account holds at the end of today.
5. **The Delivery:** write today's files, with the Manifest last.

Each step has its own primer. What's new here is that they happen together, in that order, for one date.

### Why does a Custodian need one?

**Short answer:** because prices and Transactions never stop moving during the day, and people need one fixed set of numbers for each day.

If you ask what Dana's Account was worth "on 17 March", you want one answer, not a different one for each minute of that day. The Close picks that one answer. After it, the day is finished.

There's also a legal reason. The SEC, the US regulator of securities markets, requires a broker-dealer (a firm licensed to buy and sell securities for customers, as many Custodians are) to keep "an itemized daily record of all purchases and sales of securities", and of "all receipts and disbursements of cash and all other debits and credits" ([SEC Rule 17a-3(a)(1)](https://www.ecfr.gov/current/title-17/section-240.17a-3)). So the law already expects a firm's records to be kept day by day. It doesn't say when in the day, or in what order (Part 6).

### Which days have a Close?

**Short answer:** Business days only: in the world, the days the New York Stock Exchange (the NYSE) is open.

Weekends have no Close, and neither do Market holidays: weekdays the NYSE stays shut, such as Good Friday and Labor Day. In 2026 there are ten of them (Part 6 lists them), so 261 weekdays give 251 Business days. On a day with no Close, nothing runs and no Delivery is sent. That's not a late Delivery: none is due ([the Custodian feed primer](03-custodian-feed-and-ingestion.md), Part 6).

Why the NYSE, and not "when the banks are open"? Part 6 answers that, because the two aren't the same.

### Why is a closed day never rewritten?

**Short answer:** because other people have already used its numbers.

Think of the diary from the ledger primer, written in pen. Once 17 March's page is written, you don't go back and change it, even if you find a mistake. You write the fix on today's page and say which day it's about.

The Close of 17 March told Cognitive Wealth that Dana's Account was worth a certain amount. An Advisor may have shown that number to Dana, or charged a fee on it. If 17 March quietly changed later, nobody could explain what was said or charged at the time. So a closed day stays as it was, and anything that changes comes in a later day's records (Part 6 shows how).

### What if nobody is there to run it?

**Short answer:** the next time it runs, it does each missed Close, in order, and gets the same numbers.

A real Custodian's systems run every Business day. The simulated Custodian runs on a laptop that may be switched off. You met the answer in the ledger primer (Part 7): fill in each missed page of the diary, in order, then continue. That's called a **Catch-up**. Part 5 follows one such week, and adds what the ledger primer's example didn't have: a Market holiday among the missed days.

## Part 2: A tiny Close (Level 1)

### What does one Close do, with small numbers?

**Short answer:** it turns yesterday's Account and today's events into today's Positions and today's Delivery.

Take a tiny Account. At the end of yesterday it holds 10 shares of a fund, priced at $20.00, and $100.00 of cash. Today the fund's price is $21.00, and the fund pays a dividend of $1.00 a share today. The cash earns interest of 0.01% a day.

| Step         | What happens                                                                | After it                   |
| ------------ | --------------------------------------------------------------------------- | -------------------------- |
| 1. Prices    | Today's price is recorded: $21.00                                           | Price is $21.00            |
| 2. Dividends | 10 × $1.00 = $10.00 is paid. One row is written                             | Cash is $110.00            |
| 3. Interest  | $110.00 × 0.01% = $0.011 builds up. It isn't paid yet, so no row is written | $0.011 of Accrued interest |
| 4. Positions | 10 shares × $21.00 = $210.00, plus $110.00 of cash                          | Worth **$320.00**          |
| 5. Delivery  | Today's prices, today's one row and today's Positions go out as files       | The day is finished        |

### Why does the order matter?

**Short answer:** because most steps read what an earlier step wrote.

Do these steps out of order in the tiny Close and the answer changes:

| If you did this               | You'd get                                                                                                 | The right answer |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------- |
| Positions before prices       | 10 × $20.00 + $110.00 = $310.00, using yesterday's price                                                  | $320.00          |
| Positions before the dividend | 10 × $21.00 + $100.00 = $310.00, with the dividend's row in the report                                    | $320.00          |
| Interest before the dividend  | $100.00 × 0.01% = $0.010, which breaks the world's rule that money earns from the day it arrives (Part 6) | $0.011           |
| The Delivery before Positions | A Delivery of yesterday's Positions, labelled today                                                       | Today's          |

Each of those is the same mistake: reading a number before it's ready. The fixed order is what stops it. One pair has no such reason: while every dividend is paid in cash, prices and dividends don't read each other, so prices come first by choice (Part 3 shows when it would matter). The whole order is the simulated Custodian's own design: no public source states one for real Custodians (Part 6).

## Part 3: One Close, step by step (Level 2)

### Which Close will you follow?

**Short answer:** Tuesday 17 March 2026, the Stock Fund's Pay date, because every step has work to do.

You'll follow Dana's joint Account, CW-000001, as in the prices primer. (Dana's IRA, CW-000002, gets its own dividend and interest in the same way, so it stays out of the tables.) At the Close of Monday 16 March, the Account holds 30 shares of the Stock Fund, 300 shares of the Bond Fund and $6,476.65 of cash.

**As in the prices primer, every market number is made up:** the Returns, the yields, the dividend and the Sweep rate of 3.65%. Prices are rounded to cents, half to even, only to keep the tables readable (#46 names the world's rule).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../diagrams/close-order.dark.svg">
  <img alt="Fixed inputs and already closed days feed one Close, which has five steps in order. The Factor file, Treasury yields and Security catalog feed step 1, Prices, one per Security. The dividend schedule feeds step 2, Dividends, the world's one Corporate action, a row on each Pay date. The Ledger and prices up to the Business day before feed steps 1, 2 and 3. Step 3 is Interest, which builds up and has a row once a month. Step 4 is Positions, worked out and not stored. Step 5 is the Delivery, five files with the Manifest last." src="../diagrams/close-order.light.svg">
</picture>

### Step 1: what are today's prices?

**Short answer:** Stock Fund $154.61, Bond Fund $10.04, and the Cash sweep at its fixed $1.00.

From the prices primer (Part 3), each is the previous Business day's price × (1 + today's Return):

- Stock Fund: $153.98 × 1.0041 = $154.611318, rounded to **$154.61**.
- Bond Fund: the 5-year yield falls from 3.76% to 3.74%, so the Return is −5 × (−0.02%) = +0.10%, and $10.03 × 1.0010 = $10.04003, rounded to **$10.04**.

This step reads the fixed inputs and yesterday's price. Each price is stored once, one per Security per Business day, and never changed.

### Step 2: is any dividend due?

**Short answer:** yes: $15.00 from the Stock Fund, one row.

Today is the Stock Fund's Pay date. Who is owed was fixed at the Close of Friday 13 March, the Business day before the Ex-dividend date (the prices primer, Part 4): Dana's Account held 30 shares then. So 30 × $0.50 = $15.00, already whole cents.

| #   | Trade date | Settlement date | Posting date | Kind     | Security   | Cash   |
| --- | ---------- | --------------- | ------------ | -------- | ---------- | ------ |
| 14  | Tue 17 Mar | Tue 17 Mar      | Tue 17 Mar   | Dividend | Stock Fund | +15.00 |

Cash is now $6,476.65 + $15.00 = **$6,491.65**. (A dividend is the simplest Corporate action, and the one kind the world has. Part 6 explains it.)

Notice that today's dividend reads a closed day, Friday 13 March. That's one reason a closed day must never change: later Closes depend on it.

### Step 3: how much interest builds up?

**Short answer:** $0.6498129565 today, and no row is written.

Interest is worked out on cash plus the Accrued interest so far (the prices primer, Part 5). Accrued interest was $6.4795652698 at the end of Monday 16 March, so:

($6,491.65 + $6.4795652698) × 0.0001 = **$0.6498129565**

Accrued interest is now $7.1293782264. It isn't cash yet, so it's kept at full precision and nothing goes in the Ledger. (This primer shows 10 decimal places, rounded half to even. The sums keep every digit.)

### Step 4: what does the Account hold now?

**Short answer:** the same shares, $15.00 more cash, and a total of $14,141.95.

Positions are worked out from the Ledger, never stored (the ledger primer, Part 2). So this step writes nothing to the database: it adds up the rows, then multiplies by Step 1's prices.

| Position   | Shares   | Price   | Market value  |
| ---------- | -------- | ------- | ------------- |
| Stock Fund | 30       | $154.61 | 4,638.30      |
| Bond Fund  | 300      | $10.04  | 3,012.00      |
| Cash sweep | 6,491.65 | $1.00   | 6,491.65      |
| **Total**  |          |         | **14,141.95** |

That's the same total as the prices primer's table, which is the check that nothing was counted twice.

### Step 5: what goes in the Delivery?

**Short answer:** everything above, as five files, with the Manifest written last.

| File               | For this Close                                                |
| ------------------ | ------------------------------------------------------------- |
| `prices.csv`       | Step 1's prices                                               |
| `transactions.csv` | The rows posted today: row 14, and the IRA's own dividend row |
| `positions.csv`    | Step 4's Positions, with their prices and Market values       |
| `securities.csv`   | Every Security, as in every Delivery                          |
| `accounts.csv`     | Every Account, as in every Delivery                           |
| `manifest.json`    | Each file's row count and Content hash, written last          |

Interest appears nowhere in these files today: Accrued interest isn't a row, and the totals leave it out, as in the prices primer (Part 3). Once `manifest.json` exists, Cognitive Wealth knows the Delivery is complete (the Custodian feed primer, Part 4), and 17 March is closed.

### What would go wrong in another order?

**Short answer:** most swaps give a wrong number, or a Delivery that disagrees with itself; one changes nothing yet.

The same mistakes as Part 2's tiny Close, on the real numbers:

| If you did this               | What you'd get                                                                                                                                                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Positions before prices       | Monday's prices on Tuesday's holdings: 30 × $153.98 + 300 × $10.03 + $6,491.65 = $14,120.05, which is $21.90 too low                                                                                                                      |
| Positions before the dividend | $14,126.95, and cash of $6,476.65 in `positions.csv`, while `transactions.csv` has a +$15.00 row. Reconciliation (phase 2) would report a Break of $15.00                                                                                 |
| Dividends before prices       | Nothing today, since the world pays every dividend in cash. A reinvested dividend would buy at today's price: at Monday's $153.98, the $15.00 would buy 0.097415 shares, not 0.097018 (each rounded down to six decimal places, ADR 0013) |
| Interest before the dividend  | Under the world's rule that money earns from the day it arrives, today's interest would be $0.6483129565, which is $0.0015 too low. See below                                                                                             |
| The Delivery first            | A Manifest that says "complete" while the day is half done, and different bytes next time, which looks like a Restatement (the Custodian feed primer, Part 6)                                                                             |

Does $0.0015 matter? The month's total would be $16.2320835100 instead of $16.2335856113, and both round to $16.23, so Dana's row wouldn't change. But the error grows with the money: $150,000.00 counted a day late earns $15.00 less. The rule itself, that money earns from the day it arrives, is the world's **simplification**: the prices primer used it (Part 5), #47 decides whether to keep it, and real firms often start later (Part 6).

## Part 4: Three other Closes (Level 2)

### Does every Close write rows to the Ledger?

**Short answer:** no: most write prices and nothing else.

From Monday 9 to Tuesday 31 March there are 17 Business days, so 17 Closes. Dana's joint Account gets a row in only two of them: the dividend on 17 March and the interest on 31 March. On the other 15, Step 2 finds no dividend due and Step 3 only builds up Accrued interest. Each still records prices, works out Positions and writes a Delivery, so Market value changes while this Account gets no new row (the prices primer, Part 3).

### What does Monday's Close do about the weekend?

**Short answer:** its interest step covers Saturday, Sunday and Monday, because interest builds up every calendar day and the Close doesn't run at weekends.

Here's the Close of Monday 16 March, the Stock Fund's Ex-dividend date:

| Step         | What happens                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 1. Prices    | Stock Fund: $154.93 × 0.9971 − $0.50 = $153.980703, rounded to **$153.98**, with the dividend taken off. Bond Fund: **$10.03** |
| 2. Dividends | No row. The Ex-dividend date decides who is owed, and nothing moves until the Pay date                                         |
| 3. Interest  | Three days, one at a time (below). No row                                                                                      |
| 4. Positions | 30 × $153.98 + 300 × $10.03 + $6,476.65 = **$14,105.05**                                                                       |
| 5. Delivery  | Monday's files. `transactions.csv` has no row for this Account                                                                 |

The interest step:

| Day        | Today's interest | Accrued interest so far |
| ---------- | ---------------- | ----------------------- |
| Fri 13 Mar | (last Close)     | 4.5350153232            |
| Sat 14 Mar | 0.6481185015     | 5.1831338247            |
| Sun 15 Mar | 0.6481833134     | 5.8313171381            |
| Mon 16 Mar | 0.6482481317     | 6.4795652698            |

Three days of interest, $1.9445499466, in one Close. It's still worked out day by day, because each day's interest earns interest the next day. So the interest step has to know the date of the last Close as well as today's. Which Sweep rate Saturday and Sunday use is #47's decision, since the Treasury publishes no yields at weekends.

### What happens on the day interest is paid?

**Short answer:** the interest step adds one row, and the cash goes up by the rounded amount.

Here's Tuesday 31 March. The prices between 17 and 31 March follow the same recipes as before. These Returns and yields are made up too:

<details>
<summary>Prices from Wednesday 18 to Tuesday 31 March</summary>

| Business day | Stock Fund Return | Exact price | Price  | 5-year yield | Bond Fund Return | Exact price | Price |
| ------------ | ----------------- | ----------- | ------ | ------------ | ---------------- | ----------- | ----- |
| Wed 18 Mar   | 0.30%             | 155.073830  | 155.07 | 3.75%        | −0.05%           | 10.034980   | 10.03 |
| Thu 19 Mar   | −0.40%            | 154.449720  | 154.45 | 3.73%        | 0.10%            | 10.040030   | 10.04 |
| Fri 20 Mar   | 0.50%             | 155.222250  | 155.22 | 3.72%        | 0.05%            | 10.045020   | 10.05 |
| Mon 23 Mar   | 0.20%             | 155.530440  | 155.53 | 3.74%        | −0.10%           | 10.039950   | 10.04 |
| Tue 24 Mar   | −0.10%            | 155.374470  | 155.37 | 3.74%        | 0.00%            | 10.040000   | 10.04 |
| Wed 25 Mar   | 0.60%             | 156.302220  | 156.30 | 3.73%        | 0.05%            | 10.045020   | 10.05 |
| Thu 26 Mar   | −0.30%            | 155.831100  | 155.83 | 3.75%        | −0.10%           | 10.039950   | 10.04 |
| Fri 27 Mar   | 0.40%             | 156.453320  | 156.45 | 3.76%        | −0.05%           | 10.034980   | 10.03 |
| Mon 30 Mar   | 0.10%             | 156.606450  | 156.61 | 3.75%        | 0.05%            | 10.035015   | 10.04 |
| Tue 31 Mar   | 0.20%             | 156.923220  | 156.92 | 3.74%        | 0.05%            | 10.045020   | 10.05 |

</details>

| Step         | What happens                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 1. Prices    | Stock Fund **$156.92**, Bond Fund **$10.05**                                                                             |
| 2. Dividends | None due                                                                                                                 |
| 3. Interest  | Today's $0.6507232862 brings Accrued interest to $16.2335856113. Paid: rounded once, half to even, to **$16.23**. Row 15 |
| 4. Positions | 30 × $156.92 + 300 × $10.05 + $6,507.88 = 4,707.60 + 3,015.00 + 6,507.88 = **$14,230.48**                                |
| 5. Delivery  | `transactions.csv` holds row 15, and the IRA's own interest row                                                          |

| #   | Trade date | Settlement date | Posting date | Kind     | Security | Cash   |
| --- | ---------- | --------------- | ------------ | -------- | -------- | ------ |
| 15  | Tue 31 Mar | Tue 31 Mar      | Tue 31 Mar   | Interest |          | +16.23 |

Rounding leaves $16.2335856113 − $16.23 = $0.0035856113 behind. This primer drops it, so April's Accrued interest starts from zero. That's a **simplification**: #47 decides whether a left-over carries into the next month. Carrying it would add about a third of a cent by 7 April, so no number that follows would change by a cent.

Tuesday 31 March happens to be a Business day. A month can also end on a weekend or a Market holiday, when no Close runs and so no row can be written. Real firms credit interest on a day they set (Part 6), and #47 picks the world's day.

## Part 5: A week with the laptop off (Level 2)

### What happens over Good Friday?

**Short answer:** the Catch-up runs the Close for each missed Business day, in order, and skips everything else, including Good Friday.

The ledger primer's example had a week off with only weekends to skip. This one has a Market holiday too. The Close of Tuesday 31 March is the last one stored. The laptop is switched off until Tuesday 7 April. Friday 3 April is Good Friday, a Market holiday.

| Step               | Days                                                       |
| ------------------ | ---------------------------------------------------------- |
| Last Close stored  | Tue 31 Mar                                                 |
| Started again      | Tue 7 Apr                                                  |
| Catch-up, in order | Wed 1, Thu 2, Mon 6 Apr: up to yesterday                   |
| Skipped            | Fri 3 Apr (a Market holiday), Sat 4, Sun 5 Apr (a weekend) |
| From then on       | a Close each evening, starting Tue 7 Apr                   |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../diagrams/catch-up-holiday.dark.svg">
  <img alt="A timeline of Monday 30 March to Thursday 9 April 2026 in two rows. The laptop row: running and closing each evening on Monday 30 and Tuesday 31 March, switched off from Wednesday 1 to Monday 6 April, started again on Tuesday 7 April, when it catches up, then running and closing each evening to Thursday 9 April. The Business days closed row: 30 and 31 March closed on the evening itself, Wednesday 1 and Thursday 2 April closed on Tuesday 7 April, no Close on Friday 3 to Sunday 5 April, because they aren't Business days, Monday 6 April closed on Tuesday 7 April, and 7 to 9 April closed on the evening itself." src="../diagrams/catch-up-holiday.light.svg">
</picture>

The numbers, made up like the others, with prices rounded to cents, half to even, as before. Each row is what that Close works out, on whichever evening it runs:

| Close     | Stock Fund Return | Price  | 5-year yield | Bond Fund Return | Price | Total Market value | Interest since the last Close | Accrued interest so far |
| --------- | ----------------- | ------ | ------------ | ---------------- | ----- | ------------------ | ----------------------------- | ----------------------- |
| Wed 1 Apr | 0.50%             | 157.70 | 3.72%        | 0.10%            | 10.06 | 14,256.88          | 0.6507880000                  | 0.6507880000            |
| Thu 2 Apr | −0.20%            | 157.38 | 3.74%        | −0.10%           | 10.05 | 14,244.28          | 0.6508530788                  | 1.3016410788            |
| Mon 6 Apr | 0.30%             | 157.85 | 3.77%        | −0.15%           | 10.03 | 14,252.38          | 2.6040632334 (four days)      | 3.9057043122            |
| Tue 7 Apr | 0.10%             | 158.01 | 3.76%        | 0.05%            | 10.04 | 14,260.18          | 0.6511785704                  | 4.5568828826            |

Cash stays at $6,507.88, because no row is due. The first three Closes run one after another on Tuesday 7 April, and the fourth runs that evening.

Monday 6 April's interest covers four calendar days (Friday 3, Saturday 4, Sunday 5 and Monday 6 April), because Good Friday stops the Close, not the interest.

### What does the Bond Fund do about Good Friday's yield?

**Short answer:** it ignores the day, and measures Monday's change from Thursday.

The Treasury published a yield curve on Good Friday, 3 April 2026, even though the NYSE was shut (`apps/custodian/market/treasury-yields.csv` has the row). Part 6 explains why. Say Friday's made-up 5-year yield is 3.80%. There's no Close on Friday, so no Bond Fund price either. Monday's change is measured from the last Business day:

| Measured from | Yield then | Monday's yield | Change | Bond Fund Return |
| ------------- | ---------- | -------------- | ------ | ---------------- |
| Thu 2 Apr     | 3.74%      | 3.77%          | +0.03  | −0.15% (right)   |
| Fri 3 Apr     | 3.80%      | 3.77%          | −0.03  | +0.15% (wrong)   |

Measuring from Friday would lose Friday's rise of 0.06 points altogether. Measuring from Thursday keeps the whole move from one price to the next. It's the same reason a price is always built on the previous Business day's price. This is the primer's proposal for the world, not a cited rule: #46 decides.

### Are the caught-up days really the same?

**Short answer:** yes, because each Close is told its date and never asks what day it is.

The numbers in that table are the same whether the Close of Wednesday 1 April runs on 1 April or on 7 April. That's the ledger primer's rule (Part 7): a day is a recipe, from the seed, the Pin and the date.

The dates on the rows follow the same rule. If a row were due on Wednesday 1 April, its Trade date and Posting date would both be 1 April, even though the laptop wrote it on 7 April. The Posting date is the day the Custodian wrote the row "in the simulated world". No public source covers a day closed late, so this is a rule of the simulation, which #49 builds. The real moment goes in a separate column, `recorded_at`, which never reaches the feed ([ADR 0017](../adr/0017-custodian-feed-format.md): no file holds the time it was written). Otherwise a caught-up day would have different bytes from one closed on time, and would look like a Restatement.

## Part 6: In the real world (Level 3)

The examples were kept simple on purpose. Each section below starts from something you've already seen, and says plainly where public sources stop.

### What do real Custodians do at the end of the day?

**Short answer:** many things on published timetables, but no public source states an order of steps like this primer's.

Here's what is public, by the clock. These come from different firms, so they aren't one firm's schedule:

| Time (US Eastern) | What happens                                                                                                                              | Source                                                                                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| About 3:30 PM     | Quotes behind the Treasury's yields are taken, "at or near 3:30 PM each trading day"                                                      | [Treasury: par yield curve rates](https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve&field_tdr_date_value=2025) |
| 4:00 PM           | The NYSE's regular session ends, with a "Closing Auction"                                                                                 | [NYSE: Holidays and Trading Hours](https://www.nyse.com/trade/hours-calendars)                                                                                                   |
| About 4:00 PM     | A fund's NAV (its price per share, the prices primer, Part 1) is calculated, at Vanguard "as of the close of regular trading" on the NYSE | [Vanguard Bond Index Funds prospectus](https://www.sec.gov/Archives/edgar/data/794105/000168386322003914/f12292d0.htm) (2022)                                                    |
| About 8:20 PM     | A broker's statement cut-off for securities, at Interactive Brokers                                                                       | [Interactive Brokers: statements](https://www.ibkrguides.com/orgportal/performanceandstatements/statements.htm)                                                                  |
| 9:45 to 11:30 PM  | The clearing company's "CNS Night Cycle" and the steps before it, as listed in a notice for Good Friday 2026                              | [NSCC notice A#9732](https://www.dtcc.com/Globals/PDFs/2026/March/06/a9732)                                                                                                      |
| 2:00 AM           | That cycle's output, "at normal time". Around that holiday, some of it comes 24 hours later                                               | NSCC notice, same page                                                                                                                                                           |

NSCC, the National Securities Clearing Corporation, is a central company that clears US stock trades: the step before the Settlement date ([the ledger primer](01-ledger-positions-and-dates.md), Part 3). Schwab says its data files for advisors hold "close-of-business data" on "Positions, balances, and transactions" and "Pricing and security information" ([Schwab Advisor Services](https://advisorservices.schwab.com/managing-your-business/tech-integration/daily-data-files)), without a time.

So the idea of a daily cut-off, an overnight cycle and files by morning is well documented. What isn't public is the order inside any Custodian's own systems. **The five steps are this project's design**, chosen because most steps need what an earlier one wrote (Part 2). Real firms also record trades and money movements through the day, not all at the end (general practice).

### Why do the stock and bond calendars differ?

**Short answer:** because they're run by different bodies, and on some days the NYSE is open while the bond market and the banks are closed, and on others the reverse.

The NYSE's calendar marks Columbus Day and Veterans Day as "Bank Holidays where NYSE is open. FX and interest rate markets are closed." ([NYSE 2025 calendar](https://www.nyse.com/publicdocs/ICE_NYSE_2025_Yearly_Trading_Calendar.pdf)). SIFMA, the industry group that recommends the bond market's holidays, lists both ([SIFMA holiday schedule](https://www.sifma.org/resources/general/holiday-schedule/)), and so does the Federal Reserve ([Federal Reserve holidays](https://www.federalreserve.gov/aboutthefed/k8.htm)).

The reverse happens too. The NYSE closed on 9 January 2025, "in observance of the National Day of Mourning" for President Carter ([ICE press release](https://ir.theice.com/press/news-details/2024/The-New-York-Stock-Exchange-Will-Close-Markets-on-January-9-to-Honor-the-Passing-of-Former-President-Jimmy-Carter-on-National-Day-of-Mourning/default.aspx)), while SIFMA recommended only "an early market close at 2:00 pm EST" for bonds ([SIFMA](https://www.sifma.org/news/press-releases/sifma-recommends-early-market-close-on-january-9-2025-for-the-national-day-of-mourning-in-honor-of-former-president-carter)). And on Good Friday 2026, the NYSE was closed while SIFMA listed an "Early Close (12:00 p.m. Eastern Time)" for bonds.

You can see it in the world's own data. Comparing the pinned Factor file with the committed Treasury yields, from 2 January 2020 to 31 August 2026:

| Which days                 | How many | What they are                                                          |
| -------------------------- | -------- | ---------------------------------------------------------------------- |
| In both                    | 1,663    | Ordinary days                                                          |
| Factor returns, no yield   | 11       | Columbus Day and Veterans Day, such as 13 October and 11 November 2025 |
| A yield, no Factor returns | 4        | Good Friday in 2021, 2023 and 2026, and 9 January 2025                 |

That's 1,674 days in the Factor file and 1,667 in the yields. The Factor file's days follow the NYSE. The Treasury never says which days it skips, so saying its days follow the bond market is an inference from these gaps, though they fit.

### Which calendar does the world use?

**Short answer:** the NYSE's, because a fund's price needs it; everything else follows it, as a labelled simplification.

Prices are the reason. Most Securities in the world get their Return from the Factor file, which has a row only for NYSE days. Real funds use the same clock: Vanguard's bond funds calculate their NAV "on each day that the NYSE is open for business (a business day)" ([Vanguard Bond Index Funds prospectus](https://www.sec.gov/Archives/edgar/data/794105/000168386322003914/f12292d0.htm), 2022 text). A prospectus is the document a fund publishes to describe itself to investors.

So **in the world, a Business day is a day the NYSE is open.** On the 11 days with no yield there's still a Close, and on the 4 days with a yield and no Factor returns there isn't. Using one calendar for everything is a **simplification**, and it isn't what real firms do in three places:

| What                                | In the real world                                                                                                                                                                                                                                                                                                                                                                                                                  | In the world                                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| A bond fund's price on Columbus Day | Vanguard "may use fair-value pricing on bond market holidays" (same prospectus): its own estimate. Guggenheim closes some bond funds on those days ([Guggenheim holiday schedule](https://portal.guggenheiminvestments.com/services/current-shareholder-information/holiday-trading-schedule)). Practice varies                                                                                                                    | Proposal: no new yield, so no change from the yield. #46 decides                                    |
| Settlement on Columbus Day          | FINRA (the body that oversees US brokers), in its schedule of deadlines under Regulation T (the rule on how soon a customer must pay for a purchase): it's a business day for some rules, "However, Columbus Day and Veterans Day are not settlement dates because banking institutions will be closed on these days" ([FINRA](https://www.finra.org/rules-guidance/key-topics/margin-accounts/margin-extension-holiday-schedule)) | Counts as a Business day for T+1. Each row stores its own Settlement date, so this can change later |
| Cash on Columbus Day                | Nacha, which sets the rules for US bank transfers: "payments are not currently settled on weekends and federal holidays" ([Nacha fact sheet](https://www.nacha.org/content/ach-payments-fact-sheet)). Schwab's Business Day is "any day that the New York Stock Exchange and the Federal Reserve Bank of New York are open" ([Schwab](https://www.schwab.com/legal/cash-features-disclosure-statement))                            | Interest still builds up. #47's schedule should avoid such a day for a Pay date                     |

Here's the first row in real yields. The 5-year yield was 3.65% on Friday 10 October 2025 and 3.60% on Tuesday 14 October 2025, with no row for Monday 13 October. With a duration of 5, as in the prices primer's example, the proposal gives Monday a Return of 0.00% from the yield, and Tuesday −5 × (−0.05%) = +0.25%. Nothing is lost: Tuesday's change is measured from Friday, the last yield there was, in the same way Part 5 measured Monday from Thursday. (The two cases differ only in why: there, Friday had a yield but no Close; here, Monday has a Close but no yield.) No source read says which rate a sweep uses on such a day. The proposal is the rate from the last published yield, as for a weekend, and #47 decides.

### Which days are Market holidays in 2026?

**Short answer:** ten weekdays, which the NYSE publishes years ahead.

| Market holiday             | 2026       |
| -------------------------- | ---------- |
| New Year's Day             | Thu 1 Jan  |
| Martin Luther King Jr. Day | Mon 19 Jan |
| Washington's Birthday      | Mon 16 Feb |
| Good Friday                | Fri 3 Apr  |
| Memorial Day               | Mon 25 May |
| Juneteenth                 | Fri 19 Jun |
| Independence Day, observed | Fri 3 Jul  |
| Labor Day                  | Mon 7 Sep  |
| Thanksgiving Day           | Thu 26 Nov |
| Christmas Day              | Fri 25 Dec |

The list is from [NYSE: Holidays and Trading Hours](https://www.nyse.com/trade/hours-calendars). The same page lists two days in 2026 that close early, at 1:00 p.m.: Friday 27 November and Thursday 24 December. They're still Business days, and each has a Close.

### Where does the calendar come from after the Factor file ends?

**Short answer:** the Factor file can't say which future days are Business days, so the calendar has to be a fixed input of its own.

Up to the Factor file's last day, 31 August 2026, its rows are the Business days. After that there are no rows to read, but the world continues. The NYSE publishes its holidays "for 2026, 2027, and 2028" (NYSE page above). So the world needs a calendar that goes past the Factor file, and it must follow the rule every input follows: changing it is a deliberate rebuild, because it would change which days exist. [ADR 0027](../adr/0027-daily-prices-are-a-recipe-over-the-market-inputs.md) keeps it as NYSE's own holiday rule, written in the custodian's code, so there is no list to run out; the NYSE's published years are that code's test.

One-off closures show why it's fixed rather than live. The NYSE announced 9 January 2025's closure only ten days ahead, on 30 December 2024 (the ICE press release above). If the real NYSE closes for a day in the future, the world doesn't follow it, in the same way the world keeps using resampled Returns "even once newer real data exists" ([docs/product.md](../product.md)).

Several parts of the world read the calendar, so there should be one:

| Who                         | What it asks                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| The Close (#49)             | Does today have a Close?                                                                                  |
| The Catch-up (#50)          | Which days are missing?                                                                                   |
| T+1                         | What is the next Business day?                                                                            |
| The dividend schedule (#47) | What's the Ex-dividend date, and which Close fixes who is owed?                                           |
| Ingestion's job (#56)       | Is this Delivery late, or not due? It's in Cognitive Wealth, not the Custodian, so it needs an answer too |

### What happens when real history ends?

**Short answer:** the Catch-up runs the same five steps, with resampled Returns in place of real ones.

The ledger primer promised this. The Factor file and yields end on Monday 31 August 2026. Say the laptop's last Close is Friday 28 August, and it starts again on Thursday 10 September:

| Close                   | Returns from                                          |
| ----------------------- | ----------------------------------------------------- |
| Mon 31 Aug              | The last real day in the Factor file and yields       |
| Tue 1 to Fri 4 Sep      | Resampled: blocks of past days picked at random (#46) |
| Sat 5, Sun 6, Mon 7 Sep | No Close: a weekend and Labor Day                     |
| Tue 8, Wed 9 Sep        | Resampled in the same way                             |
| Thu 10 Sep              | That evening's Close, resampled too                   |

Those days are realistic, but not real, as the prices primer said (Part 6). Which past day a date copies depends only on the seed and the date, so the same day gives the same Returns whenever it's closed. The Sweep rate needs the same kind of rule after that date (#47).

The first run on an empty database, the **Backfill**, is the same loop as well: there's no last Close, so it starts from the world's first day and works through about 250 Closes for each year of history. Which day is the first is a decision in #50, so this primer doesn't pick one.

### What about corporate actions?

**Short answer:** the world has one kind, the ordinary cash dividend; real Custodians handle many.

A Corporate action is something the company or fund behind a Security decides that changes what its holders own. FINRA's rule on them lists "dividends or other distributions in cash or kind, stock splits or reverse stock splits, or rights or other subscription offerings", and, separately, mergers ([FINRA Rule 6490](https://www.finra.org/rules-guidance/rulebooks/finra-rules/6490)). So a dividend is the simplest one.

For a split, timing gets harder. Schwab says "Additional shares are credited to shareholders' accounts" on the payable date, and the stock "begins trading at its split-adjusted price" on the effective date ([Schwab: stock splits](https://www.schwab.com/learn/story/what-are-stock-splits-and-why-do-stocks-split)). The Depository Trust Company, which holds most US shares for brokers, allocates stock distributions "on the ex-date +2 or the payable date, whichever comes later" ([DTC Distributions Service Guide](https://www.dtcc.com/-/media/Files/Downloads/legal/service-guides/Service-Guide-Distributions.pdf)). No Custodian's public page read for this primer says when in the day it posts its own record.

**In the world, Step 2 is dividends and nothing else**: ordinary cash dividends under 25% of the price (the prices primer, Part 6). Splits and mergers are left out, a **simplification**. If a later slice adds them, they come in that step, because they change the shares that Positions and interest read after it.

### What about money a Household puts in or takes out?

**Short answer:** it has a place in the order, between dividends and interest, but no slice builds it yet.

Contributions, withdrawals, buys and sells are Transactions too. At a real Custodian they're recorded as they happen, and banks don't settle them on holidays (the table above). In a simulation, something has to make them happen, and a Close is where the day's rows get written.

If they come, they belong after dividends and before interest, for the same reason as a dividend: in the world, money earns from the day it arrives, and a withdrawal stops earning on the day it leaves. So interest has to read cash after today's rows. Real firms have other rules (the next section).

#49's scope is prices, dividends, interest, Positions and the feed. No slice in #17 lists deposits, withdrawals or trades, and #17 rules out "anything that moves money into the Custodian" for this phase. So **the first Close has none, a labelled deferral**: Dana's rows up to 6 March are hand-written, and only dividends and interest are added after it. That leaves one question open that has to be answered first: when #52 generates about 150 Accounts, where do their first Positions come from, given that a Position is only ever the sum of its rows? #49 and #52 have to settle that between them. No slice owns the rest yet, so #17 needs one before any Household money moves in the world.

### When does real money start to earn, and when is interest paid?

**Short answer:** often later than in the world, and on a day each firm sets.

The world's rule is that money earns from the day it arrives in the Account. That's a **simplification**, and #47 decides whether to keep it. Two real documents say something different:

- The sweep agreement from the prices primer: "Interest begins to accrue on the date of deposit within the Program Bank(s), through the business day preceding the date of withdrawal from a Deposit Account" ([Navy Federal Investment Services, Sweep Program General Terms and Conditions](https://www.navyfederal.org/content/dam/nfculibs/pdfs/nffg/pershing-sweep-terms-conditions.pdf); Program Banks are the banks that take the deposits). So the date that counts is the deposit at the bank, not the day the money reaches the Account.
- Schwab's bank sweep: "Interest accrues on your funds from the day they are deposited at the Program Bank, not while they are held by Schwab".
- Schwab's money market sweep, which it generally offers only to some kinds of account: a balance "will be swept into your Schwab Sweep Money Fund and generally will not begin earning dividends until the following Business Day" ([Schwab Cash Features Disclosure Statement](https://www.schwab.com/legal/cash-features-disclosure-statement), for the Schwab quotes in this section).

So at those firms, today's dividend might not earn today. In a real Close, interest before the dividend could be right. In the world, it's wrong only because of the world's rule.

Paying is on a day the firm sets. Schwab's bank sweep is "credited on the 15th of each month (or the following Business Day if the 15th is not a Business Day)". Schwab One Interest, where cash stays with Schwab instead of being swept anywhere, "accrues daily and is credited to your Account on or before the last Business Day of each month". Both are paid by a Business day, which fits a Close: only a Close can write a row. #47 picks the world's day.

What if a dividend's Pay date isn't a Business day? No source read for this primer says, for a stock or fund. The nearest rule is for US Treasury securities: "we will make the payment (without additional interest) on the next business day" ([31 CFR 356.30(a)](https://www.ecfr.gov/current/title-31/subtitle-B/chapter-II/subchapter-A/part-356/subpart-D)). The world avoids the question: #47's schedule should only hold Pay dates that are Business days, a **simplification**.

### How is a mistake fixed if a closed day can't change?

**Short answer:** by new rows on a later day, as the ledger primer showed; and the rule allows more than the world does.

Say 17 March's dividend should have been $18.00, and it's found on Thursday 19 March. The Close of 19 March posts a Correction, as in the ledger primer (Part 4):

| Trade date | Posting date | Kind                   | Cash   |
| ---------- | ------------ | ---------------------- | ------ |
| Tue 17 Mar | Thu 19 Mar   | Reversal of row 14     | −15.00 |
| Tue 17 Mar | Thu 19 Mar   | Dividend (the new row) | +18.00 |

17 March's Delivery stays as sent: `positions.csv` there is "as known on the As-of date" ([ADR 0017](../adr/0017-custodian-feed-format.md)). 19 March's Delivery carries both rows, and its cash is $3.00 higher. (The extra interest on that $3.00 is left out, to keep the example short.)

Is this what the law requires? Not quite. A broker-dealer's electronic records must either keep "a complete time-stamped audit trail" that "will permit re-creation of the original record if it is modified or deleted", or be kept "exclusively in a non-rewriteable, non-erasable format" ([SEC Rule 17a-4(f)(2)(i)](https://www.ecfr.gov/current/title-17/section-240.17a-4)). So a Custodian may change a record, if the change is logged and the original can be recovered. The world's rule is the stricter option, and a design choice: rows can only be added, because the database's `app` role has no way to update or delete them. The rule says nothing about how to correct a record.

A Restatement, a replacement for a whole Delivery, is the harder case (the Custodian feed primer, Part 6). The simulated Custodian doesn't make one in phase 1, and Ingestion refuses one.

There's one more way a day could change: a change to the Close's own code. "The same seed, Pin and date give the same day" holds only while the recipe stays the same. If a fix to the code changes a number, the old database and the new code no longer agree. The fix is the same as for moving the Pin: a deliberate rebuild from empty. The Pin's build record catches a changed input, but not changed code ([ADR 0019](../adr/0019-market-data-pinned-or-committed.md)), so #50 should say how that's noticed.

### What if a Close stops halfway?

**Short answer:** a day isn't closed until its Manifest exists, and running it again must finish the job without changing what's there.

The laptop can lose power between any two steps. Two tools already cover most of it:

- **One database commit.** The prices and rows of Steps 1 to 3 can go in together, so a crash leaves all of them or none. That's the same one-commit idea as Ingestion's.
- **The Manifest last.** The writer already swaps each file in whole and writes the Manifest last ([ADR 0017](../adr/0017-custodian-feed-format.md)), so a half-written Delivery has no Manifest, and a reader won't trust it.

The gap between them is a day whose rows are committed but whose Delivery isn't written. On restart, the Catch-up must see that day as unfinished and write the Delivery, without adding the rows twice. #49 and #50 decide how, and what counts as "the last Close" in code.

### What do real firms do after an outage?

**Short answer:** they must have a plan, but no public source says what a Custodian does about a missed day.

FINRA requires a written plan "reasonably designed to enable the member to meet its existing obligations to customers", covering "Data back-up and recovery" and "All mission critical systems" ([FINRA Rule 4370](https://www.finra.org/rules-guidance/rulebooks/finra-rules/4370)). Pershing states a "recovery time objective for business resumption" of "four (4) hours or less" ([Pershing's disclosure](https://investor.pershing.com/nxi/disclosure/brokeragedisclosure/businesscontinuity)). For planned holidays, NSCC says trade input is "accepted but not processed until normal business operations resume" ([NSCC notice A#9806](https://www.dtcc.com/Globals/PDFs/2026/August/10/a9806)), and that some activity is available "24 hours later than usual" (NSCC notice A#9732, above).

None of that says what a Custodian or an advisor's platform does with a missed file. The Catch-up here, one day at a time and in order, is **this project's design**, and it works because the world is a recipe. A real firm's missed day can't be recomputed from a seed.

## Part 7: What this means for the code (Level 3)

### What do #49 and #50 build?

**Short answer:** #49 builds one Close for one date; #50 runs it for every day that needs one.

| Slice | What it builds                                                                | What it decides                                                                                                                                     |
| ----- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| #46   | Each Security's price for a Business day                                      | Rounding; resampling; the Return on a Business day with no yield                                                                                    |
| #47   | The dividend schedule, and daily interest                                     | The Sweep rate on days with no yield; which day interest is paid; the left-over cent                                                                |
| #49   | The Close: the five steps for one date, and the Business-day calendar it asks | How the calendar is kept; how Transaction IDs are set ([ADR 0017](../adr/0017-custodian-feed-format.md)); where first Positions come from, with #52 |
| #50   | The Backfill, the Catch-up, and a Close each evening                          | The first day; what counts as the last Close; how changed code is noticed                                                                           |
| #56   | The job that ingests each Close                                               | How it asks the calendar whether a Delivery is due                                                                                                  |

Rules that come with it:

- **Each Close takes its date as an input.** Nothing inside reads today's date. "Yesterday" is worked out once, at the very start of a Catch-up, by whatever calls the Close.
- **A day with no Close has no Delivery.** Asking for a non-Business day should refuse, not write a Delivery with only the Cash sweep's price, as the writer does now that it has no calendar ([ADR 0017](../adr/0017-custodian-feed-format.md)).
- **The Posting date is the Close's date**, not the laptop's. Real time stays in `recorded_at`.
- **The Ledger and prices stay append-only**: `app` can select and insert, and nothing else.
- **Catch-up goes in date order, with no gaps**, as Ingestion's does (the Custodian feed primer, Part 6).

### What can become tests?

**Short answer:** the worked numbers, the order, and the determinism promise.

- **The ledger adds up to Positions.** Given Dana's rows, the Close of 17 March reproduces this primer's table, if #46 and #47 keep the recipes.
- **Order.** On a Pay date, `positions.csv` includes the dividend, and `prices.csv` and `positions.csv` agree on the price.
- **The same day twice.** The same seed, Pin and date give the same bytes (#49's determinism test).
- **Catching up changes nothing.** Closing 1, 2 and 6 April in one go gives the same bytes as closing each one on its own evening (#50).
- **The calendar matches the data.** Every day in the Factor file is a Business day, and the reverse, up to its last date.

## Recap

1. The **Close** is the routine that finishes one Business day: prices, dividends, interest, Positions, then the Delivery.
2. The order is this project's design, and no public source states one for real Custodians. Most steps read what an earlier one wrote, so another order gives wrong numbers or a Delivery that disagrees with itself.
3. In the world, a **Business day** is a day the NYSE is open. Weekends and **Market holidays** have no Close and no Delivery.
4. The stock and bond calendars differ. In the pinned data, 11 days have Factor returns and no yield, and 4 have a yield and no Factor returns. The world uses one calendar, a labelled simplification.
5. Most Closes write no Ledger rows, only prices. Dana's joint Account gets 2 rows in the 17 Closes from 9 to 31 March.
6. Interest builds up every calendar day, so a Close covers every day since the last one: Monday's covers the weekend, and Good Friday's interest arrives with the next Close.
7. A closed day is never rewritten. Fixes are new rows on a later day. The SEC's rule allows a logged change too; never changing is the world's stricter choice.
8. A **Catch-up** runs each missed Close in order, up to yesterday, with each Close told its date. Rows carry the simulated day's Posting date, so caught-up days are byte for byte the same. A **Backfill** is the same loop from the world's first day.
9. After real history ends, the same steps run on resampled Returns, seeded by the date. The calendar can't come from the Factor file then, so it's a fixed input of its own.
10. Still to decide: how the calendar is kept (#49), where the first Positions come from (#49 and #52), and what counts as the last Close (#50). Household money has a place in the order, but no slice yet.

## Check yourself

Try to answer each one before opening it.

<details>
<summary>1. Why does the Close work out Positions after the dividend, and not before?</summary>

Because the dividend's row changes cash. Positions worked out first would miss it, so the day's Delivery would have a row in `transactions.csv` that `positions.csv` doesn't reflect.

</details>

<details>
<summary>2. An Account has $200.00 of cash, and a $50.00 dividend arrives today. At 0.01% a day, how much interest builds up today?</summary>

($200.00 + $50.00) × 0.0001 = $0.025, ignoring any Accrued interest. The dividend comes first in the order, and in the world money earns from the day it arrives. It's Accrued interest, so no row is written.

</details>

<details>
<summary>3. Is Friday 3 April 2026 a Business day in the world? The Treasury published yields that day.</summary>

No. It's Good Friday, so the NYSE is closed. There are no Factor returns, no Close and no Delivery. In the world, the NYSE decides, even when the bond market is partly open.

</details>

<details>
<summary>4. Is Monday 13 October 2025 a Business day in the world? The Treasury published no yields that day.</summary>

Yes. It's Columbus Day, and the NYSE was open, so it has Factor returns and a Close. The missing yield is #46's to handle. In reality the banks were closed and it wasn't a settlement date, so the single calendar is a labelled simplification.

</details>

<details>
<summary>5. The Close of Monday 16 March covers how many days of interest, and why?</summary>

Three: Saturday 14, Sunday 15 and Monday 16 March. Interest builds up every calendar day, and there's no Close at the weekend. They're worked out one day at a time, since each day's interest earns interest the next.

</details>

<details>
<summary>6. On how many of the 17 Closes from 9 to 31 March does Dana's joint Account get a row, and what do the others still do?</summary>

Two: the dividend on 17 March and the interest on 31 March. The others still record prices, build up interest, work out Positions and write a Delivery, so the Account's Market value still changes.

</details>

<details>
<summary>7. The last Close stored is Friday 22 May 2026, and the laptop starts again on Tuesday 2 June. Which days does the Catch-up close?</summary>

Tue 26, Wed 27, Thu 28 and Fri 29 May, and Mon 1 June: up to yesterday, in order. It skips Sat 23, Sun 24 and Mon 25 May (Memorial Day), and Sat 30 and Sun 31 May. It closes Tue 2 June that evening as usual.

</details>

<details>
<summary>8. A dividend's Pay date is Wednesday 1 April, and the Catch-up writes its row on Tuesday 7 April. What is its Posting date, and why?</summary>

Wednesday 1 April. The Posting date is the simulated day. If it were 7 April, the row's bytes would depend on when the laptop was switched on, and the same day wouldn't give the same Delivery. The real moment is kept in `recorded_at`, which never reaches the feed.

</details>

<details>
<summary>9. (Level 3) On real data, the 5-year yield was 3.94% on Thu 2 April 2026, 3.99% on Fri 3 April, and 3.98% on Mon 6 April. What change does Monday's Close use?</summary>

3.98% − 3.94% = +0.04 points, measured from Thursday, the last Business day. Friday has no Close, so measuring from Friday's 3.99% would lose Friday's rise.

</details>

<details>
<summary>10. (Level 3) Does SEC Rule 17a-4 forbid changing a closed day's records?</summary>

No. It requires either a complete time-stamped audit trail that lets the original be re-created, or a non-rewriteable, non-erasable format. So a logged change is allowed. The world never changes a row, which is the stricter choice, and its own design.

</details>

<details>
<summary>11. (Level 3) The laptop loses power after the Close of 8 April has committed its rows but before its Manifest is written. What must the restart do?</summary>

Treat 8 April as unfinished, write its Delivery with the Manifest last, and not add its rows again. Cognitive Wealth won't read the Delivery until the Manifest exists, and the rows in the database don't change. #49 and #50 decide how the code tells which case it's in.

</details>

<details>
<summary>12. (Level 3) Why can't the Factor file be the world's whole calendar?</summary>

It ends on 31 August 2026, and the world continues after that. Past that day there are no rows to read, so the world needs a fixed list of its own, one that a change to would rebuild the world, as moving the Pin does.

</details>
