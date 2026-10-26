"""A hand-written ledger: prices and Transactions, until the market and the Close exist.

`fixtures/ledger-v0.json` is Dana's week from docs/learn/01-ledger-positions-and-dates.md, rows 1
to 11 numbered as there, in the world's joint Account, plus two rows opening the IRA. It is the
custodian's alone: the world file names the Accounts, and this says what happened in them.

Slices 15 to 19 replace it with simulated prices, dividends and the Close; until then, a short,
hand-checked ledger lets everything after it (Positions, the feed, ingestion) be built and tested
against numbers a person has worked out on paper. It names Securities by identifier only: the
Security catalog (`security_catalog.py`) says what each one is, and the loader refuses a ledger
naming one the catalog doesn't have.
"""

from datetime import date
from pathlib import Path
from typing import Self

from pydantic import BaseModel, ConfigDict, model_validator

from custodian.models import TransactionKind
from custodian.money import Money, Price, Shares

__all__ = [
    "LEDGER_V0_PATH",
    "FixtureTransaction",
    "LedgerFixture",
    "read_ledger_fixture",
]

LEDGER_V0_PATH = Path(__file__).parents[2] / "fixtures" / "ledger-v0.json"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class FixtureTransaction(_Strict):
    number: int
    """The row's number in the fixture, counting from 1, as the primer numbers Dana's rows."""
    account: str
    """An account number in the world file."""
    kind: TransactionKind
    security: str | None = None
    """A Security's identifier in the Security catalog."""
    shares: Shares | None = None
    amount: Money
    trade_date: date
    settlement_date: date
    posting_date: date
    """The Trade date, except for a Correction, which is posted the day the mistake was found."""
    reverses: int | None = None
    """For a Reversal, the `number` of the row it undoes."""

    @property
    def transaction_id(self) -> str:
        """The Custodian's ID for this row, worked out from its number: row 3 is `TX-000000003`.

        It depends only on the file, never on the database's `id` or the order rows are loaded
        in, so a world rebuilt from the same files publishes the same IDs (ADR 0017). Adding a
        row at the end changes no other row's ID; one added in the middle renumbers those after.
        """
        return f"TX-{self.number:09d}"


class LedgerFixture(_Strict):
    prices: dict[str, dict[date, Price]]
    """Each Security's closing price by Business day, keyed by identifier."""
    transactions: list[FixtureTransaction]
    """In Ledger order: the order they are recorded in."""

    # The database would also refuse some of these, but checking the file first gives a message
    # that names the row in the file, rather than a constraint name.
    @model_validator(mode="after")
    def _rows_fit_together(self) -> Self:
        for index, transaction in enumerate(self.transactions):
            where = f"transactions.{index}"
            if transaction.number != index + 1:
                raise ValueError(f"{where}.number: row {transaction.number} should be {index + 1}")
            if transaction.reverses is not None:
                if not 1 <= transaction.reverses < transaction.number:
                    raise ValueError(
                        f"{where}: a Reversal undoes an earlier row, not {transaction.reverses}"
                    )
                original = self.transactions[transaction.reverses - 1]
                if original.kind == TransactionKind.REVERSAL:
                    raise ValueError(
                        f"{where}: row {original.number} is a Reversal, which can't be undone;"
                        " fix it with a new Transaction"
                    )
                _check_reversal(where, transaction, original)
        return self


def _check_reversal(where: str, reversal: FixtureTransaction, original: FixtureTransaction) -> None:
    """A Reversal is a copy of the row it undoes with every amount negated (GLOSSARY.md)."""
    negated_shares = None if original.shares is None else Shares(0) - original.shares
    if (
        reversal.account != original.account
        or reversal.security != original.security
        or reversal.trade_date != original.trade_date
        or reversal.settlement_date != original.settlement_date
        or reversal.shares != negated_shares
        or reversal.amount != Money(0) - original.amount
    ):
        raise ValueError(
            f"{where}: a Reversal must negate row {original.number}, on the same Account,"
            " Security and dates"
        )


def read_ledger_fixture(path: Path) -> LedgerFixture:
    return LedgerFixture.model_validate_json(path.read_text())
