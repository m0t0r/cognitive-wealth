# Synthetic data and production-like infrastructure for an advisor-facing wealth platform

> Research notes gathered on 2026-10-23 while grounding the domain. They inform the decisions but are not decisions: where this report and an ADR or [docs/product.md](../product.md) disagree, those win. In particular, Cognitive Wealth uses fictional Securities rather than real tickers, Umami rather than pug.sh, and no LLM gateway. Versions and licences are as of the cited sources; re-check them before adopting a tool.

Research date: 2026-10-23. Stack assumed: Next.js 16, Postgres 18, Redis, Better Auth, pnpm + Turborepo, Docker Compose locally. Versions and dates come from the cited primary sources as of this date. Where a source was third-party or I could not verify something, the text says so.

---

## Part A: Realistic synthetic data

### A1. Design principle: one generator, one ledger, many projections

Treat every synthetic artefact as a **projection of one seeded simulation**, never as an independent random table:

```
seed ─► households (SCF-weighted) ─► accounts (registration rules) ─► model portfolios
     ─► daily event simulation (cash flows, trades, dividends, fees, corporate actions)
     ─► append-only ledger (the single source of truth)
          ├─► positions / tax lots / balances   (fold over the ledger)
          ├─► custodian files (A4)               (export + injected breaks)
          ├─► statements PDFs, emails, notes     (A5, rendered from ledger + persona)
          └─► ground-truth labels for evals      (which breaks, which facts)
```

That way everything reconciles by construction, and any deliberate break or "fact" planted in a document is recorded as a label you can score against.

Determinism: use a seeded PRNG everywhere (`faker.seed()` and an explicit PRNG for your own draws), pin a fixed reference date, and store money and quantities as integers or `NUMERIC`, not floats. Faker's docs warn that seeding alone does not fix relative-date methods (`date.past`, `date.recent`, …). Pass a `refDate` or call `faker.setDefaultRefDate(...)`. They also warn that "you may get different values for the same seed" across versions, so pin the Faker version. The current major is v10.6.0 ([Faker usage guide](https://fakerjs.dev/guide/usage)).

### A2. Clients and households from the Survey of Consumer Finances

**The 2025 SCF was released on 2026-10-09**, so it is the current data ([SCF index](https://www.federalreserve.gov/econres/scfindex.htm), [press release](https://federalreserve.gov/newsevents/pressreleases/other20261009a.htm)). Useful files:

- Summary extract, dollar values in 2025 dollars: [CSV zip](https://www.federalreserve.gov/econres/files/scfp2025excel.zip), [SAS](https://www.federalreserve.gov/econres/files/scfp2025.zip), [Stata](https://www.federalreserve.gov/econres/files/scfp2025s.zip). It has the variables used in the Fed's report: age, income, net worth, financial assets, retirement accounts, directly held stocks, mutual funds, bonds, home value, debt, and the weight.
- The public dataset has **21,800 records for 4,360 families**. Missing values were imputed five times, so there are five implicates per family. Replicate weights ship with the full dataset only ([SCF index](https://www.federalreserve.gov/econres/scfindex.htm)).

**Recommended technique: weighted bootstrap and conditional jitter, not a generative model.**

1. Load the summary extract and divide the weight by 5, because each family appears five times.
2. Filter to your target market. A typical RIA client threshold is about $1M or more in investable assets. Filter on financial assets and net worth, not on income alone.
3. Draw households **with probability proportional to weight**. A draw keeps the joint distribution of age, income, net worth, asset mix and retirement-account share, which independent marginals would lose.
4. Add small multiplicative noise, for example log-normal with σ around 5–10%, and snap ages to whole years. No real SCF row then reproduces exactly. The SCF is already disclosure-protected, so this is about realism, not privacy.
5. Use Faker (`fakerEN_US`, seeded) for names, addresses, emails and birthdays that match the sampled age. Then derive the household shape: spouse probability by age band, number and ages of children, and a beneficiary graph.

This beats SDV-style synthesizers for this use. The SCF is small, and you want calibrated tails such as the top 1% of wealth. Note that **SDV is now under the Business Source License** ([SDV repo](https://github.com/sdv-dev/SDV)), and **Gretel was acquired by NVIDIA in March 2025** ([TechCrunch](https://techcrunch.com/2025/03/19/nvidia-reportedly-acquires-synthetic-data-startup-gretel)). NVIDIA's open-source [NeMo Data Designer](https://github.com/NVIDIA-NeMo/DataDesigner) (`pip install data-designer`) combines statistical samplers, LLM columns, seed datasets and LLM-as-judge validation. It is a reasonable choice for the _unstructured_ layer (A5), not for the household sampler.

### A3. Accounts, securities, prices and transaction histories

**Registration types to model**, each with its own rules: Individual, Joint (JTWROS / TIC / community property), Traditional IRA, Roth IRA, Rollover IRA, SEP and SIMPLE IRA, Inherited (beneficiary) IRA, held-away 401(k), 529, UTMA/UGMA, revocable trust, irrevocable trust, estate, entity (LLC or corporate), DAF or charitable, and HSA. Rules that drive generated activity:

- **Contribution limits** by year and age (catch-up contributions) for IRA, 401(k) and HSA. Store them as a dated reference table.
- **RMDs** from age 73 under current law. Divisors come from the Uniform Lifetime Table (Table III) in **IRS Pub 590-B, Appendix B** ([Pub 590-B](https://www.irs.gov/publications/p590b)). Inherited IRAs use the Single Life table.
- **Social Security**: PIA bend points. For workers first eligible in 2027 they are **$1,340 and $8,077**, per the SOA's summary of the 2026-10-14 announcement ([SOA](https://www.soa.org/communities/retirement-practice/newsletter-articles/2026/october/2026-10-rp-schobel/)). The canonical table is [ssa.gov/oact/cola/bendpoints.html](https://www.ssa.gov/oact/cola/bendpoints.html), which returned 403 to my fetcher, so verify the figures there. These feed planning features and realistic "income" cash flows for retirees.

**Securities: real tickers or fictional securities?** Use a hybrid:

- **Real tickers for a small, liquid universe** of roughly 50–150 broad ETFs and index mutual funds, plus a money-market sweep. Tickers and fund names are facts and make demos legible. **Do not use CUSIPs or ISINs.** They are licensed by CUSIP Global Services; even Plaid returns them as null unless you hold a CGS license ([Plaid Investments API](https://plaid.com/docs/api/products/investments/)). Use the ticker plus an [OpenFIGI](https://www.openfigi.com/api) FIGI as the external ID, and your own internal security ID. SEC EDGAR's `company_tickers.json` and `company_tickers_mf.json` give a public-domain ticker-to-CIK map.
- **Fictional securities** (for example a fake "CW Total Market Index Fund") whenever data will be **committed, published or shown publicly**, and for anything you need to control: splits, mergers, liquidations, distribution schedules. Generate CUSIP-_shaped_ IDs with a valid check digit but an obviously fake issuer prefix, so parsers get exercised.

**Market data sources (free tiers) and their licences**

| Source                            | What you get                                          | Limits                                                                                                                                   | Licence / caveat                                                                                                                                                                                                                                             |
| --------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Tiingo** (Starter)              | EOD adjusted prices, 30+ years, dividends and splits  | 50 req/h, 1,000 req/day, 500 unique symbols/month, 1 GB/month                                                                            | **"Internal Use Only"**, defined as personal use; redistribution needs a separate licence ([pricing](https://www.tiingo.com/about/pricing)). **Best fit for a private learning project.**                                                                    |
| **Stooq**                         | Bulk EOD CSVs (US stocks and ETFs, indices)           | Daily hit quota                                                                                                                          | Community reports say an **API key, obtained through a CAPTCHA, has been required since about March 2026** ([pandas-datareader #1012](https://github.com/pydata/pandas-datareader/issues/1012)). No formal licence terms found, so treat it as personal use. |
| **Alpha Vantage**                 | Daily series, fundamentals                            | **25 requests/day** free; open-source and educational projects can apply for unlimited ([support](https://www.alphavantage.co/support/)) | Terms of Service govern redistribution.                                                                                                                                                                                                                      |
| **Massive** (formerly Polygon.io) | EOD aggregates                                        | Free plan reportedly 5 calls/min, 2 years of history (third-party sources only; check massive.com)                                       | Commercial terms.                                                                                                                                                                                                                                            |
| **Yahoo via yfinance**            | Everything                                            | Unofficial and breaks often                                                                                                              | yfinance: "the Yahoo! finance API is intended for personal use only" ([repo](https://github.com/ranaroussi/yfinance)). **Avoid as a dependency.**                                                                                                            |
| **FRED**                          | Rates, CPI, spreads, macro                            | API key required; no numeric limit published                                                                                             | Must show the "not endorsed" notice. **Series marked "Copyright" need the owner's permission beyond personal use** ([FRED terms](https://fred.stlouisfed.org/docs/api/terms_of_use.html)).                                                                   |
| **US Treasury**                   | Daily par yield curve                                 | Bulk CSV                                                                                                                                 | US government work. Good for cash and bond yields.                                                                                                                                                                                                           |
| **Ken French Data Library**       | Daily and monthly factor returns since 1926           | Bulk                                                                                                                                     | Ideal for _simulating_ prices of fictional funds.                                                                                                                                                                                                            |
| **Nasdaq Data Link**              | The free "WIKI Prices" set has been frozen since 2018 | n/a                                                                                                                                      | Only useful for old backtests.                                                                                                                                                                                                                               |

**Recommended pattern.** Put a `PriceSource` interface in front of two implementations:

1. A **synthetic generator**, the default and safe to commit. It produces fictional fund prices as `r_fund = β·r_factor + α + ε`, using a seeded **block bootstrap of real daily factor returns** (Ken French). That keeps fat tails, volatility clustering and real crash dates such as 2008, 2020 and 2022. Pure GBM does not. Dividends come from a declared schedule with ex-date and pay-date offsets.
2. A **real-data adapter** (Tiingo) that fills a gitignored cache or a local Postgres volume and is never committed. That keeps you inside "internal use only".

Use a trading calendar (NYSE holidays) so weekends and holidays have no prints. Settlement is **T+1** for US equities and ETFs, so trade date and settle date differ by one business day.

**Transaction histories that reconcile exactly**

Generate _events_, post them to a **double-entry ledger**, and derive everything else:

1. **Simulate day by day** from each account's open date to "today", in this order: corporate actions (splits and mergers on the effective date), then dividends (accrue on ex-date, pay on pay-date, as cash or DRIP), then scheduled contributions and withdrawals (payroll-like for 401(k), annual for IRA up to the limit, RMDs in Q4 for owners 73+), then advisory fees (quarterly in arrears on average daily AUM with a tiered schedule, debited from cash or a designated account), then rebalancing (when a sleeve drifts beyond a band such as ±5%, or on a calendar; generate sells first, then buys, keep a cash target).
2. Each event writes ledger lines. A buy credits cash and debits the security position. Quantities use fixed scale (for example `NUMERIC(20,6)` shares) and money uses integer cents.
3. **Tax lots**: each buy creates a lot; sells relieve lots FIFO or specific-ID; splits adjust lot quantity and basis. That gives realistic unrealized and realized gains for tax features.
4. **Invariants as property tests** (fast-check or Vitest): for every account and date, `fold(ledger) == position snapshot`, cash never goes negative unless margin is enabled, `Σ lots.qty == position.qty`, and `market value == Σ qty × close`. If these hold, every downstream export reconciles by construction.
5. Map your internal transaction types to a common external vocabulary. **Plaid's investment transaction taxonomy** is a good, public model: types `buy, sell, cancel, cash, fee, transfer`, plus about 45 subtypes such as `dividend reinvestment`, `management fee`, `contribution`, `long-term capital gain`, `split`, `spin off` and `tax withheld` ([Plaid Investments API](https://plaid.com/docs/api/products/investments/)).

### A4. Simulating a custodian feed

Real custodian feeds (Schwab, Fidelity, Pershing) are proprietary, delivered as files over SFTP, and shaped differently per custodian. That variety is the thing worth practising. A public reference for the _content_ of such files is Interactive Brokers' **Flex Queries**: customizable activity and trade-confirm reports in TEXT or XML ([IBKR guide](https://www.ibkrguides.com/orgportal/performanceandstatements/flex.htm)).

**Simulator design**

- Produce one bundle per custodian per business day: `positions_SOD`, `transactions`, `cash_balances`, `security_master`, `prices`. Give two fake custodians _different_ formats (one fixed-width with a header and trailer record count, one CSV with different column names, sign conventions and date formats). Reconciliation then forces a normalization layer.
- Deliver into object storage at `s3://custodian-landing/custodian=ACME/date=2026-10-22/…`. For extra realism, add an SFTP container in front.
- **Break injection**, configurable and **labelled in a ground-truth manifest**:
  - missing or duplicate transaction
  - dividend posted a day late
  - split applied to positions but not to transactions
  - price mismatch from a stale close
  - trade booked in the app but not at the custodian, and the reverse
  - quantity rounding (fractional shares)
  - account opened at the custodian but unknown to the app
  - holiday and late files
  - **restatement files** that replace an earlier day
  - a duplicate redelivery of the same file (idempotency check by content hash)
- **Ingestion pipeline to build**: landing (immutable raw object, plus a DB row with hash, size and arrival time), then parse into raw tables, then normalize into canonical transactions and positions, then **three-way reconciliation** (custodian positions vs app ledger vs prior positions plus today's transactions), then a break queue with ageing and resolution states. Score the recon engine's precision and recall against the manifest.

### A5. Synthetic unstructured data for AI features

**Approach: persona-grounded LLM generation, then cached and committed as fixtures.**

1. Build a **persona card** per household from the structured data: names, ages, accounts, goals, risk tolerance, life events, and recent ledger events such as a large withdrawal or an RMD due.
2. For each artefact (meeting transcript, email thread, CRM note, call summary), choose a **scenario** and a **list of planted facts** with IDs, for example `F17: client's daughter starts college fall 2027` or `F18: wants to reduce equity to 50%`. Ask the model for structured output (JSON: speakers, turns, metadata) that must include the planted facts, plus a few distractors and contradictions.
3. **Reproducibility comes from caching, not from temperature 0.** LLM outputs are not bit-reproducible across runs or model versions. Key each artefact by `hash(model_id, prompt, persona, scenario, seed)`, store it in object storage or commit it under `fixtures/`, and regenerate only on purpose.
4. The planted-fact list becomes the **eval ground truth** for extraction, summarization, "next best action" and RAG. Score recall of facts, hallucinated facts, and contradiction handling.
5. **Statements (PDF)**: render from the ledger, not from the LLM, using `@react-pdf/renderer` or headless Chromium `page.pdf()` from your existing Playwright setup. Optionally add "scanned" variants (rotation, noise, JPEG) to test OCR. The numbers in the PDF then reconcile with the database exactly, which is what makes document-QA evals meaningful.
6. **Tooling**: NeMo Data Designer (above) for large batches with samplers and judge filters. Faker for the structured filler. Finance-specific simulators exist only for _transactions and fraud_, not for wealth-management narratives. Examples are IBM's AMLSim (AML transaction graphs) and PaySim (mobile-money fraud). There is no "Synthea for wealth", so your ledger simulator is that piece.

### A6. Open datasets worth importing

- **SEC Form ADV bulk data**: monthly ZIPs of every SEC-registered adviser and exempt reporting adviser (latest: October 2026), plus a CSV archive from 2001 ([SEC page](https://www.sec.gov/data-research/sec-markets-data/information-about-registered-investment-advisers-exempt-reporting-advisers), [archive](https://www.sec.gov/foia/docs/form-adv-archive-data.htm)). Item 5 (advisory business: employees, clients, client types, regulatory AUM, fee types) gives **realistic firm shapes**: AUM per advisor, clients per advisor, client-type mix. Use it to seed demo _organizations_ and calibrate household counts per org. Exempt reporting advisers do not file Item 5.
- **IRS Pub 590-B Appendix B** (RMD life-expectancy tables), contribution and catch-up limits, tax brackets: dated reference tables.
- **SSA** bend points, COLA, earnings test, wage base.
- **SEC EDGAR** ticker and CIK maps, and fund holdings (N-PORT). EDGAR fair-access rules require a declared User-Agent and a modest request rate.
- **FRED and Treasury** for rates, CPI and inflation assumptions in planning.

---

## Part B: Production-like infrastructure

### B1. Feature flags: Flagsmith (open source)

- **Status**: very active. **v2.287.0 shipped 2026-10-20** ([releases](https://github.com/Flagsmith/flagsmith/releases)).
- **Self-host shape** ([main `docker-compose.yml`](https://raw.githubusercontent.com/Flagsmith/flagsmith/main/docker-compose.yml)): one image `docker.flagsmith.com/flagsmith/flagsmith`, run three ways: `migrate`, `serve` (API and dashboard on :8000) and `run-task-processor`, against Postgres. The current main compose also adds an **experimentation and warehouse stack**: Kafka 3.9, ClickHouse 25.12, `events-ingestion-api` and `warehouse-delivery`, enabled with `EXPERIMENTATION_ENABLED=true`. For flags, remote config and segments you only need Postgres, API and task processor. Skip the Kafka and ClickHouse services unless you are studying experiments. Flagsmith can share your Postgres 18 server through its own database and role (the compose pins `postgres:15.5-alpine`, so test on 18). Pin a version tag; the compose uses `:latest`.
- **Open source vs Enterprise**: RBAC, SAML/SSO/LDAP, **change requests (four-eyes approval)** and **audit logs** are Enterprise-only, and one Flagsmith page says the OSS self-hosted edition has a single project ([OSS/self-hosted FAQ](https://docs.flagsmith.com/support/faq/open-source-self-hosted), [Enterprise Edition](https://docs.flagsmith.com/deployment-self-hosting/enterprise-edition)). For a fintech these features matter in real production; locally you can practise the _process_ through PR-reviewed flag config instead.
- **OpenFeature**: vendor-supported providers for JS server (`js-sdk-contrib/libs/providers/flagsmith`) and JS web client, plus Go, Java, .NET, Python, Ruby, Rust, Kotlin and Swift ([OpenFeature ecosystem](https://openfeature.dev/ecosystem?instant_search%5Bquery%5D=flagsmith)).
- **Next.js**: `@flagsmith/flagsmith` with `/isomorphic`. Initialise on the server in the root layout, pass `getState()` as `serverState` to a client `FlagsmithProvider`, and read flags with `useFlags()`. `@flagsmith/flagsmith/next-middleware` handles middleware checks. Create a fresh instance per request so identities don't leak between users ([Next SSR docs](https://docs.flagsmith.com/clients/next-ssr)).
- **Recommendation**: code against **OpenFeature** (`@openfeature/server-sdk`) with the Flagsmith provider on the server. Evaluate on the server in RSC or Server Actions so flags never leak internal IDs, which fits ADR 0003: identify with a `publicId` and pass traits such as org plan or role. In unit, integration and e2e tests, swap in OpenFeature's in-memory provider, which keeps the test-isolation rule with no flag server in tests. Use **segments** for "advisor role = admin" or "org = Acme" rollouts, and **remote config** for things like fee-schedule display limits. Alternatives worth knowing: GrowthBook (stronger A/B statistics) and flagd (the OpenFeature reference daemon, file-based, good in CI).

### B2. Product analytics: what pug.sh is, and how it compares

**Pug** ([pug.sh](https://pug.sh/open-source-analytics), [GitHub](https://github.com/pug-sh/pug)) is **open-source _product_ analytics**, positioned against Mixpanel and Amplitude rather than Plausible. Its features are autocapture after one `init()`, events, identify and alias profiles, trends, funnels, retention, segmentation, user-flow Sankeys, dashboards, a web-analytics overview, live view, GDPR/DPDP erasure, and an MCP server. It is licensed **AGPL-3.0** (contributions need a CLA), with a hosted tier free up to 100k events/month. Its own comparison page lists no session replay, flags or experiments.

**Self-hosting** ([requirements](https://docs.pug.sh/self-hosting/requirements/), [deployment](https://docs.pug.sh/self-hosting/deployment/)):

- **Stack**: Go server and workers (Connect RPC), **PostgreSQL 15+** (dev compose uses `postgres:18`), **ClickHouse 26.5** (`nofile` ulimit 262144), **NATS 2.14 with JetStream**, and **Dragonfly v1.38.1** (Redis-compatible, ephemeral, a hard dependency). Separate images on `ghcr.io/pug-sh/…`: `pug-server`, six workers, three migrate images, and two cron images (`pug-cron-purge` every 5 minutes, `pug-cron-usage` hourly). The cron images need an external scheduler: "Nothing starts them for you". In Compose, use a small scheduler container or host cron.
- **No official production compose file.** You assemble it from the image list. The dashboard is a separate React SPA with no image; you build it with Bun.
- **Sizing**: dev minimums are about 2 GB for Pug, 2 GB Postgres, 4 GB ClickHouse, 1 GB NATS and 1 GB Dragonfly.
- **SDKs**: `@pug-sh/browser`, `@pug-sh/node`, Flutter, Ruby, and HTTP. There is no dedicated React or Next.js SDK, but browser plus node covers it.
- **Maturity**: example tag `0.0.36`, about 96 GitHub stars, no published GitHub releases. It is young and pre-1.0, so expect churn.

|                  | Category                                                    | Licence                           | Self-host footprint                                                                                                                                                                                                        | Notable                                  |
| ---------------- | ----------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **Pug**          | Product analytics                                           | AGPL-3.0                          | Go + PG + ClickHouse + NATS + Dragonfly, about 10 containers                                                                                                                                                               | Pre-1.0, small community, MCP server     |
| **PostHog**      | All-in-one (analytics, replay, flags, experiments, surveys) | MIT for the compose deploy        | 4 vCPU / 16 GB; ClickHouse, Kafka, ZooKeeper, Redis, PG, MinIO; **"officially unsupported"**, about 300k events scale, no tagged self-host releases, paid features Cloud-only ([docs](https://posthog.com/docs/self-host)) | Broadest features, heaviest              |
| **OpenPanel**    | Product + web analytics, replay                             | AGPL-3.0                          | PG + ClickHouse + Redis ([repo](https://github.com/Openpanel-dev/openpanel))                                                                                                                                               | Mixpanel-like, includes replay           |
| **Plausible CE** | Privacy-first web analytics                                 | AGPL (app); MIT (CE compose repo) | ClickHouse + PG, 2 GB RAM recommended ([CE](https://github.com/plausible/community-edition))                                                                                                                               | Marketing traffic, not product behaviour |
| **Umami**        | Web analytics, light product                                | MIT                               | **Postgres only** ([repo](https://github.com/umami-software/umami))                                                                                                                                                        | Lightest; could share your PG server     |

**For this project**: product analytics on an internal, advisor-facing B2B tool is about **feature adoption per org and role, funnels for workflows** (onboard household → open account → fund), and **retention**. Pug fits that conceptually and is fun to run, but it is the heaviest _and_ least mature option. If the goal is learning product analytics practice, PostHog's hobby deploy or OpenPanel is the safer bet. If the goal is "a light, production-like tracker", Umami on the existing Postgres. Whichever you pick: send events **server-side** from Server Actions with `publicId`s and no PII, proxy any browser SDK through a same-origin route so CSP `connect-src` stays first-party (and update `security-headers.spec.ts`), and add a consent gate.

### B3. Observability: OpenTelemetry → Collector → Jaeger v2 + Prometheus + Loki + Grafana

**Jaeger v2**: v1 reached end of life on 2025-12-31. v2 is a single binary built on the **OpenTelemetry Collector** framework with native OTLP ([CNCF](https://cncf.io/blog/2025/09/01/jaeger-at-10-forged-in-community-reborn-in-opentelemetry)). The latest release is **v2.22.0 (2026-10-06)**. Recent releases promoted **ClickHouse storage to stable** (v2.21.0), removed v1 HTTP endpoints, and added experimental **MCP and AG-UI endpoints** for AI tooling ([releases](https://github.com/jaegertracing/jaeger/releases)). Image: `cr.jaegertracing.io/jaegertracing/jaeger:2.22.0`, with UI on 16686 and OTLP on 4317/4318 ([getting started](https://www.jaegertracing.io/docs/latest/getting-started/)). Storage choices are memory, Badger (local persistent, good for Compose), Cassandra, Elasticsearch, OpenSearch, ClickHouse and Kafka. The **Monitor tab (SPM)** shows RED metrics through the Collector's `spanmetrics` connector into Prometheus ([SPM docs](https://www.jaegertracing.io/docs/latest/architecture/spm/)).

**Next.js 16**: Next already instruments itself, with root `GET /route`, render, fetch, route-handler and metadata spans. Add `instrumentation.ts` with `registerOTel({ serviceName })` from **`@vercel/otel`** (works self-hosted and on the edge runtime), or a manual **`NodeSDK`** loaded only when `NEXT_RUNTIME === 'nodejs'`, if you need full control such as custom processors or the pg, ioredis and undici instrumentations. `NEXT_OTEL_VERBOSE=1` emits more spans. Spans started inside `register()` don't join request traces ([Next.js OTel guide](https://nextjs.org/docs/app/guides/open-telemetry)).

**Collector**: `otel/opentelemetry-collector-contrib`, latest **v0.163.2 (2026-10-21)** ([releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases)). Make the Collector **the only endpoint the app knows** (`OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`). It fans out:

- traces to Jaeger (OTLP) and to the `spanmetrics` connector
- metrics to **Prometheus**, either scraped or through Prometheus's native OTLP receiver (`--web.enable-otlp-receiver`, endpoint `/api/v1/otlp/v1/metrics`; promote `service.name` and `deployment.environment`; UTF-8 names in 3.x) ([Prometheus OTel guide](https://prometheus.io/docs/guides/opentelemetry/))
- logs to **Loki** through its OTLP endpoint. Emit structured logs (for example pino) with `trace_id` and `span_id` so Grafana links logs to traces.
- GenAI spans also to Langfuse or Phoenix (below)

Grafana then has Prometheus, Loki and Jaeger as data sources. For a quick start, `grafana/otel-lgtm` bundles Collector, Prometheus, Tempo, Loki, Pyroscope and Grafana in one container, "intended for development, demo, and testing" ([repo](https://github.com/grafana/docker-otel-lgtm)). Since you want Jaeger specifically, run the components separately. The Collector seam lets you swap Jaeger for Tempo later with no code change.

**Practice value**: trace a sign-in end to end, including the `after()` email send (ADR 0006); find N+1 Drizzle queries; put SLOs on p95 route latency; add exemplars from metrics to traces; alert rules in Prometheus. Keep telemetry **off in tests**, or use an in-memory exporter in integration tests that assert spans.

**LLM and agent tracing**

- **OTel GenAI semantic conventions** cover client spans (`gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.usage.input_tokens/output_tokens`), agent spans (`invoke_agent`, `execute_tool`), events, metrics and MCP. In mid-2026 they **moved to a dedicated repo, [open-telemetry/semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai)**. The old opentelemetry.io pages are now stubs. They are still **Development** stability, with no tagged release. Expect attribute renames, and pin your instrumentation versions.
- **Langfuse** (MIT core, `ee/` folders licensed): now **v4**. Self-host components are web, worker, Postgres, ClickHouse, Redis/Valkey and S3-compatible blob storage ([self-hosting](https://langfuse.com/self-hosting)). v4 moved ingestion to **OTLP** (`/api/public/otel/v1/traces`) and removed legacy ingestion routes ([v3→v4 upgrade](https://langfuse.com/self-hosting/upgrade/upgrade-guides/upgrade-v3-to-v4)). Strong on prompt management, datasets, LLM-as-judge evals, scores and sessions.
- **Arize Phoenix**: **Elastic License 2.0** (free to self-host; you may not offer it as a managed service). A single container, `arizephoenix/phoenix`, pinned by version, with OpenInference instrumentation, evals, datasets, experiments and prompt management ([repo](https://github.com/Arize-ai/phoenix), [self-hosting](https://arize.com/docs/phoenix/self-hosting)). Much lighter than Langfuse.
- **Pick**: Phoenix if you want one container now. Langfuse if you want the fuller "LLM product ops" workflow and are willing to run ClickHouse. Either way, emit GenAI-semconv spans once (for example through the Vercel AI SDK's telemetry option or OpenLLMetry/OpenInference) and **route them through the same Collector**, so a single trace in Jaeger shows the HTTP request, the DB query and the LLM call, and the LLM tool shows the prompt-level detail.

### B4. Jobs and workflows

|                    | Backing store                                                | Licence                                                                                                           | Fit                                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **pg-boss**        | Postgres 13+, `SKIP LOCKED`                                  | MIT                                                                                                               | Cron and RRULE, priorities, retries with backoff, **dead-letter with redrive**, pub/sub fan-out, rate limiting and debouncing; Node 22.12+ ([repo](https://github.com/timgit/pg-boss))                                     |
| **BullMQ**         | Redis                                                        | MIT                                                                                                               | Fast and mature, but needs **`maxmemory-policy noeviction`** ("the only setting that guarantees correct behaviour") and AOF persistence ([prod guide](https://docs.bullmq.io/guide/going-to-production))                   |
| **Temporal**       | Postgres/MySQL/Cassandra (+ Elasticsearch for visibility)    | MIT                                                                                                               | Durable workflows; **v1.32.1** (2026-10-08) ([releases](https://github.com/temporalio/temporal/releases)); compose via `temporalio/samples-server` ([deploy guide](https://docs.temporal.io/self-hosted-guide/deployment)) |
| **Inngest**        | SQLite default; Postgres + Redis for real use                | Server **SSPL with delayed Apache-2.0 publication**; SDKs Apache-2.0 ([repo](https://github.com/inngest/inngest)) | Single binary `inngest/inngest`, :8288; self-host support not guaranteed ([docs](https://www.inngest.com/docs/self-hosting))                                                                                               |
| **Trigger.dev v4** | PG, Redis, object store, registry, optional ClickHouse 25.8+ | Apache-2.0                                                                                                        | Heavy: webapp 3+ vCPU / 6+ GB and worker 4+ vCPU / 8+ GB; **no checkpoints self-hosted** ([docs](https://trigger.dev/docs/self-hosting/docker))                                                                            |

**Recommendation: pg-boss first.** It needs no new infrastructure. Above all, you can **enqueue inside the same Postgres transaction** as the domain write (a transactional outbox), which is the correctness property ingestion and reconciliation need. It also keeps your Redis a pure cache: Better Auth's secondary storage benefits from eviction, and BullMQ forbids it. Run the worker as its own Compose service from the same image with a different command. **Add Temporal later** as a learning exercise for long-running, multi-party processes: account opening (KYC → e-sign → custodian account number), ACATS-style transfers, or the quarterly billing run.

### B5. Object storage

**MinIO Community Edition is over.** The repo says "THIS REPOSITORY IS NO LONGER MAINTAINED", it is source-only with no new binaries or images, and it was **archived on 2026-04-25** ([minio/minio](https://github.com/minio/minio)). Options:

- **SeaweedFS** (Apache-2.0). A single-container dev mode (`weed mini`, S3 on :8333) and broad S3, IAM and STS coverage with a compatibility suite in CI ([repo](https://github.com/seaweedfs/seaweedfs)). **Recommended default.**
- **Garage** (AGPL-3.0). Lightweight, geo-distributed, needs about 1 GB RAM ([site](https://garagehq.deuxfleurs.fr/)). A good second choice.
- RustFS: newer, less proven.

Use it for custodian landing files, statement PDFs, document uploads, and as the blob store for Langfuse or Trigger.dev if you adopt them. Code against the AWS S3 SDK, with presigned URLs for browser upload and download, so a real cloud swap is configuration only. Create buckets and policies in an init container. Turn on versioning for the landing bucket so raw files stay immutable.

### B6. Vector search: pgvector

**pgvector v0.8.7** supports Postgres 13–18, with the image `pgvector/pgvector:pg18-trixie`. It offers HNSW and IVFFlat indexes, `halfvec` (indexable to 4,000 dimensions) and `sparsevec`, and **iterative index scans** (0.8+), which matter for **tenant-filtered** queries ([repo](https://github.com/pgvector/pgvector)). That fits ADR 0002, where every query is scoped to the org: `WHERE org_id = $1 ORDER BY embedding <=> $2` with `hnsw.iterative_scan` enabled. Swap your Postgres image to the pgvector variant, or add the extension to your own image, pinned by digest. Add `CREATE EXTENSION vector` in a migration. Keep embeddings in the same transaction as the documents they index, which is the main reason to prefer pgvector over a separate vector database at this scale.

### B7. LLM gateway: LiteLLM, with a supply-chain warning

LiteLLM proxy gives one OpenAI-compatible endpoint across providers, with virtual keys, per-key budgets and rate limits, fallbacks and logging callbacks. It has had **two supply-chain compromises in 2026**:

- **2026-03-24**: PyPI `litellm` 1.82.7 and 1.82.8 were malicious. The official proxy Docker image was not affected. Since **v1.83.0-nightly, images are cosign-signed** ([LiteLLM post](https://docs.litellm.ai/blog/security-update-march-2026)).
- **2026-10-21, two days before this report**: **v1.107.0** was malicious on PyPI **and in the official Docker images**, tags `v1.107.0`, **`latest`, `main-latest`, `main-stable`**, for about two hours. It shipped a credential stealer and RAT. Safe version: **1.106.2** ([Datadog Security Labs](https://securitylabs.datadoghq.com/articles/litellm-compromised-pypi-docker/)).

If you adopt it: **pin `tag@digest`** (your repo already does this for every image), verify cosign signatures before bumping, never track `latest`, give it only provider keys scoped for this project, and isolate it on its own network. For a single-developer learning project, a library-level abstraction such as the Vercel AI SDK provider registry may be enough. Add the gateway when you want to practise budgets, per-org rate limits or model fallback.

### B8. Secrets, e-signature and document mocks

- **Secrets**: your Compose already uses **file-mounted Docker secrets** (`.secrets/`, `*_PASSWORD_FILE`), the production-like pattern most platforms map to. Add **OpenBao** (MPL-2.0, `bao server -dev`; [repo](https://github.com/openbao/openbao)) only to practise **dynamic Postgres credentials** and leasing. **Infisical** (MIT core, `ee/` licensed; [repo](https://github.com/Infisical/infisical)) is a friendlier secrets UI with sync and PKI.
- **E-sign**: **DocuSeal** (AGPLv3 with §7(b) terms; SQLite or Postgres; API and webhooks; embedded signing is a Pro feature; [repo](https://github.com/docusealco/docuseal)), or **Documenso** (AGPL-3.0; Postgres; Node 24; PAdES signatures; [repo](https://github.com/documenso/documenso)). Either gives a real envelope lifecycle with webhooks (sent → viewed → signed → completed) for account-opening workflows. Put an `ESignProvider` interface in front of it, with an in-memory fake for tests.
- **Documents**: generate statements and agreements as PDFs in a pg-boss job with `@react-pdf/renderer`, store them in SeaweedFS, and email links through Mailpit (already present).

---

## Recommended phased adoption order

Each phase leaves the stack runnable, adds the infrastructure the _next_ features need, and avoids running three ClickHouses before there is a reason to. Use **Compose `include:` files per concern** (`compose.observability.yaml`, `compose.ai.yaml`, …) and **profiles**, so `docker compose up` stays light and heavy pieces are opt-in. Keep pinning `tag@digest` with Dependabot.

**Phase 1: Observability foundation** (Collector, Jaeger v2 with Badger, Prometheus, Loki, Grafana; `@vercel/otel` in `instrumentation.ts`).
_Why first_: every later phase is easier to build and debug with traces. It is cheap (about 1–1.5 GB RAM) and touches only one app file. It also teaches the Collector-as-seam pattern that the LLM tracing in Phase 4 reuses.

**Phase 2: Data engine** (household and ledger generator, `PriceSource` with a synthetic default and a Tiingo cache, **pg-boss**, **SeaweedFS**, custodian-feed simulator, ingestion and reconciliation).
_Why second_: this is the heart of a wealth platform and the best source of realistic load for Phase 1 to observe. pg-boss adds no new service, and transactional enqueue gives correct ingestion. Object storage is needed for landing files and statements.

**Phase 3: Feature flags** (OpenFeature, Flagsmith core: API and task processor on a new database in your Postgres).
_Why third_: by now there are real features to gate (new recon UI, statement v2). Coding to OpenFeature from day one keeps tests hermetic (in-memory provider) and Flagsmith replaceable. Skip Flagsmith's Kafka and ClickHouse experimentation stack until Phase 5.

**Phase 4: AI layer** (pgvector, the persona-grounded unstructured corpus, **Phoenix** or Langfuse fed by the Collector, an optional LiteLLM pinned by digest).
_Why fourth_: AI features need the structured truth from Phase 2 to ground and evaluate against, and the tracing from Phase 1. Start evals with the planted-fact labels. Phoenix keeps the footprint small; move to Langfuse if you want its prompt and dataset workflow and accept running ClickHouse.

**Phase 5: Product analytics and experiments** (Umami for the lightest option, PostHog or OpenPanel for depth, or **Pug** if you want to explore a young Go and ClickHouse stack; optionally Flagsmith experimentation).
_Why fifth_: analytics only pays off once real workflows exist to measure. These are the heaviest additions (ClickHouse plus a broker). If you end up with Langfuse, Pug and Flagsmith experiments together, consider **one shared ClickHouse server** with per-tool databases and users for local use, accepting the version-coupling trade-off.

**Phase 6: Durable workflows and integrations** (Temporal for account opening, transfers and billing; DocuSeal or Documenso; OpenBao dynamic DB credentials).
_Why last_: these teach advanced patterns (sagas, compensation, external webhooks, credential leasing) that sit on top of everything above. Each is also the most optional for a learning project.

Throughout: each adoption is an ADR (your repo already uses them), each new browser-facing origin updates CSP and `security-headers.spec.ts`, and no test touches these services directly. Tests use in-memory providers and exporters, PGlite and Testcontainers, consistent with the repo's isolation rules.
