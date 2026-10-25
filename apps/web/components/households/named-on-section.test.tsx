import type { NamedOnAccount, OverviewPerson } from "@repo/households";
import { render, screen, within } from "@repo/testing/react";
import { NamedOnSection } from "./named-on-section";

// Which Accounts a Person is named on is owned by
// packages/households/src/overview.integration.test.ts. Here: how the section shows them, and that
// it shows nothing for People with none.

const namedOn = (overrides: Partial<NamedOnAccount>): NamedOnAccount => ({
  publicId: "a-3",
  accountNumberEnding: "0003",
  registrationType: "traditional_ira",
  role: "beneficiary",
  owningHousehold: { publicId: "h-grace", name: "The Grace Reyes Household" },
  ...overrides,
});

const person = (overrides: Partial<OverviewPerson>): OverviewPerson => ({
  publicId: "p-dana",
  firstName: "Dana",
  lastName: "Reyes",
  householdRole: "primary",
  namedOnAccounts: [],
  ...overrides,
});

const dana = person({});
const jordan = person({
  publicId: "p-jordan",
  firstName: "Jordan",
  householdRole: "co_client",
  namedOnAccounts: [
    namedOn({}),
    namedOn({ role: "power_of_attorney" }),
    namedOn({
      publicId: "a-4",
      accountNumberEnding: "0004",
      registrationType: null,
      role: "custodian",
      owningHousehold: null,
    }),
  ],
});

describe("NamedOnSection", () => {
  it("lists each Person's Named-on Accounts under their name, with the role and whose they are", async () => {
    const { container } = render(<NamedOnSection people={[dana, jordan]} />);

    const section = screen.getByRole("region", { name: "Also named on" });
    expect(
      within(section)
        .getAllByRole("heading", { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(["Jordan Reyes"]);
    expect(
      within(within(section).getByRole("list", { name: "Jordan Reyes is also named on" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Traditional IRA ••••ending in 0003Beneficiary · The Grace Reyes Household",
      "Traditional IRA ••••ending in 0003Power of attorney · The Grace Reyes Household",
      "Account ••••ending in 0004Custodian for a minor · Owner isn't in a household",
    ]);
    expect(within(section).getByText(/not counted/)).toBeVisible();
    await expect(container).toHaveNoA11yViolations();
  });

  it("shows nothing when no one is named on an Account outside the household", () => {
    const { container } = render(<NamedOnSection people={[dana]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
