-- The Firm the current transaction works for (ADR 0020), read by every Firm-scoped table's
-- `firm_isolation` policy. `withFirm` (`@repo/db`) sets it with `set_config('app.firm_id', …, true)`,
-- so it ends with the transaction. Unset is an error rather than null, so a query that forgot to set
-- it fails instead of returning no rows: a connection that never set it has no value (null), and one
-- the pool reuses after a transaction that did holds '' from then on.
create function current_firm_id() returns bigint
language plpgsql
stable
set search_path = ''
as $$
declare
  firm text := pg_catalog.current_setting('app.firm_id', true);
begin
  if firm is null or firm = '' then
    raise exception 'Firm not set: query Firm-scoped tables inside withFirm (app.firm_id is empty)'
      using errcode = 'insufficient_privilege';
  end if;
  return firm::bigint;
end
$$;
--> statement-breakpoint
-- Sets the transaction's Firm for `withFirm`, until the transaction ends. Refuses a transaction that
-- already works for another Firm, so a nested `withFirm` can't switch Firms under its caller.
create function set_firm_id(firm bigint) returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  current text := pg_catalog.current_setting('app.firm_id', true);
begin
  if firm is null or firm <= 0 then
    raise exception 'set_firm_id needs a Firm''s id, not %', firm;
  end if;
  if current is not null and current <> '' and current <> firm::text then
    raise exception 'This transaction already works for Firm %, not %', current, firm
      using errcode = 'insufficient_privilege';
  end if;
  perform pg_catalog.set_config('app.firm_id', firm::text, true);
end
$$;
