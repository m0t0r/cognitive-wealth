import type { NamedOnAccount, OverviewPerson } from "@repo/households";
import { ACCOUNT_ROLE_LABELS, REGISTRATION_TYPE_LABELS, personName } from "@/lib/households";
import { MaskedEnding } from "./account-section";

type NamedOnSectionProps = {
  /** The Household's People; only those with Named-on Accounts are shown. */
  people: OverviewPerson[];
};

/**
 * The Accounts the Household's People are only named on (GLOSSARY.md, "Named-on Account"), under
 * each Person, after the Household's own Accounts and apart from them: they're owned in another
 * Household, so no figure on the page counts them. Nothing at all when no one has any.
 */
export function NamedOnSection({ people }: NamedOnSectionProps) {
  const named = people.filter((person) => person.namedOnAccounts.length > 0);
  if (named.length === 0) return null;

  return (
    <section
      aria-labelledby="named-on"
      className="grid gap-6 border-b py-8 md:grid-cols-[14rem_1fr] md:gap-10"
    >
      <div className="flex flex-col gap-2">
        <h2 id="named-on" className="font-heading text-lg font-medium">
          Also named on
        </h2>
        <p className="text-sm text-muted-foreground">
          Accounts owned outside this household, so they're not counted here.
        </p>
      </div>
      <div className="flex flex-col gap-6">
        {named.map((person) => (
          <PersonNamedOn key={person.publicId} person={person} />
        ))}
      </div>
    </section>
  );
}

function PersonNamedOn({ person }: { person: OverviewPerson }) {
  const name = personName(person);

  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-medium wrap-break-word">{name}</h3>
      <ul aria-label={`${name} is also named on`} className="flex flex-col gap-3 text-sm">
        {person.namedOnAccounts.map((account) => (
          <li key={`${account.publicId}-${account.role}`} className="flex flex-col gap-0.5">
            <span className="tabular-nums">
              {account.registrationType === null
                ? "Account"
                : REGISTRATION_TYPE_LABELS[account.registrationType]}{" "}
              <MaskedEnding ending={account.accountNumberEnding} />
            </span>
            <span className="text-muted-foreground wrap-break-word">
              {ACCOUNT_ROLE_LABELS[account.role]} · <OwningHousehold account={account} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OwningHousehold({ account }: { account: NamedOnAccount }) {
  return account.owningHousehold === null
    ? "Owner isn't in a household"
    : account.owningHousehold.name;
}
