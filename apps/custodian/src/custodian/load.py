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
from datetime import date
from pathlib import Path

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from custodian.database import engine_from_env
from custodian.ledger_fixture import (
    LEDGER_V0_PATH,
    FixtureSecurity,
    FixtureTransaction,
    LedgerFixture,
    read_ledger_fixture,
)
from custodian.models import Account, Security, SecurityPrice, Transaction
from custodian.money import Price
from custodian.world import WORLD_V0_PATH, CustodianAccount, WorldFile, read_world

__all__ = ["LoadConflict", "load", "main"]


# An exception class: like `class LoadConflict extends Error {}` in TypeScript.
class LoadConflict(Exception):
    """The database already holds something the files would change."""


def load(session: Session, world: WorldFile, ledger: LedgerFixture) -> None:
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
        for row in ledger.transactions:
            if row.account not in accounts:
                raise ValueError(f"row {row.row}: {row.account!r} isn't in the world file")
        recorded: dict[int, Transaction] = {}
        for number, account in accounts.items():
            rows = [row for row in ledger.transactions if row.account == number]
            _ledger(session, account, rows, securities, recorded)


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


def _ledger(
    session: Session,
    account: Account,
    rows: Sequence[FixtureTransaction],
    securities: Mapping[str, Security],
    recorded: dict[int, Transaction],
) -> None:
    """Record `rows` in an empty Ledger, or check they are what `account`'s Ledger holds."""
    already = session.scalars(
        select(Transaction).where(Transaction.account == account).order_by(Transaction.id)
    ).all()
    if not already:
        for row in rows:
            transaction = Transaction(
                account=account,
                security=None if row.security is None else securities[row.security],
                kind=row.kind,
                reverses=None if row.reverses is None else recorded[row.reverses],
                trade_date=row.trade_date,
                settlement_date=row.settlement_date,
                posting_date=row.posted_on,
                shares=row.shares,
                amount=row.amount,
            )
            session.add(transaction)
            # One row at a time, so the database numbers them in Ledger order.
            session.flush()
            recorded[row.row] = transaction
        return

    # Transactions have no natural key, so the whole Ledger is compared, row by row, in the order
    # it was recorded. Which Transaction a Reversal undoes is compared as its place in that order,
    # since database ids differ from the fixture's row numbers.
    place = {transaction.id: index for index, transaction in enumerate(already)}
    row_place = {row.row: index for index, row in enumerate(rows)}
    for transaction, row in zip(already, rows, strict=False):
        in_database = (
            transaction.kind,
            transaction.security.identifier if transaction.security else None,
            None if transaction.reverses_id is None else place[transaction.reverses_id],
            transaction.trade_date,
            transaction.settlement_date,
            transaction.posting_date,
            transaction.shares,
            transaction.amount,
        )
        in_fixture = (
            row.kind,
            row.security,
            None if row.reverses is None else row_place[row.reverses],
            row.trade_date,
            row.settlement_date,
            row.posted_on,
            row.shares,
            row.amount,
        )
        if in_database != in_fixture:
            raise LoadConflict(
                f"{account.account_number}'s Ledger differs from the fixture at row {row.row}"
            )
    if len(already) != len(rows):
        raise LoadConflict(
            f"{account.account_number}'s Ledger has {len(already)} Transactions,"
            f" the fixture {len(rows)}"
        )


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="world:load", description=__doc__)
    parser.add_argument("--world", type=Path, default=WORLD_V0_PATH)
    parser.add_argument("--ledger", type=Path, default=LEDGER_V0_PATH)
    arguments = parser.parse_args(argv)
    world_path: Path = arguments.world
    ledger_path: Path = arguments.ledger
    try:
        world = read_world(world_path)
        ledger = read_ledger_fixture(ledger_path)
    except ValidationError as error:
        # The message names each bad field, such as custodian.accounts.1.registration_type.
        raise SystemExit(f"{error.title} is malformed:\n{error}") from None

    engine = engine_from_env()
    try:
        with Session(engine) as session:
            load(session, world, ledger)
    except LoadConflict as error:
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
