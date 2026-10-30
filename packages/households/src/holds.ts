// What holds on a day (#192, GLOSSARY.md, "Account role"): a membership or Account role holds on day
// D when `starts_on <= D` and (`ends_on` is null or `D < ends_on`). An ended row is kept, so every
// read of the two tables goes through these.
import { accountRole, householdMember } from "@repo/db/schema";
import { type SQL, type SQLWrapper, and, gt, isNull, lte, or } from "drizzle-orm";

export const membershipHolds = (on: SQLWrapper | string): SQL | undefined =>
  and(
    lte(householdMember.startsOn, on),
    or(isNull(householdMember.endsOn), gt(householdMember.endsOn, on)),
  );

export const roleHolds = (on: SQLWrapper | string): SQL | undefined =>
  and(lte(accountRole.startsOn, on), or(isNull(accountRole.endsOn), gt(accountRole.endsOn, on)));

/** Today as a date, in UTC, as the Custodian's dates are. */
export const today = (): string => new Date().toISOString().slice(0, 10);
