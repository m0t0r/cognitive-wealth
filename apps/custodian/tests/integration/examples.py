"""Rows the tests build, named after Dana's Account in docs/learn/01-ledger-positions-and-dates.md.

Each call returns new, unsaved objects, so tests never share one.
"""

from datetime import date

from custodian.models import Account, RegistrationType, Security, SecurityKind


def danas_account() -> Account:
    return Account(
        account_number="CW-000001",
        registration_type=RegistrationType.INDIVIDUAL,
        opened_on=date(2026, 2, 26),
    )


def bond_fund() -> Security:
    return Security(identifier="LKBF", name="Larkspur Bond Fund", kind=SecurityKind.FUND)
