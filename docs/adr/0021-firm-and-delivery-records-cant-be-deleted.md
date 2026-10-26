# ADR 0021: A Firm or Delivery with records can't be deleted

- Status: accepted
- Date: 2026-10-26
- Supersedes: [ADR 0020](0020-firm-isolation-by-row-level-security.md)'s point 8, "Deleting a Firm still cascades"

Cognitive Wealth plays an SEC-registered investment adviser, which keeps most of its records for at least five years from the end of the fiscal year of their last entry (Rule 204-2(e)(1), [17 CFR 275.204-2](https://www.ecfr.gov/current/title-17/section/275.204-2)) and safeguards electronic ones "from loss, alteration, or destruction" (204-2(g)(3)(i)). The schema didn't hold to that. One `deleteOrganization` call from server code erased every row of a Firm, because every `firm_id` pointed at `organization` with `on delete cascade`; deleting a Delivery erased the Transactions, Positions and prices it carried; and deleting a Firm nulled its audit events' `organization_id`, so the log no longer said whose it was. The browser can't reach the delete endpoint (ADR 0004), but server code, Better Auth and SQL as `app` could. #189 tracks the whole rule; this is its first step (#191).

1. **A Firm with records can't be deleted.** `firmId()` (`packages/db/src/schema/_domain.ts`) references `organization.id` with `on delete restrict`, so every Firm-scoped table refuses the delete while it holds a row of that Firm (SQLSTATE `23001`, `restrict_violation`), for every role, `app` and `migrator` alike. A catalog test (`firm-isolation.integration.test.ts`) fails when a `firm_id` foreign key does anything else.
2. **Row-level security doesn't hide the rows from that check.** Postgres runs a foreign key's checks as the referencing table's owner with row-level security not forced (`ri_PerformCheck`, the same path ADR 0020 point 8 described for the cascade), so a delete as `app` with no Firm set still sees the Firm's rows and fails with `restrict_violation`, not `Firm not set`.
3. **A Delivery with rows can't be deleted.** The `(firm_id, delivery_id)` foreign keys from `custodial_transaction`, `custodial_position` and `security_price` to `custodian_delivery` are `on delete restrict`. A Delivery that carried no rows can still go.
4. **Audit events keep their Firm.** `audit_event.organization_id` is `on delete restrict` instead of `set null`. Almost every Firm has events, so in practice no Firm can be deleted at all. An event still loses its actor when a user is deleted; that's #110.
5. **Better Auth refuses first.** `organization({ disableOrganizationDeletion: true })`: `auth.api.deleteOrganization` answers `404` before it reaches the database.
6. **What still cascades.** `member` and `invitation` from `organization` (a Firm with no records, say one created by mistake, can still be removed with them), `session.active_organization_id` (`set null`), and the CRM tables' links to each other, which #192 changes.

## Consequences

- A Firm that leaves is deactivated, not deleted; what that means (members, sessions, sign-in, access to its records afterwards) is #195.
- Destroying records for good, once their retention period is over, needs its own path: a destruction step that deletes children before parents, under a legal-hold check. That's #194, which may revisit point 4.
- A test or tool that cleans up by deleting an organization now fails once the Firm has rows. Integration tests don't need to: each test gets its own database, which is dropped.
