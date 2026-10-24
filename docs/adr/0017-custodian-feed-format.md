# ADR 0017: The Custodian feed's format, and Transaction IDs that survive a rebuild

- Status: accepted
- Date: 2026-10-24

The simulated Custodian writes one Delivery per As-of date (#37): five CSV files and a Manifest, as [the feed primer](../learn/03-custodian-feed-and-ingestion.md) describes. Ingestion (#40) loads a Delivery once, keyed by the Manifest's Content hash, so a Delivery written twice must be the same bytes, or it looks like a Restatement. This records the format and the rules that keep it that way. The row models are in `apps/custodian/src/custodian/feed.py`, and the contract (#38) publishes them.

1. **A Transaction has a public Transaction ID, set by whoever records it.** The `transaction` table gets a `transaction_id` column, unique, with no default. The database's `id` stays internal ([ADR 0003](0003-internal-bigint-ids-public-uuids.md)). The ledger fixture's IDs are worked out from each row's number (`TX-000000003`), so they depend only on the file. The Close (#19) will set its own from the simulated world. A Reversal names what it undoes by this ID, in a `reverses` column.
2. **`transactions.csv` holds the Transactions posted that day**: Posting date = As-of date. A Correction arrives in the Delivery of the day it was posted, with its old Trade date, so each Transaction is sent exactly once and no earlier Delivery is ever replaced.
3. **`positions.csv` is as known on the As-of date** (`known_on = as_of`). A Correction posted later changes later Deliveries' Positions, never this one's. A held Security with no price yet is still sent, with an empty `price` and `market_value` ([ADR 0016](0016-settled-cash-and-market-value-rules.md)).
4. **The bytes depend on the data alone.** UTF-8 with no BOM, LF line endings, a header row even with no rows, an empty value for none, ISO 8601 dates, and each number at its type's precision (`40.000000`, `-6010.00`, a price as quoted). Rows are sorted in Python by code point, not by `order by`. No file holds the time it was written.
5. **The five files are read in one `repeatable read` transaction and written first, then `manifest.json`.** Each write replaces its file in one step (a temporary file, then a rename).
6. **Writes go through a `FeedStore` (`put`, `get`, `list`).** For now a local directory, by default the checkout's gitignored `.dev/custodian-feed/`, one folder per As-of date. SeaweedFS replaces it (#54) without the writer changing.

## Why

- **Transaction IDs set by the writer.** A Transaction has no natural key the way an Account has its number, but Ingestion needs one to tell rows apart, and a Reversal needs one to name its original. The database's `id` would do only while every world is loaded in the same order: load the Accounts the other way round and the IRA's rows are numbered first, so the same day is written with different IDs and different bytes. A database default such as `uuidv7()` breaks the same way on every rebuild. An ID set from the source of the row is the same on every rebuild. `test_a_world_rebuilt_in_another_order_gives_the_same_bytes` checks it.
- **Posting date, not Trade date.** Filing a Correction under its Trade date would mean replacing a Delivery already sent, a Restatement, which phase 1 refuses. The public sources the primer cites (Part 6) show the same habit: a Custodian's cancel and rebook arrive days after the trade they fix (US patent 8,521,634), and FINRA and FIX mark a late trade "as/of" its earlier date. They show the idea across the industry, not any one Custodian's file format, so this is a design choice that matches it.
- **Known on the As-of date.** Without it, writing 3 March again after Friday's Correction would give 3 March's `positions.csv` new numbers: a Restatement made by the writer, not by a mistake.
- **Sorting in Python.** Postgres orders text by the database's collation, which can differ between servers (libc or ICU, and their versions). Python's `sorted` compares code points, the same everywhere.
- **One read.** The Close (#19) records rows while the custodian runs. Five separate reads could catch it halfway, and a `positions.csv` that disagrees with `transactions.csv` would look like a Break.
- **The Manifest last, each file swapped in whole.** A reader that finds a Manifest can count on the files it lists being complete (the primer's Part 4), and never reads half a file.

## Considered options

- **Publish the database's `id`.** Simplest, and the IDs match the fixture's row numbers today, but only because `world:load` records rows in one order. A rebuild in another order changes every published ID.
- **A `uuidv7()` default, as Cognitive Wealth's tables have.** Unique without coordination, but different on every rebuild, so the same world gives different Deliveries.
- **Write each fixture row's ID into `ledger-v0.json`.** It would keep IDs stable if a row were inserted in the middle of the fixture, but it repeats the row number, which the fixture already checks. Rows have only been appended so far, which changes no other ID, and the fixture goes when the Close arrives.
- **A total Market value per Account in the feed.** Not asked for, and the line values are enough to check the Positions. [ADR 0016](0016-settled-cash-and-market-value-rules.md) rounds a total once, so a total sent beside the lines can differ from their sum by a cent.

## Consequences

- Every place that records a Transaction must give it a `transaction_id`. Migration 0004 gave rows loaded earlier `'TX-' || lpad(id, 9, '0')`, which matches what `world:load` gives in an empty database. A database loaded any other way is rebuilt from empty.
- A Transaction ID must never be reused with different contents: Ingestion will treat it as the same Transaction.
- Writing a day whose data changed overwrites its Delivery in the store. That is a Restatement, which phase 2 handles. For a moment, a reader could see new files beside the old Manifest, and the hashes would disagree, so it would refuse and try again.
- A date with no stored prices, such as a weekend, gets a `prices.csv` with only the cash sweep. Positions still carry the latest price on or before it. Business days, and when a Delivery is due, come with the Close.
- The feed primer (docs/learn/03) shows 2 March's real files and quotes their hashes. `test_the_primer_quotes_the_real_hashes_for_2_march` fails when the format changes until the primer is updated.
