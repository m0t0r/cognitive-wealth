// Ending an Account role or a Household membership (#192): the row is closed by setting its end
// date, never deleted, and the `record_history()` trigger keeps the old version with who ended it
// (ADR 0025). So the row's `ends_on` is when it ended in the world, and its history's `valid_until`
// when the Firm recorded that, which can differ (docs/research/crm-end-dates.md). An end is never
// re-dated: corrections are phase 4's.
import type { Database } from "@repo/db";
import { type Actor, setActor } from "@repo/db/actor";
import { withFirm } from "@repo/db/firm";
import { accountRole, household, householdMember, person } from "@repo/db/schema";
import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import { z } from "zod";

const PublicId = z.uuid();

/** Who ends a row: a User, or a named system process. A Delivery never does. */
type EndActor = Exclude<Actor, { deliveryId: number }>;

export type EndResult = { status: "ended" | "not_found" | "already_ended" | "before_start" };

type EndAccountRoleArgs = {
  firmId: number;
  actor: EndActor;
  publicId: string;
  /** The first day the role no longer holds: the day of the event that ended it. */
  endsOn: string;
};

/**
 * Ends the Firm `firmId`'s Account role `publicId` on `endsOn`. Another Firm's role is as unknown
 * as one that doesn't exist. `withFirm` throws `FirmDeactivatedError` for a Deactivated Firm.
 */
export async function endAccountRole(
  db: Database,
  { firmId, actor, publicId, endsOn }: EndAccountRoleArgs,
): Promise<EndResult> {
  // Postgres refuses to compare a `uuid` column with text that isn't one.
  if (!PublicId.safeParse(publicId).success) return { status: "not_found" };
  return withFirm(db, {
    firmId,
    query: async (tx) => {
      await setActor(tx, actor);
      const thisRole = and(eq(accountRole.firmId, firmId), eq(accountRole.publicId, publicId));
      // One statement, so of two racing ends the second finds the row ended, not open.
      const ended = await tx
        .update(accountRole)
        .set({ endsOn })
        .where(and(thisRole, isNull(accountRole.endsOn), lte(accountRole.startsOn, endsOn)))
        .returning({ id: accountRole.id });
      if (ended.length > 0) return { status: "ended" };
      const [found] = await tx
        .select({ endsOn: accountRole.endsOn })
        .from(accountRole)
        .where(thisRole);
      if (!found) return { status: "not_found" };
      return { status: found.endsOn === null ? "before_start" : "already_ended" };
    },
  });
}

type EndHouseholdMembershipArgs = {
  firmId: number;
  actor: EndActor;
  householdPublicId: string;
  personPublicId: string;
  /** The first day the Person is no longer in the Household: the day they left. */
  endsOn: string;
};

/**
 * Ends the membership of the Person `personPublicId` in the Household `householdPublicId`, both the
 * Firm `firmId`'s, on `endsOn`. Only the row that hasn't ended is touched, so a Person who left and
 * rejoined can leave again. `withFirm` throws `FirmDeactivatedError` for a Deactivated Firm.
 */
export async function endHouseholdMembership(
  db: Database,
  { firmId, actor, householdPublicId, personPublicId, endsOn }: EndHouseholdMembershipArgs,
): Promise<EndResult> {
  if (!PublicId.safeParse(householdPublicId).success) return { status: "not_found" };
  if (!PublicId.safeParse(personPublicId).success) return { status: "not_found" };
  return withFirm(db, {
    firmId,
    query: async (tx) => {
      await setActor(tx, actor);
      const thisMembership = and(
        eq(householdMember.firmId, firmId),
        inArray(
          householdMember.householdId,
          tx
            .select({ id: household.id })
            .from(household)
            .where(and(eq(household.firmId, firmId), eq(household.publicId, householdPublicId))),
        ),
        inArray(
          householdMember.personId,
          tx
            .select({ id: person.id })
            .from(person)
            .where(and(eq(person.firmId, firmId), eq(person.publicId, personPublicId))),
        ),
      );
      const ended = await tx
        .update(householdMember)
        .set({ endsOn })
        .where(
          and(
            thisMembership,
            isNull(householdMember.endsOn),
            lte(householdMember.startsOn, endsOn),
          ),
        )
        .returning({ id: householdMember.id });
      if (ended.length > 0) return { status: "ended" };
      // Only the row that hasn't ended can be too early; the rest say it already happened.
      const rows = await tx
        .select({ endsOn: householdMember.endsOn })
        .from(householdMember)
        .where(thisMembership);
      if (rows.length === 0) return { status: "not_found" };
      return { status: rows.some((row) => row.endsOn === null) ? "before_start" : "already_ended" };
    },
  });
}
