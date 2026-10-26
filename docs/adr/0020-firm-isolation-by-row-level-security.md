# ADR 0020: Postgres row-level security isolates each Firm's rows

- Status: accepted; point 8 superseded by [ADR 0021](0021-firm-and-delivery-records-cant-be-deleted.md)
- Date: 2026-10-26
- Supersedes: [ADR 0002](0002-tenant-is-the-sessions-active-organization.md)'s "Tenant isolation is enforced in application code, not by Postgres row-level security" paragraph and its last consequence

Application code alone kept one Firm from reading another's rows (ADR 0002): a query that forgot `where firm_id = …` leaked, and the database didn't notice. Postgres now checks too, as a guard against that mistake, not against an attacker (see "What RLS doesn't defend against"). Every table with a `firm_id` column has row-level security (RLS) and one policy for the `app` role, and the code that queries those tables tells Postgres, per transaction, which Firm it works for.

1. **One policy per Firm-scoped table.** `firm_isolation`, for `app`, covering reads and writes: a row is visible only when its `firm_id` is the transaction's Firm (`using`), and an insert or update that would leave a row in another Firm fails (`with check`). The policy is `firmIsolation()` from `packages/db/src/schema/_domain.ts`, next to the `firmId()` column helper, so a new Firm-scoped table gets its policy the way it gets its column. drizzle-kit generates the policies and turns RLS on (migration `0007_firm_isolation`). A catalog test (`firm-isolation.integration.test.ts`) fails when any table with a `firm_id` column lacks RLS or the policy.
2. **The Firm is a transaction-local setting, `app.firm_id`.** `set_firm_id(firm)` (migration `0006_firm_setting`) sets it with `set_config('app.firm_id', …, true)`, so it ends with the transaction and a pooled connection can't carry it into the next request.
3. **No Firm set is an error, not an empty result.** The policies compare `firm_id` with `current_firm_id()`, which raises `Firm not set` (SQLSTATE `42501`) when the setting is missing (a connection that never set it) or empty (one that set it in an earlier transaction: Postgres then holds `''`, not nothing).
4. **Domain functions set the Firm themselves.** `withFirm(db, { firmId, query })` from `@repo/db/firm` opens a transaction, or joins the caller's as a savepoint, calls `set_firm_id`, and runs `query` in it. `listHouseholds`, `getHouseholdOverview`, `seedDevWorld` and `ingestDelivery` go through it with the `firmId` they already took, so their signatures and their callers (the Household pages, `pnpm db:seed`, `pnpm custodian:ingest`) didn't change. A nested `withFirm` for another Firm is refused, so a mistake can't switch Firms under its caller. That refusal is a guard against bugs only: SQL can still call `set_config('app.firm_id', …)` itself.
5. **No role bypasses the policies.** The CLIs, and later the pg-boss job (#56), connect as `app` and go through the same functions. There's no `bypassrls` role and no new login. `migrator` owns the tables and runs migrations; as the owner it isn't held by their policies, since the tables don't use `force row level security`.
6. **The explicit filters stay.** Every query keeps its `where firm_id = …`. RLS is a second check that doesn't depend on the first, and the filters keep the queries readable and on their indexes.
7. **Some tables are out of RLS on purpose.** Better Auth's tables (`user`, `session`, `organization`, `member`, `invitation`, …) and `audit_event`, whose `organization_id` is nullable: auth flows write it before a Firm is known, and it outlives the organization. They stay under ADR 0002's rules: application code scopes them to the tenant from `getViewer`/`requireTenant`.
8. **Deleting a Firm still cascades.** _Superseded by [ADR 0021](0021-firm-and-delivery-records-cant-be-deleted.md): a Firm with records can't be deleted, and Better Auth refuses to try. The same mechanism means the refusal sees rows the policies would hide._ Better Auth deletes an organization as `app`, with no Firm set. The `on delete cascade` foreign keys still remove its Firm-scoped rows: Postgres runs a foreign key's actions as the table's owner and with row-level security not forced (`ri_PerformCheck` in `src/backend/utils/adt/ri_triggers.c` switches to the owner with `SECURITY_NOFORCE_RLS`), so the policies never apply to them, `force row level security` or not. `tenant.integration.test.ts` deletes an organization through Better Auth and checks its Households go; `firm-isolation.integration.test.ts` deletes one as `app` and checks every Firm-scoped table.

## What RLS catches, and what it doesn't

Each function sets `app.firm_id` from the same `firmId` it filters by. So RLS catches a query that **forgets** its Firm filter, or a function that never calls `withFirm`: the first refuses another Firm's rows, the second fails with `Firm not set`.

It does **not** catch a function **handed the wrong Firm**. The filter and the policy then agree, and that Firm's rows come back. The database alone doesn't guarantee isolation. The Firm must keep coming from one trusted source at the edge:

- In `apps/web`, only the session's active organization, through `getViewer`/`requireTenant` (ADR 0002). Never a URL, form field or other request input.
- In a CLI or job, the Firm it was explicitly given: `--firm <slug>`, or the job's payload.

## What RLS doesn't defend against

RLS is no defence against anyone who can run their own SQL as `app`: SQL injection, or a leaked `app` password. The policies trust `app.firm_id`, and `app` sets it. Any SQL running as `app` can start a transaction, call `set_firm_id` with another Firm's id, or `set_config('app.firm_id', …)` directly, and read that Firm's rows. Postgres can't stop a role setting a two-part setting like this one.

So SQL injection stays a breach of every Firm, exactly as before this ADR. The defence against it is unchanged: every query is parameterized (Drizzle's builders and its `sql` template send values as parameters), and nothing on a request path builds SQL from strings. Treat any raw SQL (`sql.raw`, postgres.js's `unsafe`) on a request path as a security bug.

Making RLS hold against injected SQL would need a Firm that `app` can't choose, such as one set only by a function that checks a token `app` can't forge, or one database role per Firm. Both are larger changes and aren't part of this decision.

## How sure "Firm not set" is

The policy runs once for each row a query reads, and an insert's or update's check runs on each row it writes. So a write that writes a row always fails without a Firm, and so does any read that reaches a row. That much is guaranteed. A read that reaches no row is different: on paper, a policy that's never evaluated raises nothing.

In practice most such reads fail too. Postgres calls `current_firm_id()` while it plans a query, to estimate how many rows the policy keeps (`estimate_expression_value` in `src/backend/optimizer/util/clauses.c` folds stable functions), and Drizzle has Postgres plan every query when it runs: it sends them as unnamed statements, never a reused prepared one, unless code calls `.prepare()`, which nothing here does. The tests check an empty table, a filter that matches none of a table's rows, `count(*)` and a plain `explain`.

Some queries return no rows without an error. For example, and a test pins the first:

- A query Postgres can prove empty before it plans a scan, such as `where false` or contradictory conditions (`where id = 1 and id = 2`). Drizzle writes `inArray(column, [])` as `false`. A write that matches no row this way writes nothing and raises nothing too.
- A reused prepared statement (`.prepare()`) whose plan was made while a Firm was set and whose lookup then reaches no row.

Neither leaks, since there are no rows to show. They only mean a forgotten `withFirm` can go unnoticed in a query that finds nothing.

## Consequences

- Every new exported function that touches a Firm-scoped table goes through `withFirm`, from the Firm it's given. One that forgets fails in its first test, with `Firm not set`.
- Tests that set up or inspect rows directly write as `migratorOrm`, the tables' owner, and run the code under test as `app` (`orm`). E2E seeding connects as the superuser, whom RLS doesn't hold either.
- Every Firm-scoped query runs inside a transaction, even a read. A single read pays a `begin`, the `set_firm_id` call and a `commit`.
- A new Firm-scoped table needs `firmId()` and `firmIsolation()`. The catalog test fails until it has both.
- SQL injection is still a breach of every Firm. Parameterized queries remain the only defence against it.
