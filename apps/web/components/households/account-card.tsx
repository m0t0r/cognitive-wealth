import type { OverviewAccount, PublicPosition } from "@repo/households";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/table";
import { formatIsoDate, formatMoney, formatPrice, formatShares } from "@/lib/format";
import { ACCOUNT_ROLE_LABELS, REGISTRATION_TYPE_LABELS, personName } from "@/lib/households";

type AccountCardProps = {
  account: OverviewAccount;
  /** The overview's As-of date; null before the first Delivery. */
  asOf: string | null;
};

/** One Account: its Registration type, masked number, who holds it, and its Positions. */
export function AccountCard({ account, asOf }: AccountCardProps) {
  const headingId = `account-${account.publicId}`;
  const roles = account.roles
    .map(({ person, role }) => `${personName(person)}, ${ACCOUNT_ROLE_LABELS[role]}`)
    .join(" · ");

  return (
    <Card className="pb-2">
      <CardHeader>
        <CardTitle>
          <h3 id={headingId}>
            {account.registrationType === null
              ? "Account"
              : REGISTRATION_TYPE_LABELS[account.registrationType]}{" "}
            <MaskedAccountNumber ending={account.accountNumberEnding} />
          </h3>
        </CardTitle>
        {roles === "" ? null : <CardDescription className="wrap-anywhere">{roles}</CardDescription>}
      </CardHeader>
      {asOf === null ? null : account.positions.length === 0 ? (
        <CardContent className="pb-4">
          <p className="text-muted-foreground">No positions on {formatIsoDate(asOf)}.</p>
        </CardContent>
      ) : (
        <PositionsTable positions={account.positions} labelledBy={headingId} />
      )}
    </Card>
  );
}

/** "••••0001", read out as "ending in 0001". */
function MaskedAccountNumber({ ending }: { ending: string }) {
  return (
    <span className="font-normal text-muted-foreground tabular-nums">
      <span aria-hidden="true">••••</span>
      <span className="sr-only">ending in </span>
      {ending}
    </span>
  );
}

/** Each Position as the Custodian reported it: Cognitive Wealth does no arithmetic on them yet. */
function PositionsTable({
  positions,
  labelledBy,
}: {
  positions: PublicPosition[];
  labelledBy: string;
}) {
  return (
    <Table aria-labelledby={labelledBy}>
      <TableHeader>
        <TableRow>
          <TableHead className="ps-4 sm:ps-6">Security</TableHead>
          {/* Fixed widths, so the columns line up from one Account's table to the next. */}
          <TableHead className="w-28 text-end">Shares</TableHead>
          <TableHead className="hidden w-28 text-end sm:table-cell">Price</TableHead>
          <TableHead className="w-32 pe-4 text-end sm:w-36 sm:pe-6">Market value</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {positions.map((position) => (
          <TableRow key={position.publicId}>
            <TableCell className="ps-4 whitespace-normal sm:ps-6">
              <div className="flex flex-col">
                <span className="font-medium wrap-break-word">{position.security.name}</span>
                <span className="text-muted-foreground">{position.security.identifier}</span>
              </div>
            </TableCell>
            <TableCell className="text-end tabular-nums">
              {formatShares(position.shares)}
              {/* On a phone the Price column folds in here, so every figure stays on screen. */}
              <span className="block text-muted-foreground sm:hidden">
                {position.price === null ? <NoPrice /> : `at ${formatPrice(position.price)}`}
              </span>
            </TableCell>
            <TableCell className="hidden text-end tabular-nums sm:table-cell">
              {position.price === null ? <NoPrice /> : formatPrice(position.price)}
            </TableCell>
            <TableCell className="pe-4 text-end tabular-nums sm:pe-6">
              {position.marketValue === null ? <NoPrice /> : formatMoney(position.marketValue)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** A Security the Custodian had no price for yet (ADR 0016): no figure, rather than $0.00. */
function NoPrice() {
  return <span className="text-muted-foreground">No price</span>;
}
