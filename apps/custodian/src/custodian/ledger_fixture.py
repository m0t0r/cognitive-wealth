"""A hand-written ledger: Securities, prices and Transactions, until the market and the Close exist.

`fixtures/ledger-v0.json` is Dana's week from docs/learn/01-ledger-positions-and-dates.md, rows 1
to 11 numbered as there, in the world's joint Account, plus two rows opening the IRA. It is the
custodian's alone: the world file names the Accounts, and this says what happened in them.

Slices 15 to 19 replace it with simulated prices, dividends and the Close; until then, a short,
hand-checked ledger lets everything after it (Positions, the feed, ingestion) be built and tested
against numbers a person has worked out on paper.
"""

from datetime import date
from pathlib import Path
from typing import Self

from pydantic import BaseModel, ConfigDict, model_validator

from custodian.models import SecurityKind, TransactionKind
from custodian.money import Money, Price, Shares

__all__ = [
    "LEDGER_V0_PATH",
    "FixtureSecurity",
    "FixtureTransaction",
    "LedgerFixture",
    "read_ledger_fixture",
]

LEDGER_V0_PATH = Path(__file__).parents[2] / "fixtures" / "ledger-v0.json"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class FixtureSecurity(_Strict):
    identifier: str
    name: str
    kind: SecurityKind


class FixtureTransaction(_Strict):
    row: int
    """The row's number in the fixture, counting from 1, as the primer numbers Dana's rows."""
    account: str
    """An account number in the world file."""
    kind: TransactionKind
    security: str | None = None
    shares: Shares | None = None
    amount: Money
    trade_date: date
    settlement_date: date
    posting_date: date | None = None
    """When it differs from the Trade date, as for a Correction."""
    reverses: int | None = None
    """For a Reversal, the `row` it undoes."""

    @property
    def posted_on(self) -> date:
        return self.posting_date or self.trade_date


def _negated(row: FixtureTransaction) -> tuple[object, ...]:
    """What a Reversal of `row` must hold: the same Account, Security and dates, legs negated."""
    shares = None if row.shares is None else Shares(0) - row.shares
    amount = Money(0) - row.amount
    return (row.account, row.security, row.trade_date, row.settlement_date, shares, amount)


class LedgerFixture(_Strict):
    securities: list[FixtureSecurity]
    prices: dict[str, dict[date, Price]]
    """Each Security's closing price by Business day, keyed by identifier."""
    transactions: list[FixtureTransaction]
    """In Ledger order: the order they are recorded in."""

    # The database would also refuse some of these, but checking the file first gives a message
    # that names the row in the file, rather than a constraint name.
    @model_validator(mode="after")
    def _rows_fit_together(self) -> Self:
        identifiers = {security.identifier for security in self.securities}
        for identifier in self.prices:
            if identifier not in identifiers:
                raise ValueError(f"prices.{identifier}: not a Security in this fixture")
        for index, row in enumerate(self.transactions):
            where = f"transactions.{index}"
            if row.row != index + 1:
                raise ValueError(f"{where}.row: row {row.row} should be {index + 1}")
            if row.security is not None and row.security not in identifiers:
                raise ValueError(f"{where}.security: {row.security!r} isn't in this fixture")
            if row.reverses is None:
                continue
            if not 1 <= row.reverses < row.row:
                raise ValueError(f"{where}: a Reversal undoes an earlier row, not {row.reverses}")
            original = self.transactions[row.reverses - 1]
            mirror = (row.account, row.security, row.trade_date, row.settlement_date)
            if (*mirror, row.shares, row.amount) != _negated(original):
                raise ValueError(
                    f"{where}: a Reversal must negate row {original.row}, on the same Account,"
                    " Security and dates"
                )
        return self


def read_ledger_fixture(path: Path) -> LedgerFixture:
    return LedgerFixture.model_validate_json(path.read_text())
