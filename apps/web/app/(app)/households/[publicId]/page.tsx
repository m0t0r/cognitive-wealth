import { Badge } from "@repo/design-system/components/badge";
import { Card } from "@repo/design-system/components/card";
import { getDb } from "@repo/db/client";
import { getHouseholdOverview } from "@repo/households";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { AccountCard } from "@/components/households/account-card";
import { requireAppViewer } from "@/lib/auth/viewer";
import { formatIsoDate } from "@/lib/format";
import { HOUSEHOLD_ROLE_LABELS, RELATIONSHIP_STATUS_LABELS, personName } from "@/lib/households";

// The metadata and the page both need the Household: one lookup per request.
const householdOverview = cache(async (publicId: string) => {
  const { internal } = await requireAppViewer();
  // Scoped to the viewer's Firm (ADR 0002): another Firm's Household is as unknown as a made-up id.
  const overview = await getHouseholdOverview(getDb(), {
    firmId: internal.organizationId,
    publicId,
  });
  if (overview === null) notFound();
  return overview;
});

export async function generateMetadata({
  params,
}: PageProps<"/households/[publicId]">): Promise<Metadata> {
  const { name } = await householdOverview((await params).publicId);
  return { title: name };
}

export default async function HouseholdPage({ params }: PageProps<"/households/[publicId]">) {
  const household = await householdOverview((await params).publicId);
  const { asOf } = household;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight wrap-anywhere">
            {household.name}
          </h1>
          <Badge variant="outline">
            {RELATIONSHIP_STATUS_LABELS[household.relationshipStatus]}
          </Badge>
        </div>
        <p className="text-muted-foreground">
          {asOf === null ? (
            "Nothing has arrived from the custodian yet, so there are no positions to show."
          ) : (
            <>
              Positions as of <time dateTime={asOf}>{formatIsoDate(asOf)}</time>, as reported by the
              custodian.
            </>
          )}
        </p>
      </header>

      <section aria-labelledby="people-heading" className="flex flex-col gap-4">
        <h2 id="people-heading" className="font-heading text-lg font-medium">
          People
        </h2>
        {household.people.length === 0 ? (
          <p className="text-sm text-muted-foreground">No one is in this household yet.</p>
        ) : (
          <Card className="py-2">
            <ul className="divide-y">
              {household.people.map((person) => (
                <li
                  key={person.publicId}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-6"
                >
                  <span className="font-medium wrap-anywhere">{personName(person)}</span>
                  <span className="text-muted-foreground">
                    {HOUSEHOLD_ROLE_LABELS[person.householdRole]}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section aria-labelledby="accounts-heading" className="flex flex-col gap-4">
        <h2 id="accounts-heading" className="font-heading text-lg font-medium">
          Accounts
        </h2>
        {household.accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No one in this household holds an account yet.
          </p>
        ) : (
          household.accounts.map((account) => (
            <AccountCard key={account.publicId} account={account} asOf={asOf} />
          ))
        )}
      </section>
    </div>
  );
}
