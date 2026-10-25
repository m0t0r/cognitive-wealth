import { SparklesIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { can } from "@repo/auth/access";
import { buttonVariants } from "@repo/design-system/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/design-system/components/empty";
import { getDb } from "@repo/db/client";
import { listHouseholds } from "@repo/households";
import type { Metadata } from "next";
import Link from "next/link";
import { YOUR_ROLE } from "@/lib/roles";
import { requireAppViewer } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Home" };

export default async function HomePage() {
  const { user, tenant, internal } = await requireAppViewer();
  // Temporary, until the Households list (slice 28) replaces it: a way to reach each Household.
  const households = await listHouseholds(getDb(), internal.organizationId);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight wrap-anywhere">
          Welcome, {user.name}
        </h1>
        <p className="wrap-anywhere text-muted-foreground">
          {YOUR_ROLE[tenant.role](tenant.organization.name)}
        </p>
      </header>
      {households.length === 0 ? null : (
        <section aria-labelledby="households-heading" className="flex flex-col gap-4">
          <h2 id="households-heading" className="font-heading text-lg font-medium">
            Households
          </h2>
          <ul className="flex flex-col gap-2">
            {households.map((household) => (
              <li key={household.publicId}>
                <Link
                  href={`/households/${household.publicId}`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {household.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={SparklesIcon} strokeWidth={2} aria-hidden />
          </EmptyMedia>
          <EmptyTitle>
            <h2>More is on the way</h2>
          </EmptyTitle>
          <EmptyDescription className="wrap-anywhere">
            Tools for {tenant.organization.name} will appear here as they&apos;re ready.
          </EmptyDescription>
        </EmptyHeader>
        {can(tenant.role, "invitation:create") ? (
          <EmptyContent>
            <Link href="/settings/members" className={buttonVariants()}>
              Invite people
            </Link>
          </EmptyContent>
        ) : null}
      </Empty>
    </div>
  );
}
