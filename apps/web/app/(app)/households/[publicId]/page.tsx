import { getDb } from "@repo/db/client";
import { getHouseholdOverview } from "@repo/households";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { cache } from "react";
import { AccountSection } from "@/components/households/account-section";
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

// "Dana Reyes (Primary) and Jordan Reyes (Co-client)".
const PEOPLE = new Intl.ListFormat("en-US", { type: "conjunction" });

export async function generateMetadata({
  params,
}: PageProps<"/households/[publicId]">): Promise<Metadata> {
  const { name } = await householdOverview((await params).publicId);
  return { title: name };
}

// The editorial layout chosen in the #41 prototype (branch prototype/household-overview-layout).
export default async function HouseholdPage({ params }: PageProps<"/households/[publicId]">) {
  const household = await householdOverview((await params).publicId);
  const { asOf } = household;
  const positions = household.accounts.flatMap((account) => account.positions).length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col">
      <header className="flex flex-col gap-3 border-b pb-8">
        {/* Dark --primary is a fill colour (2.6:1 as text on the dark background); sky-400 is the
            preset's sky theme at a text contrast that passes AA. */}
        <p className="text-sm font-medium text-primary dark:text-sky-400">
          Household · {RELATIONSHIP_STATUS_LABELS[household.relationshipStatus]}
        </p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight wrap-anywhere sm:text-4xl">
          {household.name}
        </h1>
        <p className="text-muted-foreground">
          {household.people.length === 0
            ? "No one is in this household yet."
            : PEOPLE.format(
                household.people.map(
                  (person) =>
                    `${personName(person)} (${HOUSEHOLD_ROLE_LABELS[person.householdRole]})`,
                ),
              )}
        </p>
      </header>

      {/* Hairlines from a 1px gap over the border colour, in two columns or four. */}
      <dl className="grid grid-cols-2 gap-px border-b bg-border sm:grid-cols-4">
        <Figure term="Total value" note="Arrives with AUM">
          <span className="text-muted-foreground">—</span>
        </Figure>
        <Figure term="Accounts">{household.accounts.length}</Figure>
        <Figure term="Positions">{positions}</Figure>
        <Figure
          term="As of"
          note={asOf === null ? "Nothing from the custodian yet" : "As the custodian reported it"}
        >
          {asOf === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <time dateTime={asOf}>{formatIsoDate(asOf)}</time>
          )}
        </Figure>
      </dl>

      {household.accounts.length === 0 ? (
        <p className="py-8 text-sm text-muted-foreground">
          No one in this household holds an account yet.
        </p>
      ) : (
        household.accounts.map((account) => (
          <AccountSection key={account.publicId} account={account} asOf={asOf} />
        ))
      )}
    </div>
  );
}

type FigureProps = { term: string; note?: string; children: ReactNode };

/** One figure of the summary row, between hairlines. */
function Figure({ term, note, children }: FigureProps) {
  return (
    <div className="flex flex-col gap-1 bg-background p-4 sm:p-5">
      <dt className="text-sm text-muted-foreground">{term}</dt>
      <dd className="font-heading text-xl font-semibold tabular-nums sm:text-2xl">{children}</dd>
      {note === undefined ? null : <dd className="text-xs text-muted-foreground">{note}</dd>}
    </div>
  );
}
