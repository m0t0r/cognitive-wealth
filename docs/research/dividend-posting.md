# When a custodian records a dividend

Question for #44 and #47: on which date does a custodian write a cash dividend into an account, and what does it show between the ex-dividend date and the pay date?

Read on 2026-10-25. Terms: the **ex-dividend date** is the first day a buyer doesn't get the dividend; the **pay date** is when the cash is paid ([SEC: Ex-Dividend Dates](https://www.investor.gov/introduction-investing/investing-basics/glossary/ex-dividend-dates-when-are-you-entitled-stock-and)).

## What the sources say

| Source                                                                                                                                  | How read                                        | Cash credited                                                                                                                  | Shown before the cash arrives                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Interactive Brokers FAQ: dividend accruals](https://www.interactivebrokers.com/lib/cstools/faq/content/1163238150)                     | Headed agent-browser (WebFetch got a 403)       | On the pay date: "the actual dividend amount is not assured until the payment has been made by the issuer on the Payment Date" | Yes. IB "will accrue the value of the dividend, net of any withholding taxes, on the Ex-Date". It is included "in Equity with Loan Value", but "A dividend credit accrual does not increase Available Funds and can therefore not be withdrawn until paid." |
| [Interactive Brokers report guide: Change in Dividend Accruals](https://ibkrguides.com/rg/reportguide/changeindividendaccruals_mtm.htm) | WebFetch                                        | "reversal due to payout in cash" (code Re) removes the accrual when it's paid                                                  | "The postings (with code Po) are done for new accrual additions to the account", with columns for Ex Date, Pay Date and "The quantity held prior to ex date"                                                                                                |
| Schwab statement footnote, quoted by an advisory firm ([Marotta on Money](https://marottaonmoney.com/?p=29125))                         | Search result only; Schwab's own text not found | "have not been received into your account"                                                                                     | Yes, as a separate "Accrued Income" figure, the "sum of the total accrued interest and/or accrued dividends", which is "not covered by SIPC account protection until actually received and held in the account"                                             |

## What it settles

- **The cash moves on the pay date** at Interactive Brokers, the one custodian found that states it on its own pages: the amount "is not assured until the payment has been made by the issuer on the Payment Date" and can't be withdrawn "until paid". Schwab's footnote (second-hand) also separates income "received into your account" from income accrued. So a dividend Transaction that moves cash belongs on the pay date. That is what the simulated Custodian does (#44's primer, Part 4).
- **The amount owed is shown from the ex-dividend date** at Interactive Brokers, and as accrued income at Schwab (second-hand). It counts toward the account's value but can't be withdrawn. The simulated Custodian shows nothing between the two dates, so its Market value at the Close of the ex-dividend date (and any Business day before the pay date) is lower than a real statement's. The primer labels this as a simplification.

## Still open

- Whether the world adds an accrual (a receivable from the ex-dividend date, reversed on the pay date) is #47's decision. Interactive Brokers' Po and Re codes are a public model of one.
- Whether performance reports count accrued dividends is phase 2's question.
- Schwab's own wording wasn't read on a Schwab page, so it isn't relied on alone.
