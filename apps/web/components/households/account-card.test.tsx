import type { OverviewAccount, PublicPosition } from "@repo/households";
import { render, screen, within } from "@repo/testing/react";
import { AccountCard } from "./account-card";

// What the overview holds is owned by packages/households/src/overview.integration.test.ts; the
// number formats by lib/format.test.ts. Here: what the card shows for each state of an Account.

const dana = { publicId: "p-dana", firstName: "Dana", lastName: "Reyes" };
const jordan = { publicId: "p-jordan", firstName: "Jordan", lastName: "Reyes" };

const position = (overrides: Partial<PublicPosition>): PublicPosition => ({
  publicId: "pos-1",
  security: { publicId: "s-1", identifier: "LKSF", name: "Larkspur Stock Fund" },
  shares: "30.000000",
  price: "153.40",
  marketValue: "4602.00",
  ...overrides,
});

const account = (overrides: Partial<OverviewAccount>): OverviewAccount => ({
  publicId: "a-1",
  accountNumberEnding: "0002",
  registrationType: "traditional_ira",
  roles: [
    { person: dana, role: "owner" },
    { person: jordan, role: "beneficiary" },
  ],
  positions: [position({})],
  ...overrides,
});

describe("AccountCard", () => {
  it("names the Account by its Registration type and masked number, and labels its table", async () => {
    const { container } = render(<AccountCard account={account({})} asOf="2026-03-06" />);

    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "Traditional IRA ••••ending in 0002",
    );
    expect(screen.getByText("Dana Reyes, Owner · Jordan Reyes, Beneficiary")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Traditional IRA ending in 0002" });
    const [, row] = within(table).getAllByRole("row");
    expect(row).toHaveTextContent("Larkspur Stock FundLKSF30at $153.40$153.40$4,602.00");
    await expect(container).toHaveNoA11yViolations();
  });

  it("shows no price, not $0.00, for a Security the Custodian hadn't priced", () => {
    render(
      <AccountCard
        account={account({ positions: [position({ price: null, marketValue: null })] })}
        asOf="2026-03-06"
      />,
    );

    const [, row] = within(screen.getByRole("table")).getAllByRole("row");
    expect(within(row!).getAllByText("No price")).toHaveLength(3);
    expect(row).not.toHaveTextContent("$");
  });

  it("says when an Account held nothing on the As-of date", () => {
    render(<AccountCard account={account({ positions: [] })} asOf="2026-03-06" />);

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("No positions on Mar 6, 2026.")).toBeInTheDocument();
  });

  it("before the first Delivery, has no Registration type and no Positions to show", () => {
    render(
      <AccountCard account={account({ registrationType: null, positions: [] })} asOf={null} />,
    );

    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "Account ••••ending in 0002",
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(/No positions/)).not.toBeInTheDocument();
  });
});
