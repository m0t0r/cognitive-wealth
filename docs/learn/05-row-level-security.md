# Keeping each Firm's rows apart: roles, row-level security and per-transaction settings

This primer is for you if you know SQL but have never had Postgres itself decide which rows a query may see. It starts from zero. It isn't about finance: it's about how Cognitive Wealth keeps one Firm's Households hidden from every other Firm, one of the principles in [docs/product.md](../product.md). It uses the Reyes Household from [the second primer](02-account-types.md).

By the end you'll know:

- why many Firms share one database, and what goes wrong when a query forgets which Firm it's for
- what a database role is, and why Cognitive Wealth logs in with two of them
- what row-level security is, and what a policy's two tests do
- how code tells Postgres which Firm it works for, and why that setting must end with the transaction
- why "no Firm set" is an error and not an empty answer
- what row-level security catches, and the two things it can't: a wrong Firm, and an attacker who can run SQL

Read it alongside [ADR 0020](../adr/0020-firm-isolation-by-row-level-security.md), which records the decisions, and the code in `packages/db/src/firm.ts` and `packages/db/src/schema/_domain.ts`. Each section answers one question. It starts with the short answer, then explains it, then shows it with numbers. Words with a capital letter, such as Firm, Advisor or Household, are defined in [GLOSSARY.md](../../GLOSSARY.md).

## How to read this

The primer climbs in three levels. Each level uses only what the levels before it explained.

| Level                 | Parts   | What you get                                                                                      |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| **1. The basics**     | 1 and 2 | Why Firms share a database, what a forgotten filter does, and who the database thinks is asking   |
| **2. How it works**   | 3 to 5  | One query, followed step by step: a policy, the per-transaction Firm, and the helper that sets it |
| **3. The real world** | 6 and 7 | Who row-level security doesn't hold, deleting a Firm, what it can't catch, and the rules for code |

On a first read, it's fine to stop after Level 1, take a break, and come back.

Not covered here: how a User's session picks its Firm (that's [docs/auth.md](../auth.md) and [ADR 0002](../adr/0002-tenant-is-the-sessions-active-organization.md)), and the sign-in tables, which row-level security doesn't cover (Part 6 says why).

## Part 1: Why must a query know its Firm? (Level 1)

### Why do all the Firms share one database?

**Short answer:** because one database for everyone is far simpler to run than one per Firm, and the price is that every row must say whose it is.

Think of a block of flats with one mailroom. Every flat's post goes into the same room, sorted into boxes by flat number. One room is cheaper than a post office per flat. But it only works if every letter carries its flat number, and if whoever hands out post always checks it.

Cognitive Wealth works the same way. Larkspur Wealth Partners and Globex are two Firms, and both keep their Households in the one `household` table. Each row carries its Firm's number in a `firm_id` column, the way each letter carries a flat number. In the running example, Larkspur is Firm 1 and Globex is Firm 2. (Real numbers are whatever the database handed out; 1 and 2 keep it short.)

| `household` row | `firm_id` | `name`               |
| --------------- | --------- | -------------------- |
| row A           | 1         | The Reyes Household  |
| row B           | 2         | The Okafor Household |

The Okafor Household is invented for this primer: it stands for any Globex Household. Olivia is Larkspur's Advisor, and Gil is Globex's.

### What goes wrong when a query forgets its Firm?

**Short answer:** it reads every Firm's rows, and shows one Firm's Households to another.

Olivia works at Larkspur, so her Households page should list one Household. The query that builds it filters by Firm:

```sql
select name from household where firm_id = 1;   -- 1 row: The Reyes Household
```

Now suppose someone writes a new page and forgets the `where`:

```sql
select name from household;                     -- 2 rows: Reyes and Okafor
```

Olivia now sees the Okafor Household, which belongs to Globex. Nothing crashed, no test failed unless one checked for it, and Globex's private list of Households went to a competitor. In the mailroom, it's the clerk handing out the whole room's post because nobody said which flat.

The code's own `where firm_id = …` filter is the first defence against this, and every query has to remember it. Row-level security (Part 3) is a second defence that lives in the database, so a query that forgets doesn't leak.

## Part 2: Who is asking? (Level 1)

### What is a database role?

**Short answer:** the name a program logs in to the database with, which decides what it's allowed to do.

The Postgres manual puts it this way: "A role can be thought of as either a database user, or a group of database users, depending on how the role is set up. Roles can own database objects (for example, tables and functions) and can assign privileges on those objects to other roles to control who has access to which objects" ([PostgreSQL 18, "Database Roles"](https://www.postgresql.org/docs/18/user-manag.html)).

Think of the keys a building hands out. The caretaker's key opens every door, including the boiler room. A resident's key opens their own flat and the front door. Each person gets the key for their job and nothing more.

### Why does Cognitive Wealth log in with two roles?

**Short answer:** so the running app can only read and write rows, and only migrations can change the tables themselves.

`packages/db/docker/initdb/01-roles.sh` makes two roles:

- **`migrator`** owns the database and runs the migrations, which create and change tables, so it owns every table they create. It's the caretaker.
- **`app`** can read, add, change and remove rows, and nothing else. The web app and every database command (`pnpm db:seed`, `pnpm custodian:ingest`) log in as `app`. It's the resident.

If someone found a way to run their own SQL through the app (an attack called SQL injection), they would get `app`'s key, not the caretaker's: they couldn't drop a table. They could still read and change rows, though, and Part 6 shows that row-level security doesn't stop them. Part 3 uses the split between the two roles again: the rule about Firms is written for `app`.

## Part 3: Row-level security (Level 2)

### What is row-level security?

**Short answer:** a per-table switch that makes Postgres check every row against the table's policies before a role's query can use it, so the role sees and changes only the rows the policies allow.

Normally, a role that may read a table reads all of it. Row-level security (RLS for short) narrows that down to rows. A table owner turns it on for one table at a time, with `alter table … enable row level security`, and then Postgres checks each row against the table's policies (explained next). The manual: "This expression will be evaluated for each row prior to any conditions or functions coming from the user's query. ... Rows for which the expression does not return `true` will not be processed" ([PostgreSQL 18, "Row Security Policies"](https://www.postgresql.org/docs/18/ddl-rowsecurity.html)). The part left out names one exception: functions marked `leakproof`, which can't leak a row's contents, may run before the check.

Back in the mailroom: it's as if the post can only be handed out through a hatch that reads each letter's flat number, and passes it only to that flat. The clerk can forget to check. The hatch can't.

### What is a policy?

**Short answer:** one rule on a table, with a name, the roles it applies to, and up to two true-or-false tests.

A table with RLS turned on and no policy at all shows nothing: "If no policy exists for the table, a default-deny policy is used, meaning that no rows are visible or can be modified" ([Row Security Policies](https://www.postgresql.org/docs/18/ddl-rowsecurity.html)). Each policy then lets some rows through.

Cognitive Wealth gives every table with a `firm_id` the same one policy, `firm_isolation`, and migration `0007_firm_isolation` turns RLS on for each of those tables:

```sql
alter table "household" enable row level security;
create policy "firm_isolation" on "household" as permissive for all to "app"
  using (firm_id = current_firm_id())
  with check (firm_id = current_firm_id());
```

Read it piece by piece:

- `as permissive`: a row passes if any permissive policy lets it through. (A `restrictive` policy would be one that every row must also pass. With one policy per table, the difference doesn't matter here.)
- `for all`: it covers every kind of command: reading, adding, changing and removing rows.
- `to "app"`: it applies to the `app` role. `CREATE POLICY` names "[t]he role(s) to which the policy is to be applied" ([PostgreSQL 18, CREATE POLICY](https://www.postgresql.org/docs/18/sql-createpolicy.html)).
- `current_firm_id()` is a small function that returns the Firm this piece of work is for. Part 4 explains where that comes from.
- `using` and `with check` are the policy's two tests, explained next.

### What do the `using` test and the `with check` test each do?

**Short answer:** the `using` test decides which existing rows a query can see; the `with check` test decides which rows a command may leave behind.

- **The `using` test** runs on rows already in the table. "Any rows for which the expression returns false or null will not be visible to the user (in a `SELECT`), and will not be available for modification (in an `UPDATE` or `DELETE`). Typically, such rows are silently suppressed; no error is reported (but see Table 300 for exceptions)" ([CREATE POLICY](https://www.postgresql.org/docs/18/sql-createpolicy.html)).
- **The `with check` test** runs on the rows a command is about to write. "An error will be thrown if the expression evaluates to false or null for any of the records inserted or any of the records that result from the update. Note that the _check_expression_ is evaluated against the proposed new contents of the row, not the original contents" (same page).

So the `using` test hides, and the `with check` test refuses. Together they mean code working for Larkspur can't see Globex's rows, can't add a row marked `firm_id = 2`, and can't move one of Larkspur's rows to Globex by changing its `firm_id`.

A `for all` policy that left `with check` out would reuse its `using` test for writes: "if no `WITH CHECK` expression is defined, then the `USING` expression will be used both to determine which rows are visible (normal `USING` case) and which new rows will be allowed to be added (`WITH CHECK` case)" ([CREATE POLICY](https://www.postgresql.org/docs/18/sql-createpolicy.html)). So writing `with check` out changes nothing here. Cognitive Wealth writes it anyway, so nobody reading the policy has to know that rule.

### What does the forgotten query return now?

**Short answer:** only Larkspur's row, because Postgres checks each row against the policy before the query uses it.

Take Part 1's query again, run as `app` for Olivia, so the Firm is Larkspur (Firm 1):

```sql
select name from household;
```

Postgres reads each row and runs the `using` test `firm_id = current_firm_id()`, that is `firm_id = 1`:

| row   | `firm_id` | `firm_id = 1`? | the query sees it? |
| ----- | --------- | -------------- | ------------------ |
| row A | 1         | true           | yes                |
| row B | 2         | false          | no                 |

1 row comes back, The Reyes Household: the same answer as the query that remembered its filter. And if that Larkspur code tries to add a Globex Household:

```sql
insert into household (firm_id, name, relationship_status)
values (2, 'Planted', 'client');
-- ERROR: new row violates row-level security policy for table "household"
```

The new row has `firm_id = 2`, the `with check` test `2 = 1` is false, and Postgres refuses the whole command.

## Part 4: Telling Postgres which Firm (Level 2)

### Where does `current_firm_id()` get the Firm from?

**Short answer:** from a setting called `app.firm_id`, which the code sets at the start of each transaction.

Postgres has settings, named values a connection can change, such as `work_mem` or `timezone`. Besides its own, Postgres accepts a setting with any two-part name: "PostgreSQL will accept a setting for any two-part parameter name. Such variables are treated as placeholders and have no function until the module that defines them is loaded" ([PostgreSQL 18, "Customized Options"](https://www.postgresql.org/docs/18/runtime-config-custom.html)). No module Cognitive Wealth loads defines `app.firm_id`, so it stays a plain value the code can write and the policy can read.

The code writes it with `set_config`, and reads it with `current_setting`. From the manual ([PostgreSQL 18, "Configuration Settings Functions"](https://www.postgresql.org/docs/18/functions-admin.html)):

- `set_config(setting_name, new_value, is_local)` "Sets the parameter setting_name to new_value, and returns that value. If is_local is true, the new value will only apply during the current transaction."
- `current_setting(setting_name, missing_ok)` "Returns the current value of the setting setting_name. If there is no such setting, current_setting throws an error unless missing_ok is supplied and is true (in which case NULL is returned)."

Cognitive Wealth wraps both in two functions of its own (migration `0006_firm_setting`): `set_firm_id(1)` calls `set_config('app.firm_id', '1', true)`, and `current_firm_id()` reads it back as a number.

### Why must the setting end with the transaction?

**Short answer:** because the app reuses each connection for many requests, and a Firm left behind would carry into a stranger's request.

Opening a database connection is slow, so the app keeps a **pool**: a handful of open connections, lent to one request at a time and handed back afterwards. The connection that just served Olivia may serve Gil next.

Picture a shared desk in an office. If each worker leaves their papers out, the next one sits down to someone else's files. The rule is to clear the desk when you leave.

That's why `set_firm_id` passes `is_local = true`. The manual's word on `SET LOCAL`, the command form of the same thing: "The effects of `SET LOCAL` last only till the end of the current transaction, whether committed or not" ([PostgreSQL 18, SET](https://www.postgresql.org/docs/18/sql-set.html)). When the transaction ends, by `commit` or `rollback`, the Firm goes with it. The desk clears itself.

### Why is "no Firm set" an error and not an empty answer?

**Short answer:** because an empty answer looks like a real one, so a bug that forgot to set the Firm would hide instead of failing.

Suppose `current_firm_id()` returned nothing (null) when no Firm was set. Every row's `using` test `firm_id = null` is null, not true, so every row is hidden and the query returns 0 rows. A page that forgot to set the Firm would say "No Households yet", and Olivia would believe it. That's a bug that looks like an empty Firm.

So `current_firm_id()` raises an error instead, `Firm not set`, and the bug shows up the first time anyone runs it. It covers both ways a Firm can be missing:

1. A connection that never set one has no value at all: `current_setting('app.firm_id', true)` returns null.
2. A connection that set one in an earlier transaction holds an empty string, `''`, from then on. The manual doesn't spell this out, so a test checks it (`firm-isolation.integration.test.ts`, on a pool of one connection).

## Part 5: Putting it together (Level 2)

### How does the code set the Firm?

**Short answer:** through one helper, `withFirm`, which every function that reads or writes Firm rows goes through.

`withFirm(db, { firmId, query })` in `packages/db/src/firm.ts` does three things:

1. Opens a transaction (or, if the caller is already in one, joins it).
2. Runs `select set_firm_id(firmId)`.
3. Runs `query` inside that transaction, and returns what it returns.

The functions that read and write Firm rows, `listHouseholds`, `getHouseholdOverview`, `seedDevWorld` and `ingestDelivery`, each take the Firm as a parameter and pass it to `withFirm`.

### What happens, step by step, when Olivia opens the Reyes Household?

**Short answer:** the session gives Firm 1, `withFirm` sets it for one transaction, every query sees only Firm 1's rows, and the transaction ends and takes the Firm with it.

1. The page asks Olivia's session which Firm she is working in: Larkspur, Firm 1 (`requireTenant`, [docs/auth.md](../auth.md)).
2. It calls `getHouseholdOverview(db, { firmId: 1, publicId })`.
3. That calls `withFirm` with Firm 1. A pooled connection runs `begin`, then `select set_firm_id(1)`. Now `app.firm_id` is `'1'` for this transaction only.
4. Each query runs, still with its own `where firm_id = 1`, and the policy runs its `using` test against Firm 1 on every row it reads as well. The filter and the policy are written in two places, and both have to let a row through.
5. The query finishes, the connection runs `commit`, and `app.firm_id` goes back to `''`. The connection returns to the pool.
6. Later, Gil's request gets the same connection. If some code queried a Firm table without `withFirm`, it would get `Firm not set`, never Larkspur's rows.

### Why keep the `where firm_id = …` filters, if the policy already checks?

**Short answer:** so each still works if the other one is ever wrong, and because the filters keep the queries readable and fast.

If a future change broke the filter or the policy, the other would still hold. The filters also tell the next person reading the query, plainly, which rows it's after, and they let Postgres use the indexes that start with `firm_id`.

## Part 6: In the real world (Level 3)

### Who doesn't row-level security hold?

**Short answer:** superusers, roles marked `BYPASSRLS`, and a table's owner, unless the table says otherwise.

A superuser is a role allowed to do anything in the database, such as the login the end-to-end tests use to seed their data. From the manual: "Superusers and roles with the `BYPASSRLS` attribute always bypass the row security system when accessing a table. Table owners normally bypass row security as well, though a table owner can choose to be subject to row security with ALTER TABLE ... FORCE ROW LEVEL SECURITY" ([Row Security Policies](https://www.postgresql.org/docs/18/ddl-rowsecurity.html)).

So in Cognitive Wealth:

- **`app`** is held. That's the point.
- **`migrator`** owns the tables, and they don't use `FORCE`, so it isn't held. Migrations change tables, not Firm data. Tests use it on purpose: they set up and check rows as `migrator`, and run the code under test as `app`.
- **No role has `BYPASSRLS`.** It would be tempting to give the command-line tools one, so they needn't set a Firm. Instead they log in as `app` and go through the same functions, with the Firm they were given (`--firm <slug>`). A login that sees every Firm's rows would be one more thing that could leak.

### Can a Firm with rows be deleted?

**Short answer:** no: every `firm_id` foreign key refuses the delete while the Firm has rows, and row-level security doesn't hide those rows from the check.

Every `firm_id` column points at the Firm's `organization` row with `on delete restrict`: while any row points at a Firm, Postgres refuses to delete that Firm's row, with the error `restrict_violation`. An adviser must keep its records for years ([ADR 0021](../adr/0021-firm-and-delivery-records-cant-be-deleted.md) gives the rule), so a Firm that leaves will be switched off, not deleted. The sign-in library, Better Auth, owns the `organization` table, and it's set up to refuse deleting one before it reaches the database.

You might expect row-level security to get in the way. Say code deletes a Firm as `app` with no Firm set: shouldn't the check that looks for the Firm's rows fail with `Firm not set`, or find nothing? It doesn't. Postgres runs a foreign key's check as the table's owner, with row-level security switched off for it: `ri_PerformCheck` in Postgres's source (`src/backend/utils/adt/ri_triggers.c`) switches to the owner with `SECURITY_NOFORCE_RLS`. So the check sees every row, even on a table that used `FORCE`, and the delete fails with `restrict_violation`. That comes from the source, not from a sentence in the manual, so an integration test checks it: it deletes a Firm as `app` with no Firm set and checks the delete fails and every Firm table keeps its rows.

The same holds the other way. Before this rule, `firm_id` was `on delete cascade` (delete the Firm, and Postgres deletes the rows that point at it), and the cascade ran the same way, as the owner, so the policies never stopped it.

### Does a query that finds nothing still say "Firm not set"?

**Short answer:** usually, but only a query that reads a row is guaranteed to fail.

The `using` test runs once per row a query reads. So a query that reads at least one row always fails without a Firm, and so does every write that writes a row, because the `with check` test runs on every row written.

A query that reads no row never runs the `using` test. Most still fail, for a different reason. Before running a query, Postgres works out how to run it (it plans it), and while planning it calls `current_firm_id()` to guess how many rows the policy will keep. The code sends every query to be planned afresh, so the error comes before any row is read. The tests check an empty table, a filter that matches none of a table's rows, `count(*)`, and asking Postgres only for its plan (`explain`).

Some queries find nothing without an error, for example:

- A query Postgres can tell matches no row before planning how to read the table, such as `where false` or conditions that contradict each other (`where id = 1 and id = 2`). The code writes `inArray(column, [])` (a list of no values) as `false`, and a test checks this case. A write that matches no row this way writes nothing and raises nothing.
- A prepared statement (one the code names and asks Postgres to keep and run again) whose saved plan was made while a Firm was set. Nothing in the code reuses plans today.

Neither leaks anything, since there's nothing to show. They only mean a forgotten `withFirm` could go unnoticed in a query that finds nothing.

### What can't row-level security catch?

**Short answer:** code that asks for the wrong Firm, because then the filter and the policy agree.

RLS compares each row with the Firm the code set. It has no idea which Firm the person really belongs to. If a bug passed Globex's number to `getHouseholdOverview` for Olivia, `withFirm` would set Firm 2, the filter would ask for Firm 2, the policy would allow Firm 2, and the Okafor Household would come back. The filter and the policy both let the rows through, because both were handed the same wrong Firm.

So the Firm must come from one trusted place:

- in the web app, only the session's Firm, through `getViewer` or `requireTenant`, never a URL, a form field or anything else the browser sends
- in a command or a background job, the Firm it was explicitly given: `--firm <slug>`, or the job's own data

### Does row-level security stop an attacker who can run SQL?

**Short answer:** no: SQL running as `app` can set any Firm it likes, so SQL injection still exposes every Firm.

The policies trust `app.firm_id`, and `app` is the role that sets it. Someone who found a way to run their own SQL through the app (SQL injection, from Part 2), or who stole `app`'s password, could start a transaction, call `set_firm_id(2)` or `set_config('app.firm_id', '2', true)` directly, and read Globex's rows. Postgres can't stop a role setting a two-part setting like `app.firm_id`. `set_firm_id`'s refusal to switch Firms inside one transaction guards against bugs, not attackers.

So row-level security guards against a mistake (a query that forgets its Firm), not against an attacker inside the app's connection. The defence against SQL injection is the same as before: every query sends its values as parameters, separate from the SQL text, which the code's query builder does, and nothing on a request path builds SQL by joining strings. Making RLS hold against injected SQL would need a Firm that `app` can't choose, which is a bigger change ([ADR 0020](../adr/0020-firm-isolation-by-row-level-security.md) names the options).

### Why don't the sign-in tables have it?

**Short answer:** because they're read before any Firm is known, or outlive the Firm, so a Firm rule can't apply to them.

Signing in reads `user` and `session` before anyone has picked a Firm. `audit_event` records sign-in attempts that belong to no Firm yet. These tables stay under the older rule from [ADR 0002](../adr/0002-tenant-is-the-sessions-active-organization.md): the code scopes every query to the session's Firm by hand.

## Part 7: What this means for the code (Level 3)

### What rules must the code keep?

1. **A new Firm table gets both helpers.** `firmId()` for the column and `firmIsolation()` for the policy, both in `packages/db/src/schema/_domain.ts`. A test lists every table with a `firm_id` column and fails if one has no policy.
2. **Every function that touches a Firm table goes through `withFirm`,** with the Firm it was given. One that forgets fails in its first test with `Firm not set`.
3. **Keep the `where firm_id = …` filters.** RLS is the second defence, not a replacement.
4. **The Firm comes only from the session, or a command's or job's explicit input.** RLS can't catch a wrong one.
5. **No role bypasses the policies.** Commands and jobs log in as `app`.
6. **Every query stays parameterized.** RLS doesn't stop SQL injection.

## Recap

1. All Firms share one database, so every Firm row carries a `firm_id`, and a query that forgets to filter by it reads every Firm's rows.
2. Cognitive Wealth logs in as `app` (rows only) and `migrator` (owns the database and the tables, runs migrations).
3. Row-level security, turned on per table, checks every row against the table's policies. A policy's `using` test hides rows a role mustn't see; its `with check` test refuses rows it mustn't write.
4. Each Firm table has one policy for `app`: `firm_id = current_firm_id()`.
5. The Firm is the setting `app.firm_id`, set with `set_config(…, true)` so it ends with the transaction and never carries over on a pooled connection.
6. No Firm set is an error, `Firm not set`, so a forgotten Firm fails instead of looking like an empty Firm. It's guaranteed for a query that reads a row and a write that writes one; a query that can match no row may return nothing instead.
7. `withFirm` opens the transaction, sets the Firm and runs the query; every function that touches Firm rows goes through it, and keeps its filters.
8. Table owners, superusers and `BYPASSRLS` roles aren't held; Cognitive Wealth gives no role `BYPASSRLS`. A foreign key's check isn't held either, so it sees a Firm's rows and refuses to delete a Firm that has any.
9. RLS catches a forgotten Firm, never a wrong one, so the Firm must come from the session or a command's own input.
10. RLS doesn't stop SQL injection: SQL running as `app` can set any Firm. Parameterized queries are the defence.

## Check yourself

1. Larkspur is Firm 1 and Globex is Firm 2. With the Firm set to 2, what does `select name from household` return from Part 1's table?

   <details><summary>Answer</summary>

   One row, The Okafor Household. The policy keeps only rows with `firm_id = 2`.

   </details>

2. A `for all` policy has `using (firm_id = current_firm_id())` but no `with check`. With the Firm set to 1, can the code insert a row with `firm_id = 2`?

   <details><summary>Answer</summary>

   No. A `for all` policy with no `with check` uses its `using` test for new rows too (Part 3 quotes the rule), and `2 = 1` is false, so Postgres refuses the insert. Cognitive Wealth writes both out anyway, so nobody reading the policy has to know that rule.

   </details>

3. Why does `set_firm_id` pass `true` as `set_config`'s third argument?

   <details><summary>Answer</summary>

   So the Firm lasts only for the current transaction. The app reuses connections from a pool, and a Firm that outlived its transaction would carry into the next request on that connection, which might be another Firm's.

   </details>

4. A new function reads `household` but forgets `withFirm`, and the test runs it on a table that has rows. What happens?

   <details><summary>Answer</summary>

   It fails with `Firm not set`: the connection has no Firm (null) or an old one's leftover `''`, and `current_firm_id()` raises an error for both. It doesn't return 0 rows.

   </details>

5. A bug passes Firm 2 to `getHouseholdOverview` for Olivia, Larkspur's Advisor. Does row-level security stop it?

   <details><summary>Answer</summary>

   No. `withFirm` sets Firm 2, the filter asks for Firm 2, and the policy allows Firm 2, so the Okafor Household comes back. That's why the Firm may only come from the session's Firm (or a command's own `--firm`).

   </details>

6. An attacker finds a way to run their own SQL through the app. Can they read Globex's Households?

   <details><summary>Answer</summary>

   Yes. Their SQL runs as `app`, which can set `app.firm_id` to 2 itself, with `set_firm_id(2)` or `set_config`. Row-level security guards against forgotten filters, not against SQL injection; parameterized queries are the defence.

   </details>

7. Code running as `app`, with no Firm set, deletes the Larkspur organization in SQL. Larkspur has Households. What happens?

   <details><summary>Answer</summary>

   The delete fails with `restrict_violation`, not `Firm not set`, and the Households stay. Postgres runs the foreign key's check on `household` as the table's owner with row-level security switched off for it, so the check sees Larkspur's Households even though `app` couldn't. An integration test checks this.

   </details>
