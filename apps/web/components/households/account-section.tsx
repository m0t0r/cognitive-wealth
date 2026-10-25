import type { OverviewAccount, PublicPosition } from "@repo/households";
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

type AccountSectionProps = {
  account: OverviewAccount;
  /** The overview's As-of date; null before the first Delivery. */
  asOf: string | null;
};

/**
 * One Account as a section between hairlines: who it is and who holds it on the left, its
 * Positions on the right (the editorial layout chosen in the #41 prototype).
 */
export function AccountSection({ account, asOf }: AccountSectionProps) {
  const headingId = `account-${account.publicId}`;

  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-6 border-b py-8 md:grid-cols-[14rem_1fr] md:gap-10"
    >
      <div className="flex flex-col gap-3">
        <h2 id={headingId} className="font-heading text-lg font-medium">
          {account.registrationType === null
            ? "Account"
            : REGISTRATION_TYPE_LABELS[account.registrationType]}{" "}
          <MaskedAccountNumber ending={account.accountNumberEnding} />
        </h2>
        {account.roles.length === 0 ? null : (
          <ul aria-label="Account roles" className="flex flex-col gap-1 text-sm">
            {account.roles.map(({ person, role }) => (
              <li key={`${person.publicId}-${role}`} className="wrap-break-word">
                {personName(person)}{" "}
                <span className="text-muted-foreground">· {ACCOUNT_ROLE_LABELS[role]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {asOf === null ? (
        <p className="text-sm text-muted-foreground md:pt-1">No positions to show yet.</p>
      ) : account.positions.length === 0 ? (
        <p className="text-sm text-muted-foreground md:pt-1">
          No positions on {formatIsoDate(asOf)}.
        </p>
      ) : (
        <PositionsTable positions={account.positions} labelledBy={headingId} />
      )}
    </section>
  );
}

/** "••••0001" on its own line under the Account's name. */
function MaskedAccountNumber({ ending }: { ending: string }) {
  return (
    <span className="mt-1 block text-sm font-normal text-muted-foreground tabular-nums">
      <MaskedEnding ending={ending} />
    </span>
  );
}

/** "••••0001", read out as "ending in 0001". */
export function MaskedEnding({ ending }: { ending: string }) {
  return (
    <>
      <span aria-hidden="true">••••</span>
      <span className="sr-only">ending in </span>
      {ending}
    </>
  );
}

const HEAD =
  "h-auto pb-2 align-bottom text-xs font-normal tracking-wide whitespace-normal text-muted-foreground uppercase sm:whitespace-nowrap";

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
        <TableRow className="hover:bg-transparent">
          <TableHead className={`${HEAD} ps-0`}>Security</TableHead>
          {/* From sm up, fixed widths line the columns up from one Account to the next. On a phone
              the columns size to their content and the headers may wrap, so nothing is clipped at
              320px. */}
          <TableHead className={`${HEAD} px-2 text-end sm:w-28 sm:px-3`}>Shares</TableHead>
          <TableHead className={`${HEAD} hidden w-28 text-end sm:table-cell`}>Price</TableHead>
          <TableHead className={`${HEAD} ps-2 pe-0 text-end sm:w-36 sm:ps-3`}>
            Market value
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {positions.map((position) => (
          <TableRow key={position.publicId} className="border-dashed hover:bg-transparent">
            <TableCell className="ps-0 py-3.5 whitespace-normal">
              <span className="font-medium wrap-break-word">{position.security.name}</span>{" "}
              <span className="text-xs text-muted-foreground">{position.security.identifier}</span>
            </TableCell>
            <TableCell className="px-2 py-3.5 text-end tabular-nums sm:px-3">
              {formatShares(position.shares)}
              {/* On a phone the Price column folds in here, so every figure stays on screen. */}
              <span className="block text-muted-foreground sm:hidden">
                {position.price === null ? <NoPrice /> : `at ${formatPrice(position.price)}`}
              </span>
            </TableCell>
            <TableCell className="hidden py-3.5 text-end text-muted-foreground tabular-nums sm:table-cell">
              {position.price === null ? <NoPrice /> : formatPrice(position.price)}
            </TableCell>
            <TableCell className="ps-2 pe-0 py-3.5 text-end font-medium tabular-nums sm:ps-3">
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
  return <span className="font-normal text-muted-foreground">No price</span>;
}
