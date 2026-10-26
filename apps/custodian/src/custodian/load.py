"""Loads the world file's custodian half and a ledger fixture into the custodian's database.

`pnpm --filter custodian world:load` runs it with world/v0.json and fixtures/ledger-v0.json.
Loading adds what is missing and refuses to change what is there, all in one database
transaction, so running it again changes nothing, and a file that disagrees with the database
changes nothing either. Rebuilding a different world means starting from an empty database.

Why refuse rather than overwrite? The Ledger is append-only (GLOSSARY.md, "Ledger"): the `app`
role this runs as can't change or delete a Transaction, and shouldn't. A row that is wrong is
fixed with a Correction, which is new rows, never an edit.
"""

import argparse
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from custodian.build_record import BuildMismatch, market_inputs, record_build
from custodian.cli import script_args
from custodian.database import engine_from_env
from custodian.factor_file import FactorFileError
from custodian.ledger_fixture import (
    LEDGER_V0_PATH,
    FixtureSecurity,
    FixtureTransaction,
    LedgerFixture,
    read_ledger_fixture,
)
from custodian.models import Account, Security, SecurityPrice, Transaction, TransactionKind
from custodian.money import Money, Price, Shares
from custodian.world import WORLD_V0_PATH, CustodianAccount, WorldFile, read_world

__all__ = ["LoadConflict", "load", "main"]


# An exception class: like `class LoadConflict extends Error {}` in TypeScript.
class LoadConflict(Exception):
    """The database already holds something the files would change."""


def load(session: Session, world: WorldFile, ledger: LedgerFixture) -> None:
    # First check that the two files agree with each other, before touching the database.
    numbers = {account.account_number for account in world.custodian.accounts}
    for transaction in ledger.transactions:
        if transaction.account not in numbers:
            raise ValueError(
                f"Transaction {transaction.number}: {transaction.account!r} isn't an Account in"
                " the world file"
            )

    with session.begin():  # commits at the end, or rolls everything back on an error
        accounts = {
            account.account_number: _account(session, account)
            for account in world.custodian.accounts
        }
        securities = {
            security.identifier: _security(session, security) for security in ledger.securities
        }
        for identifier, prices in ledger.prices.items():
            _prices(session, securities[identifier], prices)
        for number, account in accounts.items():
            wanted = [row for row in ledger.transactions if row.account == number]
            already = session.scalars(
                select(Transaction).where(Transaction.account == account).order_by(Transaction.id)
            ).all()
            if already:
                _check_ledger(account, already, wanted)
            else:
                _record_ledger(session, account, wanted, securities)


# The same pattern for each kind of row: look it up by its natural key (an account number, an
# identifier, a Security and a day); add it if it's missing; refuse if it's there but different.


def _account(session: Session, wanted: CustodianAccount) -> Account:
    number = wanted.account_number
    account = session.scalars(select(Account).where(Account.account_number == number)).one_or_none()
    if account is None:
        account = Account(
            account_number=number,
            registration_type=wanted.registration_type,
            opened_on=wanted.opened_on,
        )
        session.add(account)
    elif (account.registration_type, account.opened_on) != (
        wanted.registration_type,
        wanted.opened_on,
    ):
        raise LoadConflict(f"Account {number} is already loaded with other details")
    return account


def _security(session: Session, wanted: FixtureSecurity) -> Security:
    identifier = wanted.identifier
    security = session.scalars(
        select(Security).where(Security.identifier == identifier)
    ).one_or_none()
    if security is None:
        security = Security(identifier=identifier, name=wanted.name, kind=wanted.kind)
        session.add(security)
    elif (security.name, security.kind) != (wanted.name, wanted.kind):
        raise LoadConflict(f"Security {identifier} is already loaded with other details")
    return security


def _prices(session: Session, security: Security, prices: Mapping[date, Price]) -> None:
    loaded = {
        row.price_date: row.price
        for row in session.scalars(select(SecurityPrice).where(SecurityPrice.security == security))
    }
    for day, price in sorted(prices.items()):
        if day not in loaded:
            session.add(SecurityPrice(security=security, price_date=day, price=price))
        elif loaded[day] != price:
            raise LoadConflict(
                f"{security.identifier}'s price on {day} is already {loaded[day]}, not {price}"
            )


def _record_ledger(
    session: Session,
    account: Account,
    wanted: Sequence[FixtureTransaction],
    securities: Mapping[str, Security],
) -> None:
    """Record `wanted` in `account`'s empty Ledger, in order."""
    recorded: dict[int, Transaction] = {}  # by fixture row number, to find what a Reversal undoes
    for row in wanted:
        transaction = Transaction(
            transaction_id=row.transaction_id,
            account=account,
            security=None if row.security is None else securities[row.security],
            kind=row.kind,
            reverses=None if row.reverses is None else recorded[row.reverses],
            trade_date=row.trade_date,
            settlement_date=row.settlement_date,
            posting_date=row.posting_date,
            shares=row.shares,
            amount=row.amount,
        )
        session.add(transaction)
        # One row at a time, so the database numbers them in Ledger order.
        session.flush()
        recorded[row.number] = transaction


@dataclass(frozen=True)
class _LedgerRow:
    """One Transaction as both the database and the fixture can describe it, to compare them.

    A frozen dataclass compares field by field, so two `_LedgerRow`s are equal when every field is.
    """

    transaction_id: str
    kind: TransactionKind
    security: str | None
    reverses: int | None
    """For a Reversal, the place in the Ledger (counting from 0) of the row it undoes."""
    trade_date: date
    settlement_date: date
    posting_date: date
    shares: Shares | None
    amount: Money


def _check_ledger(
    account: Account, already: Sequence[Transaction], wanted: Sequence[FixtureTransaction]
) -> None:
    """Refuse, unless `account`'s Ledger already holds exactly `wanted`, in the same order.

    Transactions have no natural key to look each one up by, so the whole Ledger is compared, row
    by row. Which row a Reversal undoes is compared as its place in the Ledger, since database
    ids and fixture row numbers differ.
    """
    place_of_id = {transaction.id: index for index, transaction in enumerate(already)}
    in_database = [
        _LedgerRow(
            transaction_id=transaction.transaction_id,
            kind=transaction.kind,
            security=None if transaction.security is None else transaction.security.identifier,
            reverses=None
            if transaction.reverses_id is None
            else place_of_id[transaction.reverses_id],
            trade_date=transaction.trade_date,
            settlement_date=transaction.settlement_date,
            posting_date=transaction.posting_date,
            shares=transaction.shares,
            amount=transaction.amount,
        )
        for transaction in already
    ]
    place_of_number = {row.number: index for index, row in enumerate(wanted)}
    in_fixture = [
        _LedgerRow(
            transaction_id=row.transaction_id,
            kind=row.kind,
            security=row.security,
            reverses=None if row.reverses is None else place_of_number[row.reverses],
            trade_date=row.trade_date,
            settlement_date=row.settlement_date,
            posting_date=row.posting_date,
            shares=row.shares,
            amount=row.amount,
        )
        for row in wanted
    ]
    # `zip` pairs the two lists up; `strict=False` stops at the shorter one, checked after.
    for row, found, expected in zip(wanted, in_database, in_fixture, strict=False):
        if found != expected:
            raise LoadConflict(
                f"{account.account_number}'s Ledger differs from the fixture at row {row.number}"
            )
    if len(in_database) != len(in_fixture):
        raise LoadConflict(
            f"{account.account_number}'s Ledger has {len(in_database)} Transactions,"
            f" the fixture {len(in_fixture)}"
        )


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="world:load", description=__doc__)
    parser.add_argument("--world", type=Path, default=WORLD_V0_PATH)
    parser.add_argument("--ledger", type=Path, default=LEDGER_V0_PATH)
    arguments = parser.parse_args(script_args(argv))
    world_path: Path = arguments.world
    ledger_path: Path = arguments.ledger
    try:
        world = read_world(world_path)
        ledger = read_ledger_fixture(ledger_path)
    except ValidationError as error:
        # The message names each bad field, such as custodian.accounts.1.registration_type.
        raise SystemExit(f"{error.title} is malformed:\n{error}") from None

    # Market data first, with nothing written yet: the verified Factor file (downloaded into the
    # cache on a first run) and the inputs it and the Treasury yields make.
    try:
        inputs = market_inputs()
    except FactorFileError as error:
        raise SystemExit(f"Nothing was loaded: {error}") from None

    engine = engine_from_env()
    try:
        with Session(engine) as session:
            # Before any row: an empty database records the inputs, any other must match them.
            record_build(session, inputs)
            load(session, world, ledger)
    except (BuildMismatch, LoadConflict) as error:
        raise SystemExit(f"Nothing was loaded: {error}") from None
    finally:
        engine.dispose()
    prices = sum(len(by_day) for by_day in ledger.prices.values())
    print(
        f"Loaded {len(world.custodian.accounts)} Accounts, {len(ledger.securities)} Securities,"
        f" {prices} prices and {len(ledger.transactions)} Transactions"
    )


if __name__ == "__main__":
    main()
