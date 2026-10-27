"""Loads the world file's custodian half, the Security catalog and a ledger fixture.

`pnpm --filter custodian world:load` runs it with world/v0.json, market/security-catalog.json and
fixtures/ledger-v0.json. The catalog is always the committed one: it's a market input, so the
build record keeps its SHA-256 (ADR 0019).
Loading adds what is missing and refuses to change what is there, all in one database
transaction, so running it again changes nothing, and a file that disagrees with the database
changes nothing either. Rebuilding a different world means starting from an empty database.

Why refuse rather than overwrite? The Ledger is append-only (GLOSSARY.md, "Ledger"): the `app`
role this runs as can't change or delete a Transaction, and shouldn't. A row that is wrong is
fixed with a Correction, which is new rows, never an edit.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from custodian.build_record import BuildMismatch, market_inputs, record_build
from custodian.cli import CliError, Command, Cta, Done, Options, Output
from custodian.database import engine_from_env
from custodian.ledger_fixture import (
    LEDGER_V0_PATH,
    FixtureTransaction,
    LedgerFixture,
    read_ledger_fixture,
)
from custodian.models import Account, Security, SecurityPrice, Transaction, TransactionKind
from custodian.money import Money, Price, Shares
from custodian.security_catalog import (
    SECURITY_CATALOG_PATH,
    CatalogSecurity,
    SecurityCatalog,
    read_security_catalog,
)
from custodian.world import WORLD_V0_PATH, CustodianAccount, WorldFile, read_world

__all__ = ["COMMAND", "LoadConflict", "load", "main"]


# An exception class: like `class LoadConflict extends Error {}` in TypeScript.
class LoadConflict(Exception):
    """The database already holds something the files would change."""


def _check_files_agree(
    *, world: WorldFile, catalog: SecurityCatalog, ledger: LedgerFixture
) -> None:
    """Refuse a ledger naming an Account or a Security the other files don't have."""
    numbers = {account.account_number for account in world.custodian.accounts}
    identifiers = {security.identifier for security in catalog.securities}
    for identifier in ledger.prices:
        if identifier not in identifiers:
            raise ValueError(f"prices.{identifier}: not a Security in the catalog")
    for transaction in ledger.transactions:
        if transaction.account not in numbers:
            raise ValueError(
                f"Transaction {transaction.number}: {transaction.account!r} isn't an Account in"
                " the world file"
            )
        if transaction.security is not None and transaction.security not in identifiers:
            raise ValueError(
                f"Transaction {transaction.number}: {transaction.security!r} isn't a Security in"
                " the catalog"
            )


def load(
    session: Session, *, world: WorldFile, catalog: SecurityCatalog, ledger: LedgerFixture
) -> None:
    # First check that the files agree with each other, before touching the database.
    _check_files_agree(world=world, catalog=catalog, ledger=ledger)

    with session.begin():  # commits at the end, or rolls everything back on an error
        accounts = {
            account.account_number: _account(session, account)
            for account in world.custodian.accounts
        }
        securities = {
            security.identifier: _security(session, security) for security in catalog.securities
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


def _security(session: Session, wanted: CatalogSecurity) -> Security:
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


# `pnpm --filter custodian world:load`, on cli.py's runner.


class WorldLoadOptions(Options):
    world: Path = WORLD_V0_PATH
    """The world file, whose custodian half is loaded"""
    ledger: Path = LEDGER_V0_PATH
    """The ledger fixture: the Transactions and prices"""
    dry_run: bool = False
    """Make every check and write, then roll back: nothing is loaded"""


class WorldLoadOutput(Output):
    dry_run: bool
    accounts: int
    securities: int
    prices: int
    transactions: int
    """What the files hold, all of it in the database now (with --dry-run, it would be)"""


def _world_load(options: WorldLoadOptions) -> Done[WorldLoadOutput]:
    try:
        world = read_world(options.world)
        catalog = read_security_catalog(SECURITY_CATALOG_PATH)
        ledger = read_ledger_fixture(options.ledger)
    except FileNotFoundError as error:
        raise CliError(code="invalid_input", message=f"No such file: {error.filename}") from None
    except ValidationError as error:
        # The message names each bad field, such as custodian.accounts.1.registration_type.
        raise CliError(
            code="malformed_input", message=f"{error.title} is malformed: {error}"
        ) from None
    try:
        _check_files_agree(world=world, catalog=catalog, ledger=ledger)
    except ValueError as error:
        raise CliError(code="files_disagree", message=f"Nothing was loaded: {error}") from None

    # A database to load into before anything is downloaded; the engine doesn't connect yet.
    engine = engine_from_env()
    try:
        # Market data next, with nothing written yet: the verified Factor file (downloaded into
        # the cache on a first run) and the inputs it and the Treasury yields make. Its errors
        # are the runner's (`pin_mismatch`, `factor_file_unavailable`).
        inputs = market_inputs()
        # One database transaction around both steps, committed at the end or, for a dry run,
        # rolled back. Each `session.begin()` inside them becomes a savepoint in it
        # (`join_transaction_mode`), so a dry run makes every check and write a real run makes.
        with engine.connect() as connection, connection.begin() as transaction:
            with Session(connection, join_transaction_mode="create_savepoint") as session:
                # Before any row: an empty database records the inputs, any other must match them.
                record_build(session, inputs)
                load(session, world=world, catalog=catalog, ledger=ledger)
            if options.dry_run:
                transaction.rollback()
    except BuildMismatch as error:
        raise CliError(code="build_record_differs", message=str(error)) from None
    except LoadConflict as error:
        raise CliError(code="load_conflict", message=f"Nothing was loaded: {error}") from None
    finally:
        engine.dispose()

    if options.dry_run:
        next_step = Cta(command="pnpm --filter custodian world:load", description="Load it")
    else:
        last_day = max(row.posting_date for row in ledger.transactions)
        next_step = Cta(
            command=f"pnpm --filter custodian feed:write --date {last_day}",
            description="Write the Delivery for the ledger's last day",
        )
    return Done(
        WorldLoadOutput(
            dry_run=options.dry_run,
            accounts=len(world.custodian.accounts),
            securities=len(catalog.securities),
            prices=sum(len(by_day) for by_day in ledger.prices.values()),
            transactions=len(ledger.transactions),
        ),
        cta=[next_step],
    )


COMMAND = Command(
    name="world:load",
    description=(
        "Load the world file's custodian half, the Security catalog and the ledger fixture into"
        " the custodian's database, first recording the market inputs that built it; adds what's"
        " missing and refuses to change what's there"
    ),
    options=WorldLoadOptions,
    output=WorldLoadOutput,
    run=_world_load,
)

main = COMMAND.main


if __name__ == "__main__":
    raise SystemExit(main())
