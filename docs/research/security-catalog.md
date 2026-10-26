# The numbers behind the Security catalog

> Research notes gathered on 2026-10-26 for issue #183 (1.15b, the Security catalog), to give every number in the catalog a source. They inform the catalog but don't decide how prices are drawn: #46 does. Every claim below was read in the cited document, or in data downloaded from its publisher, unless the text says otherwise. A number marked **computed here** was worked out from such data by the method shown, not copied from a publication.

## Read this first

**US only.** The world has only US Factor returns (Kenneth French's Mkt-RF, SMB and HML) and only US Treasury yields. So every Security is a US one, and nothing in the inputs moves when another country's market falls alone. That is a labelled simplification. Real funds named below as sources often hold some foreign stocks or bonds, or corporate bonds; the catalog leaves those out.

**Fictional names.** The catalog uses invented names, with no real tickers, CUSIPs or ISINs. This note names real funds and papers only as the sources of numbers, so that anyone can look them up.

**How to read the numbers.** Each Security below is modelled on a real kind of fund or company. Its section ends with a table of the numbers the catalog will hold, as decimal strings. Terms, once:

- **Excess return** is a Return minus RF, what a one-month loan to the US government earned (the primer, Part 2).
- **Factor exposure** is how strongly a Security follows a factor. The papers call it a _loading_ or a _slope_. The catalog's three are `mkt_rf`, `smb` and `hml`. A `mkt_rf` of 1.10 means that when the market beats RF by 1%, the Security beats RF by about 1.10%.
- A **regression** is the best straight-line fit of one series of numbers to others. Here it fits a Security's monthly excess returns to the three Factor returns. The fit's slopes are the exposures.
- The **residual** is what's left of each month's return after the fit: the part the factors don't explain. **Own volatility** is the standard deviation of the residual (how much it varies from month to month).
- **Annualised, as a fraction.** The papers report the residual in percent per month. The catalog wants a year's worth, so each conversion is shown. This note uses one convention: **monthly standard deviation × √12** (the square root of 12 months), which assumes the months are independent. Example: 1.2% a month × √12 = 1.2% × 3.4641 = 4.157% a year = 0.0416. Daily figures would use √252 instead; none is used here.
- A **tenor** is how long until a Treasury security is repaid. The Treasury publishes yields for exactly these tenors: 1, 1.5, 2, 3, 4 and 6 months, and 1, 2, 3, 5, 7, 10, 20 and 30 years. The **par yield curve** is those yields drawn against the tenor.
- A **duration** says how much a bond's price moves when its yield moves. FINRA: "if a bond has a duration of 10 and interest rates increase by 1 percentage point, then that bond's price would be expected to decline by approximately 10 percent". It is "not to be confused with a bond's maturity", the date the bond repays.
- **Average maturity** is the average of the dates when a fund's bonds repay. A fund's duration is shorter than its average maturity, because bonds pay interest along the way.

**What kind of number is each?**

| Number                                                                  | Where it comes from                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exposures and own volatility of the growth, value and small stock funds | Computed here from real index funds, September 2016 to August 2026. Fama and French (1993), Table 6, is the published cross-check                                                                                                                    |
| Total-market exposures (Large blend)                                    | By definition of the market factor (published), checked against real funds (computed here)                                                                                                                                                           |
| Large blend own volatility; the Dividend stock fund's numbers           | Computed here from real funds' published daily values                                                                                                                                                                                                |
| Exposures of the six kinds of company                                   | Computed here from Ken French's industry portfolios, September 2016 to August 2026. The same regression for 1963 to 1994, the period Fama and French (1997) used, is each section's cross-check; their own table couldn't be read (see "Still open") |
| Own volatility of the six kinds of company                              | Published: Campbell, Lettau, Malkiel and Xu (2001), Table IV, combined by a sum shown in each section. It is measured over 1962 to 1997, not the window of the exposures                                                                             |
| Bond-fund durations (unrounded), balanced-fund weights                  | Published: the real funds' own fact sheets and prospectuses                                                                                                                                                                                          |
| Bond-fund Treasury tenors                                               | Chosen by a stated rule from published maturity ladders, then checked against the data                                                                                                                                                               |
| Bond-fund own volatility; balanced-fund own volatility                  | Computed here: a bond fund's residual around its published duration (the fitted-slope residual is the cross-check); a balanced fund's is worked out from its parts                                                                                   |

## Sources and how each was read

All were read on 2026-10-26. "pypdf" means the PDF's text was extracted with `uv run --no-project --with pypdf python -I <script>`, as `docs/agents/web-research.md` describes.

| Short name                  | What it is                                                                                                                                                                                                                                                                                                                                                                                                                            | How read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FF1993**                  | Fama and French, "Common risk factors in the returns on stocks and bonds", _Journal of Financial Economics_ 33 (1993) 3-56, [a copy hosted by the University of Houston](https://www.bauer.uh.edu/rsusmel/phd/Fama-French_JFE93.pdf)                                                                                                                                                                                                  | WebFetch saved the PDF (HEC's copy returned a 503). It is a scan with a garbled text layer, so Table 6 (journal pages 24 and 25, PDF pages 22 and 23) was rendered to images with PyMuPDF and the numbers read off the image. A replication from the data library (below) agrees within 0.08                                                                                                                                                                                                        |
| **FF library**              | [Kenneth French's data library](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html): the monthly three Factors (`F-F_Research_Data_Factors_CSV.zip`, "created using the 202608 CRSP database"), the 49 industry portfolios (`49_Industry_Portfolios_CSV.zip`, value-weighted monthly), the 25 size and book-to-market portfolios (`25_Portfolios_5x5_CSV.zip`) and the industry definitions (`Siccodes49.zip`) | WebFetch for the pages ([data library](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html), [factor definitions](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/f-f_factors.html), [industry assignment](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/det_48_ind_port.html)); `curl` for the zips. SHA-256 of the three data zips: `593f4fbe…0a66` (factors), `16b3f20b…1c0e` (49 industries), `e02edcd2…8429` (25 portfolios) |
| **CLMX2001**                | Campbell, Lettau, Malkiel and Xu, "Have individual stocks become more volatile?", _Journal of Finance_ (2001), [a copy at the University of Texas at Dallas](https://personal.utdallas.edu/~yexiaoxu/clmx1_44.pdf)                                                                                                                                                                                                                    | WebFetch saved the PDF; pypdf. Table IV (page 21) was also rendered to an image and its figures compared with the text                                                                                                                                                                                                                                                                                                                                                                              |
| **CLMX2022**                | The same authors, "Idiosyncratic equity risk two decades later", [NBER working paper 29916](https://www.nber.org/system/files/working_papers/w29916/w29916.pdf)                                                                                                                                                                                                                                                                       | WebFetch saved the PDF; pypdf                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **AHXZ**                    | Ang, Hodrick, Xing and Zhang, "The cross-section of volatility and expected returns", [NBER working paper 10852](https://www.nber.org/system/files/working_papers/w10852/w10852.pdf) (the _Journal of Finance_ version is 2006)                                                                                                                                                                                                       | WebFetch saved the PDF; pypdf. Read only for its definition of idiosyncratic volatility                                                                                                                                                                                                                                                                                                                                                                                                             |
| **CFA Digest**              | [A summary of Fama and French (1997)](https://rpc.cfainstitute.org/-/media/documents/article/cfa-digest/1997/dig-v27-n4-158-pdf.pdf), "Industry costs of equity", _Journal of Financial Economics_ 43 (1997) 153-93                                                                                                                                                                                                                   | `curl`, pypdf. It says the paper uses "monthly data on 48 U.S. industry groups for the 1963-94 period". It gives no months, so this note's cross-checks start in July 1963 (like FF1993's sample) and end in December 1994, which is this note's assumption                                                                                                                                                                                                                                         |
| **State Street fund data**  | For each fund: the daily NAV history (`navhist-us-en-<ticker>.xlsx`) and the fact sheet (`factsheet-us-en-<ticker>.pdf`), both under `www.ssga.com/library-content/products/`, as of 2026-09-30                                                                                                                                                                                                                                       | `curl` for both; the NAV files read with pandas and openpyxl, the fact sheets with pypdf. The product page of one fund was opened in a headless browser to look for a distribution-history file; none was found (see "Still open")                                                                                                                                                                                                                                                                  |
| **Treasury yields**         | The US Treasury's [Daily Treasury Par Yield Curve Rates](https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve&field_tdr_date_value=2025), 2006 to 2026-10-23, and its [Interest Rate Statistics](https://home.treasury.gov/policy-issues/financing-the-government/interest-rate-statistics) page                                                                       | WebFetch for both pages: the TextView page lists the 14 tenors in its column headers (1 Mo, 1.5 Mo, 2 Mo, 3 Mo, 4 Mo, 6 Mo, 1 Yr, 2 Yr, 3 Yr, 5 Yr, 7 Yr, 10 Yr, 20 Yr, 30 Yr), and the Interest Rate Statistics page says the rates are "obtained by the Federal Reserve Bank of New York at approximately 3:30 PM each business day". `curl` for the yearly CSV files, whose header row has the same 14 tenors                                                                                    |
| **iShares allocation ETFs** | The summary prospectuses of the [60/40 Balanced](https://www.ishares.com/us/literature/summary-prospectus/sp-ishares-core-growth-alloc-etf-7-31.pdf) and [40/60 Moderate](https://www.ishares.com/us/literature/summary-prospectus/sp-ishares-core-mod-alloc-etf-7-31.pdf) Allocation ETFs (both dated 28 November 2025), and their fact sheets as of 2026-09-30                                                                      | `curl`, pypdf                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Vanguard Balanced**       | The [summary prospectus of Vanguard Balanced Index Fund](https://advisors.vanguard.com/pub/Pdf/sp02.pdf), dated 28 April 2026                                                                                                                                                                                                                                                                                                         | `curl`, pypdf                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **FINRA duration**          | [FINRA: Interest Rate Changes and Duration](https://www.finra.org/investors/insights/bonds-interest-rate-changes-duration)                                                                                                                                                                                                                                                                                                            | WebFetch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **SEC pages**               | [Money Market Funds](https://www.investor.gov/introduction-investing/investing-basics/investment-products/mutual-funds-and-exchange-traded-5) and the [Cash Sweep Programs bulletin](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins/cash-sweep-programs-uninvested-cash-your-investment-accounts-investor-bulletin)                                                | WebFetch got a 403 on both; read with a headed agent-browser (step 3 of the ladder)                                                                                                                                                                                                                                                                                                                                                                                                                 |

### FF1993 Table 6, the cells used

This is the **published cross-check** for the four growth, value and small stock funds: the catalog's numbers for them are computed from real funds (below), and Table 6 shows the same signs and ordering. Its corner portfolios are more extreme than any fund. Each is one cell of a five-by-five sort of NYSE, Amex and NASDAQ stocks cut at NYSE breakpoints, so "Small / High" is the smallest, cheapest group, which includes very small companies, and "Big / Low" and "Big / High" are narrow slices (one size group and one style). An index fund holds a broader list, so its tilts can be milder than a corner's: the small funds' size exposures and the value fund's value exposure are, in the checks below (computed here).

Table 6 regresses the monthly excess returns of 25 portfolios on `RM-RF`, `SMB` and `HML`, "July 1963 to December 1991, 342 months". The portfolios are the five size groups crossed with the five book-to-market groups: The groups are cut at NYSE breakpoints, not at equal-count fifths of all stocks. The paper's note: "Each year t from 1963 to 1991 NYSE quintile breakpoints for size, ME, measured at the end of June, are used to allocate NYSE, Amex, and NASDAQ stocks to five size quintiles. Similarly, NYSE quintile breakpoints for BE/ME are used to allocate NYSE, Amex, and NASDAQ stocks to five book-to-market equity quintiles." So "Small" is the size group below the NYSE's first size breakpoint and "Big" the one above its fourth, and the groups hold unequal numbers of stocks. "Low" is the group with the lowest book-to-market ratio (growth stocks) and "High" the highest (value stocks), cut the same way. The paper's note says "R² and the residual standard error, s(e), are adjusted for degrees of freedom". Here are the Small and Big rows, with b the market exposure, s the SMB exposure, h the HML exposure and s(e) the residual standard deviation in percent per month, as printed:

| Size / book-to-market | b    | s     | h     | s(e) |
| --------------------- | ---- | ----- | ----- | ---- |
| Small / Low           | 1.04 | 1.46  | -0.29 | 1.94 |
| Small / 2             | 1.02 | 1.26  | 0.08  | 1.44 |
| Small / 3             | 0.95 | 1.19  | 0.26  | 1.16 |
| Small / 4             | 0.91 | 1.17  | 0.40  | 1.12 |
| Small / High          | 0.96 | 1.23  | 0.62  | 1.22 |
| Big / Low             | 0.96 | -0.17 | -0.46 | 1.16 |
| Big / 2               | 1.02 | -0.12 | 0.00  | 1.32 |
| Big / 3               | 0.98 | -0.23 | 0.21  | 1.55 |
| Big / 4               | 0.99 | -0.17 | 0.57  | 1.36 |
| Big / High            | 1.06 | -0.05 | 0.76  | 2.02 |

As a check, the same regression on the library's 25 portfolios over the same months gave Small / 3 = 0.95, 1.16, 0.28, 1.21, Small / High = 0.95, 1.19, 0.62, 1.20, Big / Low = 0.96, -0.20, -0.44, 1.22, Big / 3 = 0.97, -0.26, 0.20, 1.63 and Big / High = 1.04, -0.05, 0.77, 1.95 (computed here). Every figure is within 0.08 of the printed one. The library "reconstruct[s] the full history of returns each month", so a rerun later can differ in the last digit.

### The method for the computed numbers

**Every computed exposure in this note uses one window, September 2016 to August 2026, and one monthly regression.** Where a number is computed from a real fund, it is the same every time:

1. **Data.** The fund's daily NAV (net asset value per share, the price the fund is worth at the Close) from State Street's file, turned into a monthly price Return from the last NAV of each month. Days where the NAV jumped by more than 25% in one day were stock splits or data errors and were skipped, which drops that day's Return (one such day in the window for each of eight of the funds: 16 October 2017 for six, 13 June 2018 for one, 23 September 2019 for one; none for the rest). The three Factors and RF are the library's monthly file.
2. **Window.** September 2016 to August 2026, 120 months, the last 120 months for which the library has Factors. Every fund started before it. (The cross-checks for the industries use 1963 to 1994; they are labelled.)
3. **Stock funds.** Regress the fund's monthly excess return on `Mkt-RF`, `SMB`, `HML` and a dummy for the months of March, June, September and December. The dummy is needed because the NAV is a price, so it falls on each quarterly dividend date; the dummy absorbs that average fall (it came out at -0.28% to -0.87% a month). The residual standard deviation, df-adjusted, × √12 is the own volatility.
4. **Industry portfolios.** For a kind of company, the same regression as for a stock fund, with no dummy, on the excess return of Ken French's value-weighted industry portfolio (monthly, from the 49-industry file). Standard errors are the ordinary least-squares ones.
5. **Bond funds.** The own volatility is measured around the catalog's own driver, so the duration is **held at the fund's published value** (the fact sheet's, unrounded). Each month's residual is the fund's monthly price Return (percent) minus (minus the published duration × the month's change in one Treasury par yield, in percentage points), less the average of those differences (an intercept, which absorbs the interest the fund earns and pays out each month). The own volatility is the standard deviation of those residuals (n - 1 in the divisor) × √12. The Treasury yield is the last par yield of the month. As a labelled cross-check, the same regression is also run with the duration free: its slope is the duration the data imply, and its residual is the own volatility at the best-fitting slope.
6. **Limits.** A price Return leaves out the dividends the fund paid, which is why the dummy and intercept are there; no distribution-history file was found, so no total Return was built. The fund's NAV is struck at the Close and the Treasury's yields are taken at about 3:30 PM, a gap that adds a little to the residual.

## Large blend stock fund

**Modelled on:** a fund that holds the whole US stock market, weighted by company size (a "total market" or "large blend" index fund). This is the world's existing Larkspur Stock Fund, `LKSF`. Real examples used as checks: the SPDR Portfolio S&P 1500 Composite Stock Market ETF (1,510 holdings, "correspond generally to the total return performance of the S&P Composite 1500 Index") and the SPDR S&P 500 ETF Trust (504 holdings).

**Exposures: published, by definition.** The market factor is "the excess return on the market, value-weight return of all CRSP firms incorporated in the US" (FF library). A fund that held exactly that market would earn exactly Mkt-RF as its excess return, which means exposures of 1 to the market and 0 to SMB and HML, by construction. FF1993 builds its market return the same way: `RM` is "the value-weighted percent monthly return on all the stocks in the 25 size-BE/ME portfolios, plus the negative-BE stocks excluded from the 25 portfolios" (Table 6, note a), so the market is the sum of all the styles.

**Check on a real fund (computed here, window above):** the S&P 1500 fund gives `b` 0.99, `s` -0.06, `h` 0.04 (R² 0.996); the S&P 500 fund gives 0.99, -0.14, 0.01. So a real market fund sits within 0.14 of (1, 0, 0); the largest gap is the S&P 500 fund's tilt toward large companies (`s` -0.14).

**Own volatility: computed here.** The residual of those two regressions is 0.294% and 0.276% a month. 0.294% × √12 = 1.018% = 0.0102 (S&P 1500) and 0.276% × √12 = 0.955% = 0.0096 (S&P 500). The catalog uses 0.010. An earlier window (January 2007 to August 2016) gave 0.0055 for the S&P 1500 fund, so the figure depends on the period; the recent one is used.

FF1993's Big / 3 portfolio (0.98, -0.23, 0.21, s(e) 1.55 = 0.054 a year) is a _slice_ of the market, one size and one style, so it has much more own noise than a fund holding every style. It is not used for this Security.

| mkt_rf | smb    | hml    | own_volatility |
| ------ | ------ | ------ | -------------- |
| "1.00" | "0.00" | "0.00" | "0.010"        |

## Large growth stock fund

**Modelled on:** a fund of the largest US companies whose prices are high relative to their book value (growth stocks): the SPDR Portfolio S&P 500 Growth ETF (151 holdings; "correspond generally to the total return performance of the S&P 500 Growth Index", fact sheet of 30 September 2026).

**Numbers: computed here** from that one fund (method above, September 2016 to August 2026; one fund: the only daily NAV files read were State Street's, since an iShares page was tried and no NAV download was found there): `b` 1.0641 (standard error 0.021), `s` -0.1895 (0.035), `h` -0.2926 (0.024), R² 0.963, residual 0.994% a month. Own volatility: 0.994% × √12 = 3.443% a year = 0.034.

**How derived:** exposures rounded to two places (1.0641 → 1.06, -0.1895 → -0.19, -0.2926 → -0.29), own volatility to three (0.0344 → 0.034).

**Published cross-check (FF1993 Table 6, Big / Low):** b 0.96, s -0.17, h -0.46, s(e) 1.16% a month × √12 = 4.018% = 0.040. Same signs (growth means a negative `hml`). The 1963-91 corner portfolio has a stronger growth tilt than the fund (-0.46 against -0.29) for the reason given in the Table 6 note above.

| mkt_rf | smb     | hml     | own_volatility |
| ------ | ------- | ------- | -------------- |
| "1.06" | "-0.19" | "-0.29" | "0.034"        |

## Large value stock fund

**Modelled on:** a fund of the largest US companies whose prices are low relative to their book value (value stocks): the SPDR Portfolio S&P 500 Value ETF (436 holdings; "S&P 500 Value Index").

**Numbers: computed here** from that one fund (same method and window; one fund, as above): `b` 0.8963 (0.025), `s` -0.0557 (0.040), `h` 0.3587 (0.027), R² 0.937, residual 1.141% a month. Own volatility: 1.141% × √12 = 3.953% = 0.040.

**How derived:** rounded: 0.8963 → 0.90, -0.0557 → -0.06, 0.3587 → 0.36; own volatility 0.0395 → 0.040.

**Published cross-check (FF1993 Table 6, Big / High):** b 1.06, s -0.05, h 0.76, s(e) 2.02% × √12 = 6.998% = 0.070. Same signs; the 1963-91 corner portfolio is much more value-tilted (0.76 against 0.36) and has more own noise (0.070 against 0.040).

| mkt_rf | smb     | hml    | own_volatility |
| ------ | ------- | ------ | -------------- |
| "0.90" | "-0.06" | "0.36" | "0.040"        |

## Small blend stock fund

**Modelled on:** a fund of small US companies with a mix of growth and value: the SPDR Portfolio S&P 600 Small Cap ETF (607 holdings, average market value $4.3 billion; "S&P SmallCap 600 Index").

**Numbers: computed here** from that one fund (same method and window; one fund, as above): `b` 0.9740 (0.021), `s` 0.8377 (0.035), `h` 0.3949 (0.023), R² 0.974, residual 0.983% a month. Own volatility: 0.983% × √12 = 3.405% = 0.034.

**How derived:** rounded: 0.9740 → 0.97, 0.8377 → 0.84, 0.3949 → 0.39; own volatility 0.0340 → 0.034. In plain words, a small-company fund follows the market (0.97), has a large size exposure (0.84) and leans to value (0.39). Why it leans to value isn't something the sources say; the 0.39 is the data.

**Published cross-check (FF1993 Table 6, Small / 3):** b 0.95, s 1.19, h 0.26, s(e) 1.16% × √12 = 4.018% = 0.040. Same signs; the corner portfolio's size exposure is larger (1.19 against 0.84) because the smallest size group (below the NYSE's first size breakpoint) includes much smaller companies than this index.

| mkt_rf | smb    | hml    | own_volatility |
| ------ | ------ | ------ | -------------- |
| "0.97" | "0.84" | "0.39" | "0.034"        |

## Small value stock fund

**Modelled on:** a fund of small US companies with low prices relative to book value: the SPDR S&P 600 Small Cap Value ETF (463 holdings; "S&P SmallCap 600 Value Index").

**Numbers: computed here** from that one fund (same method and window; one fund, as above): `b` 0.9927 (0.022), `s` 0.8876 (0.036), `h` 0.5894 (0.024), R² 0.976, residual 1.012% a month. Own volatility: 1.012% × √12 = 3.506% = 0.035.

**How derived:** rounded: 0.9927 → 0.99, 0.8876 → 0.89, 0.5894 → 0.59; own volatility 0.0351 → 0.035.

**Published cross-check (FF1993 Table 6, Small / High):** b 0.96, s 1.23, h 0.62, s(e) 1.22% × √12 = 4.226% = 0.042. Almost the same value exposure (0.62 against 0.59); the corner portfolio's size exposure is larger (1.23 against 0.89): the smallest size group holds much smaller companies than this index.

| mkt_rf | smb    | hml    | own_volatility |
| ------ | ------ | ------ | -------------- |
| "0.99" | "0.89" | "0.59" | "0.035"        |

## Dividend stock fund

**Modelled on:** a US fund that picks stocks for the dividends they pay, in two real versions averaged: the SPDR S&P Dividend ETF (155 holdings, an index that "screens for companies that have consistently increased their dividend for at least 20 consecutive years", index dividend yield 3.02%) and the SPDR Portfolio S&P 500 High Dividend ETF (78 holdings, "the top 80 high dividend-yielding companies within the S&P 500", yield 4.71%). The paper's tables have no portfolio sorted on dividends, and no published regression of a dividend fund was found, so these are **computed here** (method above).

| Real fund (window Sep 2016 to Aug 2026) | b      | s      | h      | Own volatility | Calculation of own volatility |
| --------------------------------------- | ------ | ------ | ------ | -------------- | ----------------------------- |
| Dividend-growth fund                    | 0.762  | 0.042  | 0.400  | 0.0618         | 1.784% × √12 = 6.18%          |
| High-dividend fund                      | 0.866  | 0.128  | 0.680  | 0.0689         | 1.990% × √12 = 6.89%          |
| Average                                 | 0.8142 | 0.0848 | 0.5399 | 0.0654         |                               |

**How derived:** the average of the two funds, rounded to two places (0.8142 → 0.81, 0.0848 → 0.08, 0.5399 → 0.54) and, for own volatility, to three (0.0654 → 0.065). In plain words: a dividend fund buys steadier, cheaper companies, so it moves less than the market (exposure 0.81) and leans toward value (0.54). It has far more own noise than a total-market fund (0.065 against 0.010); both real funds hold only 78 to 155 companies.

| mkt_rf | smb    | hml    | own_volatility |
| ------ | ------ | ------ | -------------- |
| "0.81" | "0.08" | "0.54" | "0.065"        |

## Utility company

**Modelled on:** a US company that sells electricity, gas or water: Ken French's "Utilities" industry, SIC codes 4900 to 4942 (electric services, natural gas transmission and distribution, water supply).

**Exposures: computed here** (industry method above) from the FF library's value-weighted "Util" portfolio, September 2016 to August 2026 (120 months): b 0.55, s -0.24, h 0.24 (standard errors 0.07, 0.12, 0.08; R² 0.35). In plain words, utilities move far less than the market, behave like big companies, and lean to value.

**Cross-check, 1963 to 1994 (computed here, July 1963 to December 1994, 378 months: the years FF1997 used per the CFA Digest, with the months assumed):** b 0.77, s -0.26, h 0.42 (standard errors 0.03, 0.05, 0.05). Same signs; the market exposure is lower in the recent window.

**Own volatility: published, combined here, and from a different period.** CLMX2001 Table IV, row "Utilities": industry-level variance ("IND") mean 0.311 and firm-level variance ("FIRM") mean 4.032. The table's note says "Monthly variances are annualized (multiplied by 12). Means and standard deviations of the annualized variances are multiplied by 100 in this table", so the variances are 0.00311 and 0.04032. "IND" is the industry's own variance after taking out its link to the market, and "FIRM" is the variance of a typical firm's return around its industry's, both value-weighted over firms, **measured over 1962 to 1997, not over the 2016 to 2026 window of the exposures**. Firm-level variance can't be worked out from industry portfolios, so no recent figure was computed. A single company's part that the three factors don't explain is its industry's part plus its own firm-level part. Sum: 0.00311 + 0.04032 = 0.04343; square root = 0.2084. The catalog uses 0.208.

A cross-check, computed here. CLMX2001's "IND" is measured against the market only, so with SMB and HML in the model it should be a little smaller still. But the three-factor residual of French's "Util" portfolio over 1963 to 1994 has a variance of 0.00775 a year (monthly residual × √12, squared), more than twice "IND". The two measure the industry differently (daily data against monthly, their industry grouping against the library's), and this note didn't find the cause. Adding the same firm part to the computed figure gives sqrt(0.00775 + 0.04032) = 0.2192, 0.011 above the published-only sum. For the six kinds of company the gap is between -0.002 and +0.016, shown in each section. The published-only sum is the one a reader can check from the paper alone, so the catalog uses it.

| mkt_rf | smb     | hml    | own_volatility |
| ------ | ------- | ------ | -------------- |
| "0.55" | "-0.24" | "0.24" | "0.208"        |

## Software company

**Modelled on:** a US company that writes computer software and sells software services: Ken French's "Softw" industry ("Computer Software": SIC 7370 to 7372 computer programming and data processing, 7373 integrated systems design, 7375 information retrieval services). An earlier draft of this note swapped this for a computer-hardware company, because over 1963 to 1994 this portfolio's series is short and behaves like a thin, small-company one (below). Over 2016 to 2026 it fits the three factors well (R² 0.84), so the original kind of company is kept.

**Exposures: computed here** from the "Softw" portfolio, September 2016 to August 2026 (120 months): b 1.10, s -0.25, h -0.49 (standard errors 0.05, 0.08, 0.06; R² 0.84). In plain words, a little more sensitive to the market than average, big companies, and strongly growth-like.

**Cross-check, 1963 to 1994 (computed here):** b 1.26, s 1.84, h -0.66 over 354 months (the portfolio starts in July 1965; standard errors 0.13, 0.19, 0.21; residual 0.33 a year). The growth sign agrees, but the size exposure is the opposite (1.84 against -0.25). The "Hardw" portfolio ("Computers": SIC 3570 to 3579 and 3680 to 3689), possibly the other half of CLMX2001's "Computer" industry, whose grouping wasn't read, gives b 1.15, s -0.07, h -0.07 over 2016 to 2026 and 0.90, 0.13, -0.43 over 1963 to 1994.

**Own volatility: published, combined here, and from a different period.** CLMX2001 has no software row; its "Computer" row is the nearest (its industry grouping, which this note couldn't read, presumably covers both software and hardware firms). Table IV, "Computer": IND 1.654, FIRM 6.123 → variances 0.01654 and 0.06123, measured over 1962 to 1997, not 2016 to 2026. Sum 0.07777; square root 0.2789. The catalog uses 0.279. (With the Hardw portfolio's own 1963 to 1994 three-factor residual variance, 0.01574, instead of 0.01654: sqrt(0.07697) = 0.2774.)

| mkt_rf | smb     | hml     | own_volatility |
| ------ | ------- | ------- | -------------- |
| "1.10" | "-0.25" | "-0.49" | "0.279"        |

## Bank

**Modelled on:** a US company that takes deposits and makes loans: Ken French's "Banks" industry ("Banking": SIC 6000 and up, depository institutions, commercial banks, savings institutions, credit unions).

**Exposures: computed here** from the "Banks" portfolio, September 2016 to August 2026: b 1.08, s 0.22, h 0.70 (standard errors 0.05, 0.09, 0.06; R² 0.85). In plain words, banks move a little more than the market, lean slightly to smaller companies, and are strongly value.

**Cross-check, 1963 to 1994 (computed here, 378 months):** b 1.16, s -0.02, h 0.35 (standard errors 0.04, 0.06, 0.07). Same signs for the market and value; the value exposure is larger in the recent window.

**Own volatility: published, combined here, and from a different period.** CLMX2001 has no "banks" row. Its "Fin. Services" row is the nearest. CLMX2001 groups firms "according to the classification scheme in Fama and French (1997)", whose SIC list wasn't read, so the match to French's "Banks" is by name only and "Fin. Services" may cover more than banks. CLMX2001 says the industry with the most firms is "Financial Services with 628 (increasing from 43 to 1,525 over the sample)", so it is probably a broad financial group that holds many non-bank firms, broader than French's "Banks". Treat the own volatility as approximate, and as a financial-sector figure rather than a bank one. IND 0.362, FIRM 6.361 → 0.00362 and 0.06361, measured over 1962 to 1997. Sum 0.06723; square root 0.2593. The catalog uses 0.259. (With the banks portfolio's own 1963 to 1994 three-factor residual variance, 0.01211: sqrt(0.01211 + 0.06361) = 0.2752.)

| mkt_rf | smb    | hml    | own_volatility |
| ------ | ------ | ------ | -------------- |
| "1.08" | "0.22" | "0.70" | "0.259"        |

## Pharmaceutical company

**Modelled on:** a US company that makes medicines: Ken French's "Drugs" industry ("Pharmaceutical Products": SIC 2830 to 2836, drugs, biological products, medicinal chemicals).

**Exposures: computed here** from the "Drugs" portfolio, September 2016 to August 2026: b 0.55, s 0.01, h -0.02 (standard errors 0.08, 0.13, 0.09; R² 0.34). In plain words, far less sensitive to the market than average and neutral on size and style. The fit is loose (R² 0.34), so these exposures are uncertain by about 0.1.

**Cross-check, 1963 to 1994 (computed here, 378 months):** b 0.89, s -0.28, h -0.56 (standard errors 0.04, 0.06, 0.06). The market exposure agrees in direction (below 1); the 1963 to 1994 growth tilt is not present in the recent window.

**Own volatility: published, combined here, and from a different period.** CLMX2001 Table IV, "Pharmaceutical": IND 0.792, FIRM 6.126 → 0.00792 and 0.06126, measured over 1962 to 1997. Sum 0.06918; square root 0.2630. The catalog uses 0.263. (With the portfolio's own 1963 to 1994 three-factor residual variance, 0.01030: 0.2675.)

| mkt_rf | smb    | hml     | own_volatility |
| ------ | ------ | ------- | -------------- |
| "0.55" | "0.01" | "-0.02" | "0.263"        |

## Oil and gas company

**Modelled on:** a US company that finds, produces or refines oil and natural gas: Ken French's "Oil" industry ("Petroleum and Natural Gas": SIC 1300 to 1389 extraction and field services, and 2900 to 2912 refining).

**Exposures: computed here** from the "Oil" portfolio, September 2016 to August 2026: b 0.99, s 0.26, h 1.21 (standard errors 0.13, 0.21, 0.14; R² 0.56). The size exposure is within its own error of zero. The value exposure is very high.

**Cross-check, 1963 to 1994 (computed here, 378 months):** b 0.96, s -0.39, h 0.18 (standard errors 0.05, 0.07, 0.08). The market exposure agrees; value was small then. This industry's exposure to value changed a lot between the two periods, which is why each number is labelled by its period.

**Own volatility: published, combined here, and from a different period.** CLMX2001 Table IV, "Petroleum/Gas": IND 1.013, FIRM 5.498 → 0.01013 and 0.05498, measured over 1962 to 1997. Sum 0.06511; square root 0.2552. The catalog uses 0.255. (With the portfolio's own 1963 to 1994 three-factor residual variance, 0.01521: 0.2649.)

| mkt_rf | smb    | hml    | own_volatility |
| ------ | ------ | ------ | -------------- |
| "0.99" | "0.26" | "1.21" | "0.255"        |

## Retailer

**Modelled on:** a US company that sells goods to shoppers: Ken French's "Rtail" industry ("Retail": SIC 5200 and up, building materials, general merchandise, department stores, variety stores, food stores).

**Exposures: computed here** from the "Rtail" portfolio, September 2016 to August 2026: b 1.01, s -0.03, h -0.30 (standard errors 0.06, 0.10, 0.06; R² 0.76). In plain words, about as sensitive as the market, neutral on size, and growth-like.

**Cross-check, 1963 to 1994 (computed here, 378 months):** b 1.04, s 0.23, h -0.06 (standard errors 0.04, 0.06, 0.06). The market exposure agrees; the growth tilt is stronger in the recent window.

**Own volatility: published, combined here, and from a different period.** CLMX2001 Table IV, "Retail": IND 0.586, FIRM 7.332 → 0.00586 and 0.07332, measured over 1962 to 1997. Sum 0.07918; square root 0.2814. The catalog uses 0.281. (With the portfolio's own 1963 to 1994 three-factor residual variance, 0.01030: 0.2892.)

| mkt_rf | smb     | hml     | own_volatility |
| ------ | ------- | ------- | -------------- |
| "1.01" | "-0.03" | "-0.30" | "0.281"        |

**A check on all six own volatilities, and a mismatch to know about.** The own volatilities are firm-level measures from 1962 to 1997, while the exposures are from 2016 to 2026. CLMX2022 gives a bridge: "the average level of value-weighted idiosyncratic volatility since 1997 is 28%, lower than the levels reached at the end of the CLMX period but still slightly higher than the average of 26% during that period" for a typical US stock (their "idiosyncratic" is a firm's return around the market and its industry, not around the three Factors). The six values, 0.208 to 0.281, sit around that, so the older figures are not out of line with the later period. AHXZ defines the same idea relative to the three-factor model: "We define idiosyncratic risk as √var(εit)", the residual of a regression on the three Factors, which is the catalog's definition too.

## Short-term Treasury fund

**Modelled on:** a fund of US Treasury notes with 1 to 3 years left: the SPDR Portfolio Short Term Treasury ETF, tracking the "Bloomberg 1-3 Year U.S. Treasury Index".

**Duration: published.** Fact sheet as of 30 September 2026: "Option Adjusted Duration 1.85". The fact sheet's glossary calls this "effective duration" and says it is "calculated as the average percentage change in a bond's value (price plus accrued interest) under shifts of the Treasury curve +/- 100 bps". The catalog keeps it as printed: 1.85.

**Tenor: chosen by a rule, then checked.** The rule, used for all four bond funds: the published Treasury tenor closest to the fund's average maturity, which the fact sheet's "Maturity Ladder" gives in bands (the average is estimated from each band's midpoint). Ladder: 0 to 1 year 0.04%, 1 to 2 years 56.48%, 2 to 3 years 43.49% → about 1.9 years. Nearest tenor: 2 years. Check (computed here): of the Treasury yields for 1, 2 and 3 years, the 2-year and 3-year fit best (R² 0.90 and 0.92, against 0.65 for 1 year).

**Own volatility: computed here** (bond method above; tenor 2 years), with the duration held at 1.85. The residual is the fund's monthly price Return minus (-1.85 × the month's change in the 2-year par yield), less its average (0.012% a month). Its standard deviation is 0.1489% a month × √12 = 0.516% = 0.0052. The catalog uses 0.005. **Cross-check at the fitted slope:** the data's own duration is 1.75 (standard error 0.05, within 0.1 of the published 1.85), R² 0.90, residual 0.147% × √12 = 0.510% = 0.0051.

| tenor | duration | own_volatility |
| ----- | -------- | -------------- |
| 2     | "1.85"   | "0.005"        |

## Intermediate-term Treasury fund

**Modelled on:** a fund of US Treasury notes with 3 to 10 years left: the SPDR Portfolio Intermediate Term Treasury ETF, tracking the "Bloomberg 3-10 Year U.S. Treasury Index". This is the world's existing Larkspur Bond Fund, `LKBF`.

**Duration: published.** Fact sheet as of 30 September 2026: "Option Adjusted Duration 4.83", kept as printed: 4.83.

**Tenor.** Ladder: 3 to 5 years 48.93%, 5 to 7 years 29.76%, 7 to 10 years 21.31% → about 5.55 years (midpoints 4, 6 and 8.5: 0.4893 × 4 + 0.2976 × 6 + 0.2131 × 8.5 = 5.55). That is 0.55 from the 5-year tenor and 1.45 from the 7-year one, so the tenor is 5. Check (computed here): the 5-year yield fits best (R² 0.976, against 0.911 for 3 years, 0.972 for 7 years and 0.932 for 10 years).

**Own volatility: computed here** (tenor 5 years), with the duration held at 4.83. The residual is the fund's monthly price Return minus (-4.83 × the month's change in the 5-year par yield), less its average (0.064% a month). Its standard deviation is 0.1950% a month × √12 = 0.676% = 0.0068. The catalog uses 0.007. **Cross-check at the fitted slope:** 4.82 (standard error 0.07; published 4.83), R² 0.976, residual 0.196% × √12 = 0.679% = 0.0068.

| tenor | duration | own_volatility |
| ----- | -------- | -------------- |
| 5     | "4.83"   | "0.007"        |

## Long-term Treasury fund

**Modelled on:** a fund of US Treasury bonds with 10 or more years left: the SPDR Portfolio Long Term Treasury ETF, tracking the "Bloomberg Long U.S. Treasury Index" (remaining maturity of 10 years or more).

**Duration: published.** Fact sheet as of 30 September 2026: "Option Adjusted Duration 13.57", kept as printed: 13.57.

**Tenor.** Ladder: 10 to 15 years 11.56%, 15 to 20 years 35.09%, 20 to 30 years 53.32% (and 0.04% under a year) → about 20.9 years (midpoints 12.5, 17.5 and 25). Nearest tenor: 20 years. Check (computed here): 20-year R² 0.984, against 0.918 for 10 years and 0.980 for 30 years.

**Own volatility: computed here** (tenor 20 years), with the duration held at 13.57. The residual is the fund's monthly price Return minus (-13.57 × the month's change in the 20-year par yield), less its average (0.057% a month). Its standard deviation is 0.7188% a month × √12 = 2.490% = 0.0249, so the catalog uses 0.025. **Cross-check at the fitted slope:** the data's own slope over the last 120 months is 15.99 (standard error 0.19), higher than the published 13.57, and the residual there is 0.465% × √12 = 1.611% = 0.0161 (R² 0.984). The held-fixed figure is about 55% larger because the published duration is lower than the slope the data show, so it contains that gap as well as true own noise. Split into halves, the slope is 16.89 for September 2016 to August 2021 and 15.42 for September 2021 to August 2026 (standard error 0.25 each), so it fell but didn't reach 13.57. Two possible reasons for the gap, neither established here: the fund's duration may have been longer when yields were lower, and one 20-year yield is only a proxy for a fund holding bonds of 10 to 30 years. The catalog keeps the published duration and the residual around it, as the definition of own volatility requires.

| tenor | duration | own_volatility |
| ----- | -------- | -------------- |
| 20    | "13.57"  | "0.025"        |

## Aggregate bond fund

**Modelled on:** a fund of the whole US investment-grade bond market: the SPDR Portfolio Aggregate Bond ETF, tracking the "Bloomberg U.S. Aggregate Bond Index" ("US dollar denominated investment grade bonds including government bonds, corporate bonds, mortgage pass-through securities, commercial mortgage backed securities and asset backed securities"; 8,561 holdings). **The catalog models it as following one Treasury tenor, and its credit risk is left out**: the chance that a company or a home-loan pool doesn't pay, and the price changes that come when the market's fear of that changes. (The fact sheet's quality breakdown of 30 September 2026 is Aaa 3.50%, Aa 70.88%, A 11.48%, Baa 11.47% and not rated 2.67%.) Whatever those effects add to the fund's movements stays in its own volatility, below.

**Duration: published.** Fact sheet as of 30 September 2026: "Option Adjusted Duration 5.77", kept as printed: 5.77.

**Tenor.** The fact sheet's ladder (0 to 1 year 0.21%, 1 to 2 years 13.16%, 2 to 3 years 10.39%, 3 to 5 years 18.59%, 5 to 7 years 12.13%, 7 to 10 years 27.75%, 10 to 15 years 2.81%, 15 to 20 years 5.22%, 20 to 30 years 9.05%, over 30 years 0.69%) gives an average maturity of about 8.0 years (midpoints 0.5, 1.5, 2.5, 4, 6, 8.5, 12.5, 17.5, 25 and 30). Vanguard Balanced's prospectus says of the Bloomberg U.S. Aggregate Float Adjusted Index, a close variant of the plain Aggregate index this fund tracks: "As of December 31, 2025, the dollar-weighted average maturity of the Bond Target Index was 8.1 years". 8.0 is 1.0 from 7 and 2.0 from 10, so the tenor is 7. Check (computed here): R² is 0.82 for 5 years, 0.86 for 7 years and 0.87 for 10 years, so the 7-year yield explains nearly as much as the best.

**Own volatility: computed here** (tenor 7 years), with the duration held at 5.77. The residual is the fund's monthly price Return minus (-5.77 × the month's change in the 7-year par yield), less its average (0.024% a month). Its standard deviation is 0.5592% a month × √12 = 1.937% = 0.0194. The catalog uses 0.019. **Cross-check at the fitted slope:** 5.34 (standard error 0.20; published 5.77), R² 0.86, residual 0.551% × √12 = 1.908% = 0.0191. This is the largest of the four bond funds' own volatilities at the fitted slope, and the second largest held fixed (the long fund's is larger), because it carries the credit and prepayment effects named above.

| tenor | duration | own_volatility |
| ----- | -------- | -------------- |
| 7     | "5.77"   | "0.019"        |

## 60/40 balanced fund

**Modelled on:** a fund that keeps a fixed 60% in stocks and 40% in bonds. Two real ones agree:

- Vanguard Balanced Index Fund: "With 60% of its assets, Vanguard Balanced Index Fund (the "Fund") seeks to track the performance of a benchmark index that measures the investment return of the overall U.S. stock market. With 40% of its assets, the Fund seeks to track the performance of a broad, market-weighted bond index" (summary prospectus, 28 April 2026). Its stocks are the CRSP US Total Market Index and its bonds the Bloomberg U.S. Aggregate Float Adjusted Index.
- iShares Core 60/40 Balanced Allocation ETF: "the Underlying Index included a fixed allocation of 60% of its assets in Underlying Funds that invest primarily in equity securities and 40% of its assets in Underlying Funds that invest primarily in bonds" (summary prospectus, 28 November 2025). These funds also hold foreign stocks and bonds, which the world leaves out.

**Weights: published.** 0.60 in the factors part, 0.40 in the Treasury part.

**The two parts.** The factors part is the whole US stock market, as in Vanguard's fund: the Large blend stock fund's exposures (1.00, 0.00, 0.00). The Treasury part is the broad bond index Vanguard's fund also tracks, as in the Aggregate bond fund: tenor 7, duration 5.77.

**Own volatility: derived here from the parts.** If the stock part's own noise (0.010, from the Large blend section) and the bond part's (0.019, from the Aggregate section, which holds its duration at 5.77) don't move together, a mix of 0.60 and 0.40 has own variance (0.60 × 0.010)² + (0.40 × 0.019)² = 0.000036 + 0.00005776 = 0.00009376, and the square root is 0.0097 (0.0098 with the unrounded 0.0194). The catalog uses 0.010. The independence is an assumption, not measured.

| weight_factors | weight_treasury | mkt_rf | smb    | hml    | tenor | duration | own_volatility |
| -------------- | --------------- | ------ | ------ | ------ | ----- | -------- | -------------- |
| "0.60"         | "0.40"          | "1.00" | "0.00" | "0.00" | 7     | "5.77"   | "0.010"        |

## 40/60 conservative balanced fund

**Modelled on:** a fund that keeps a fixed 40% in stocks and 60% in bonds: the iShares Core 40/60 Moderate Allocation ETF. Its summary prospectus (28 November 2025): "the Underlying Index included a fixed allocation of 40% of its assets in Underlying Funds that invest primarily in equity securities and 60% of its assets in Underlying Funds that invest primarily in bonds". The fund also holds foreign stocks and bonds (its fact sheet of 30 September 2026 shows 67.54% in the United States), which the world leaves out.

**Weights: published.** 0.40 factors, 0.60 Treasury.

**The two parts and own volatility.** The same parts as the 60/40 fund (Treasury part: tenor 7, duration 5.77). Own variance (0.40 × 0.010)² + (0.60 × 0.019)² = 0.000016 + 0.00012996 = 0.00014596; the square root is 0.0121 (0.0123 with the unrounded 0.0194). The catalog uses 0.012. The same independence assumption applies.

| weight_factors | weight_treasury | mkt_rf | smb    | hml    | tenor | duration | own_volatility |
| -------------- | --------------- | ------ | ------ | ------ | ----- | -------- | -------------- |
| "0.40"         | "0.60"          | "1.00" | "0.00" | "0.00" | 7     | "5.77"   | "0.012"        |

## Cash sweep

**Modelled on:** the way a brokerage sweeps uninvested cash into a money market fund or a bank deposit. This is the world's existing Larkspur Bank Sweep, `SWEEP`. **No numbers: the price driver is "none".**

**Why the world's sweep is priced at $1.00.** The SEC says of money market funds: "Most money market funds ... seek to keep their NAV at a stable $1.00 per share. This means investors can generally buy and sell shares of these types of money market funds for $1.00", and if the NAV "deviates by more than half a cent from $1.00, the fund must re-price its shares", which is "breaking the buck". Not every money market fund works that way: the SEC page says institutional prime and institutional tax-exempt money market funds "must 'float' their NAV like other mutual funds". The world's sweep is called a bank sweep, and the SEC says a bank sweep puts the cash in "a deposit account at one or more banks". A deposit is a dollar amount, so it has no other price: that is why the catalog gives the sweep no exposures, no tenor and no own volatility, and why the world holds it at exactly $1.00. What it earns is interest on top. The SEC: bank sweep cash "generally earns interest at a variable interest rate", while money market funds "pay dividends that generally reflect short term interest rates". How that interest accrues and is paid is the world's choice (#47): the primer's Part 5 quotes a real Pershing sweep agreement, "Interest is compounded daily and credited to your account monthly", which this note did not re-read, and the world follows it. The Sweep rate is #47's too.

| price driver | numbers |
| ------------ | ------- |
| none         | none    |

## Still open

**Simplifications the catalog keeps, to be labelled in its docs:**

- **US only.** No foreign stocks or bonds, no credit risk (the Aggregate fund's is folded into its own volatility), no inflation-linked or floating-rate bonds. The balanced funds' real examples hold foreign assets.
- **A kind of company, not a company.** The six sets of exposures describe an industry's value-weighted portfolio; a single firm's exposures differ and drift. Own volatility is meant to cover the difference.
- **Each Security's numbers are fixed once.** Exposures, durations and own volatilities in real life change from year to year (the Oil exposure to value differs 0.18 and 1.21 between 1963 to 1994 and 2016 to 2026; the Long-term fund's published duration is 13.57 against 15.99 fitted over 2016 to 2026). The catalog takes one set and keeps it.
- **The periods differ, in one place on purpose.** Every computed exposure (stock funds, dividend funds, companies) comes from one window, September 2016 to August 2026. The published cross-checks are older: FF1993's portfolios are 1963 to 1991, the industry cross-checks 1963 to 1994. The own volatilities of the six kinds of company are the one mismatch: they are CLMX2001's firm-level figures from 1962 to 1997, because firm-level variance can't be worked out from industry portfolios. CLMX2022's 26% (1962 to 1997) against 28% (since 1997) suggests the later period is close, but that is a single average, not a per-industry check. #46 or a later phase could replace them with a recent figure if one is found.
- **The Long-term fund's own volatility includes a duration gap.** Held at the published 13.57 its own volatility is 0.025; at the slope the data show (15.99) it would be 0.016. The catalog stores 0.025 because own volatility is what the catalog's own duration doesn't explain. If #46 would rather price the fund at about 16, the 0.016 figure goes with it. The other three bond funds' fixed and fitted figures differ by under 0.0005.
- **Carry and convexity.** The bond-fund own volatilities measure a fund's price move against the published duration times the yield's change, and their intercept absorbs the interest the fund earns and pays out, so own volatility doesn't include it. Whether the world's bond funds also earn their yield each day, and how to treat large yield moves (convexity), is for #46 and #47, with the dividend rule the primer's Part 6 describes.
- **Own volatility assumes independent months, and no relation between Securities.** The annual figure is the monthly one × √12. A real fund's noise is a little related to its sector peers'; the catalog doesn't model that.

**Things not read or not found, and what was done:**

- **Fama and French (1997), the paper's table of industry loadings, couldn't be read.** ScienceDirect returned a 403, IDEAS has no abstract and no free copy turned up. A copy on a document-sharing site was not opened. The six sets of exposures are therefore computed here from the same data library. The 1963 to 1994 cross-checks use the months the CFA Digest gives for the paper. The industries are the library's 49 rather than the paper's 48 (the 48-industry "Comps" group, "Computers", holds the hardware SIC codes plus 7373 "Computer integrated systems design", and the other software codes, 7370 to 7372 and 7375, sit in its "BusSv" business-services group; the 49-industry set moves 7370 to 7373 and 7375 into "Softw" and leaves the hardware codes in "Hardw". CLMX2001 also uses 49, adding one group for firms the 48 don't cover). A reviewer with access to the paper can compare them; the library "reconstruct[s] the full history of returns each month", so they may differ slightly.
- **No published firm-level volatility by industry relative to the three-factor model.** AHXZ defines the measure but reports quintile portfolios, not levels by industry. CLMX2001 Table IV gives firm and industry variances for only the ten largest industries, which is why the six kinds of company are limited to those with a row there ("Fin. Services" stands in for banks, "Computer" for software).
- **No published regression of a dividend fund or of today's index funds was found**, so the Dividend stock fund and the four growth, value and small stock funds are computed here. The method is the same for all. Each of the four uses one fund; averaging two funds, as the Dividend stock fund does, wasn't possible because the only daily NAV files read were State Street's (an iShares page was tried and no NAV download was found there).
- **State Street's distribution history wasn't found** in a downloadable file, so the computed numbers use price Returns with a dividend-month dummy (stock funds) or an intercept (bond funds). The effect on own volatility is small: of the six stock funds also run without the dummy, own volatility moved by at most 0.0011 (the high-dividend fund: 0.0689 with it, 0.0700 without).
- **Table 6's corner portfolios are more extreme than any fund.** They are published and show the same signs and ordering as the computed funds (growth below value on `hml`, small above big on `smb`), but they are cells of a sort of the whole market, so the catalog uses the funds' computed numbers and keeps Table 6 as a cross-check. If the catalog should instead use the published cells, they are in the Table 6 section above.

**What #46 decides:**

- How the day's surprise is drawn from own volatility: the annual figure is the standard deviation over a year, so a day's is about it ÷ √252 (252 trading days), if days are independent. Whether the surprise is a normal or a fatter-tailed draw, whether it is seeded by date and Security, and whether the same draw can be shared between Securities (the catalog assumes no) are #46's.
- Whether a balanced fund's surprise is drawn once from its own volatility (the catalog stores one number) or once per part.
- What happens to every Security on days after the Factor file ends (resampled Factor returns, per the primer, Part 6).
