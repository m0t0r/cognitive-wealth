"""The Custodian feed: one Delivery per As-of date, five CSV files and a Manifest (ADR 0017).

`pnpm --filter custodian feed:write --date 2026-03-02` writes the Delivery for that date
into a folder named after it (docs/learn/03-custodian-feed-and-ingestion.md, Part 2):

- `securities.csv`: the Security master, every Security.
- `accounts.csv`: every Account open by the As-of date.
- `transactions.csv`: the Transactions posted that day (Posting date = As-of date), so a
  Correction arrives in the Delivery of the day it was posted, and each Transaction is sent once.
- `positions.csv`: each Account's Positions at the end of the day, as known that day, with the
  price used and their Market value.
- `prices.csv`: each Security's price that day.
- `manifest.json`: each file's name, row count and SHA-256. Written last, so a reader that finds
  it can count on the files being complete.

The same data always gives the same bytes, so writing a day again is a Redelivery, not a
Restatement: no "now" in any file, rows sorted in Python (Postgres orders text by the server's
collation, which can differ between machines), and every value written one way only.
"""

import argparse
import csv
import hashlib
import io
from collections.abc import Sequence
from datetime import date
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, aliased

from custodian.cli import script_args
from custodian.database import engine_from_env
from custodian.feed_store import FeedStore, LocalFeedStore
from custodian.market_value import market_value_as_of
from custodian.models import (
    Account,
    RegistrationType,
    Security,
    SecurityKind,
    SecurityPrice,
    Transaction,
    TransactionKind,
)
from custodian.money import Money, Price, Shares
from custodian.positions import CASH_SWEEP_PRICE, positions_as_of

__all__ = [
    "DEFAULT_ROOT",
    "AccountRow",
    "Manifest",
    "ManifestFile",
    "PositionRow",
    "PriceRow",
    "SecurityRow",
    "TransactionRow",
    "delivery_key",
    "main",
    "write_delivery",
]

DEFAULT_ROOT = Path(__file__).parents[4] / ".dev" / "custodian-feed"
"""Where `feed:write` puts Deliveries unless told otherwise: the checkout's gitignored `.dev/`."""


# The row models: one per file, its fields the file's columns, in order. contract.py publishes
# them in openapi.json, so Ingestion checks every row against the same shapes.


class _Row(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        # Each field's docstring becomes its description in the contract, shown at /docs.
        use_attribute_docstrings=True,
    )


class SecurityRow(_Row):
    identifier: str
    name: str
    kind: SecurityKind


class AccountRow(_Row):
    account_number: str
    registration_type: RegistrationType
    opened_on: date


class TransactionRow(_Row):
    transaction_id: str
    """The Custodian's ID for the Transaction: opaque, unique, and never sent twice."""
    account_number: str
    kind: TransactionKind
    reverses: str | None
    """For a Reversal, the `transaction_id` of the Transaction it undoes. Else empty."""
    security: str | None
    """Empty for a cash-only Transaction, such as a contribution or a fee."""
    shares: Shares | None
    """The change in shares, signed: a sell is negative. Empty if no shares moved."""
    amount: Money
    """The change in cash, signed: money out is negative."""
    trade_date: date
    settlement_date: date
    posting_date: date
    """The As-of date of the Delivery that carries it, even for a Correction to an earlier day."""


class PositionRow(_Row):
    account_number: str
    security: str
    shares: Shares
    price: Price | None
    """The latest price on or before the As-of date. Empty if the Security has none yet."""
    market_value: Money | None
    """`shares * price`, rounded to cents (half-even). Empty when `price` is."""


class PriceRow(_Row):
    security: str
    price: Price


class ManifestFile(_Row):
    name: str
    rows: int
    """Not counting the header row."""
    sha256: str
    """The Content hash of the file's exact bytes, in lowercase hex."""


class Manifest(_Row):
    format_version: Literal[1]
    """Raised when a file's columns or meaning change, so a reader can refuse a format it can't
    read. `Literal[1]`: the only value this version of the writer writes, or accepts."""
    as_of_date: date
    files: list[ManifestFile]
    """By name."""


def delivery_key(as_of: date, name: str) -> str:
    """Where a Delivery's file is kept in a FeedStore: `2026-03-02/positions.csv`."""
    return f"{as_of.isoformat()}/{name}"


def write_delivery(engine: Engine, store: FeedStore, as_of: date) -> Manifest:
    """Write the Delivery for `as_of` into `store`, the Manifest last, and return the Manifest.

    Every row is read in one database transaction of its own, at `repeatable read`: it sees the
    database as it was when it started, so the five files describe the same moment even if a
    Close is recording rows meanwhile.
    """
    with Session(engine) as session, session.begin():
        session.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        accounts = _accounts(session, as_of)
        # Each file's name, its row model (whose fields give the header row, even with no rows),
        # and its rows.
        files: list[tuple[str, type[_Row], Sequence[_Row]]] = [
            ("accounts.csv", AccountRow, accounts),
            ("positions.csv", PositionRow, _positions(session, accounts, as_of)),
            ("prices.csv", PriceRow, _prices(session, as_of)),
            ("securities.csv", SecurityRow, _securities(session)),
            ("transactions.csv", TransactionRow, _transactions(session, as_of)),
        ]

    listed: list[ManifestFile] = []
    for name, model, rows in files:
        content = _csv(rows, model)
        store.put(delivery_key(as_of, name), content)
        listed.append(
            ManifestFile(name=name, rows=len(rows), sha256=hashlib.sha256(content).hexdigest())
        )
    manifest = Manifest(format_version=1, as_of_date=as_of, files=listed)
    # Last, so a reader that finds the Manifest finds every file it lists already complete.
    store.put(
        delivery_key(as_of, "manifest.json"), (manifest.model_dump_json(indent=2) + "\n").encode()
    )
    return manifest


def _csv(rows: Sequence[_Row], model: type[_Row]) -> bytes:
    """A header row, then one line per row: UTF-8, LF line endings, an empty value for None.

    `model_dump(mode="json")` writes each value as it goes over JSON: a date as `2026-03-02`, an
    enum as its value, and Money, Shares and Price as decimal strings at their type's precision.
    """
    text = io.StringIO()
    writer = csv.writer(text, lineterminator="\n")
    writer.writerow(model.model_fields.keys())
    for row in rows:
        values: dict[str, object] = row.model_dump(mode="json")
        writer.writerow("" if value is None else value for value in values.values())
    return text.getvalue().encode()


def _securities(session: Session) -> list[SecurityRow]:
    rows = [
        SecurityRow(identifier=security.identifier, name=security.name, kind=security.kind)
        for security in session.scalars(select(Security))
    ]
    return sorted(rows, key=lambda row: row.identifier)


def _accounts(session: Session, as_of: date) -> list[AccountRow]:
    rows = [
        AccountRow(
            account_number=account.account_number,
            registration_type=account.registration_type,
            opened_on=account.opened_on,
        )
        for account in session.scalars(select(Account).where(Account.opened_on <= as_of))
    ]
    return sorted(rows, key=lambda row: row.account_number)


def _transactions(session: Session, as_of: date) -> list[TransactionRow]:
    # Each row's Transaction, with the keys the feed names things by instead of internal ids: its
    # Account's number, the Transaction ID of the row a Reversal undoes, and the Security's
    # identifier. The outer joins keep a row with no original (not a Reversal) or no Security.
    original = aliased(Transaction)
    posted = (
        select(Transaction, Account.account_number, original.transaction_id, Security.identifier)
        .join(Transaction.account)
        .outerjoin(original, Transaction.reverses.of_type(original))
        .outerjoin(Transaction.security)
        .where(Transaction.posting_date == as_of)
    )
    rows: list[TransactionRow] = []
    for transaction, account_number, reverses, security in session.execute(posted):
        rows.append(
            TransactionRow(
                transaction_id=transaction.transaction_id,
                account_number=account_number,
                kind=transaction.kind,
                reverses=reverses,
                security=security,
                shares=transaction.shares,
                amount=transaction.amount,
                trade_date=transaction.trade_date,
                settlement_date=transaction.settlement_date,
                posting_date=transaction.posting_date,
            )
        )
    # `key=` says what to sort by: a `lambda` is a one-line function, like `(row) => …`.
    return sorted(rows, key=lambda row: (row.account_number, row.transaction_id))


def _positions(session: Session, accounts: Sequence[AccountRow], as_of: date) -> list[PositionRow]:
    # As known on the As-of date: a Correction posted later changes a later Delivery's Positions,
    # never this one's, so writing this day again gives the same bytes.
    rows: list[PositionRow] = []
    for account in accounts:
        number = account.account_number
        held = positions_as_of(session, number, as_of, known_on=as_of)
        valued = {
            position.identifier: position
            for position in market_value_as_of(session, number, as_of, known_on=as_of).positions
        }
        for identifier, shares in sorted(held.items()):
            priced = valued.get(identifier)
            rows.append(
                PositionRow(
                    account_number=number,
                    security=identifier,
                    shares=shares,
                    price=None if priced is None else priced.price,
                    market_value=None if priced is None else priced.market_value,
                )
            )
    return rows


def _prices(session: Session, as_of: date) -> list[PriceRow]:
    rows = [
        PriceRow(security=identifier, price=price)
        for identifier, price in session.execute(
            select(Security.identifier, SecurityPrice.price)
            .join(SecurityPrice.security)
            .where(SecurityPrice.price_date == as_of)
        )
    ]
    # The cash sweep has no stored prices: it is always worth $1.00 a share.
    rows += [
        PriceRow(security=identifier, price=CASH_SWEEP_PRICE)
        for identifier in session.scalars(
            select(Security.identifier).where(Security.kind == SecurityKind.CASH_SWEEP)
        )
    ]
    return sorted(rows, key=lambda row: row.security)


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="feed:write", description=__doc__)
    parser.add_argument("--date", type=date.fromisoformat, required=True, help="the As-of date")
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="where Deliveries go")
    arguments = parser.parse_args(script_args(argv))
    as_of: date = arguments.date
    root: Path = arguments.root

    engine = engine_from_env()
    try:
        manifest = write_delivery(engine, LocalFeedStore(root), as_of)
    finally:
        engine.dispose()
    counts = ", ".join(f"{file.rows} rows in {file.name}" for file in manifest.files)
    print(f"Wrote the Delivery for {as_of.isoformat()} to {root / as_of.isoformat()}: {counts}")


if __name__ == "__main__":
    main()
