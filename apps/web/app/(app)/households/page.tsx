import { Badge } from "@repo/design-system/components/badge";
import { Card } from "@repo/design-system/components/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@repo/design-system/components/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/table";
import { getDb } from "@repo/db/client";
import { listHouseholds } from "@repo/households";
import type { Metadata } from "next";
import Link from "next/link";
import { requireAppViewer } from "@/lib/auth/viewer";
import { RELATIONSHIP_STATUS_LABELS, personName } from "@/lib/households";

export const metadata: Metadata = { title: "Households" };

const HEADING_ID = "households-heading";

// A minimal list, so the sidebar has somewhere to go; slice 28 adds AUM and the rest.
export default async function HouseholdsPage() {
  const { tenant, internal } = await requireAppViewer();
  const households = await listHouseholds(getDb(), internal.organizationId);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 id={HEADING_ID} className="font-heading text-2xl font-semibold tracking-tight">
          Households
        </h1>
        <p className="wrap-anywhere text-muted-foreground">
          The households {tenant.organization.name} serves.
        </p>
      </header>
      {households.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>
              <h2>No households yet</h2>
            </EmptyTitle>
            <EmptyDescription>Households appear here once they&apos;re added.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="py-2">
          <Table aria-labelledby={HEADING_ID}>
            <TableHeader>
              <TableRow>
                <TableHead className="ps-4 sm:ps-6">Household</TableHead>
                <TableHead className="w-32">Status</TableHead>
                <TableHead className="hidden pe-6 sm:table-cell">People</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {households.map((household) => (
                <TableRow key={household.publicId}>
                  <TableCell className="ps-4 whitespace-normal sm:ps-6">
                    <Link
                      href={`/households/${household.publicId}`}
                      className="font-medium wrap-break-word underline-offset-4 hover:underline"
                    >
                      {household.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {RELATIONSHIP_STATUS_LABELS[household.relationshipStatus]}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden pe-6 whitespace-normal text-muted-foreground sm:table-cell">
                    {household.people.map(personName).join(", ")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
