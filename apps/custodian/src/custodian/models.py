"""The custodian's tables, as SQLAlchemy models. Alembic owns the schema (migrations/).

The Ledger is append-only: the `app` role can insert and read Transactions, never update or
delete them (GLOSSARY.md, "Ledger"). A mistake is fixed with a Reversal and a new Transaction.

Each table's bigint `id` stays inside the custodian (ADR 0003). What it publishes are the keys
its domain already has: an Account's `account_number` and a Security's `identifier`.
"""

from collections.abc import Iterable, Mapping
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import ClassVar

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Dialect,
    Enum,
    ForeignKey,
    Identity,
    Index,
    MetaData,
    Numeric,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import DateTime, TypeDecorator

from custodian.money import Money, Shares

__all__ = [
    "Account",
    "Base",
    "RegistrationType",
    "Security",
    "SecurityKind",
    "Transaction",
    "TransactionKind",
]


class MoneyColumn(TypeDecorator[Money]):
    """`numeric(19, 2)`: whole cents, read back as `Money` (ADR 0013)."""

    impl = Numeric(19, 2)
    cache_ok = True

    def process_bind_param(self, value: Money | None, dialect: Dialect) -> Decimal | None:
        return None if value is None else Decimal(str(value))

    def process_result_value(self, value: Decimal | None, dialect: Dialect) -> Money | None:
        return None if value is None else Money(value)


class SharesColumn(TypeDecorator[Shares]):
    """`numeric(19, 6)`: shares to a millionth, read back as `Shares` (ADR 0013)."""

    impl = Numeric(19, 6)
    cache_ok = True

    def process_bind_param(self, value: Shares | None, dialect: Dialect) -> Decimal | None:
        return None if value is None else Decimal(str(value))

    def process_result_value(self, value: Decimal | None, dialect: Dialect) -> Shares | None:
        return None if value is None else Shares(value)


class Base(DeclarativeBase):
    # Constraint names come from these patterns, so a migration names them the same every time.
    metadata = MetaData(
        naming_convention={
            "pk": "%(table_name)s_pkey",
            "fk": "%(table_name)s_%(column_0_name)s_fkey",
            "uq": "%(table_name)s_%(column_0_name)s_key",
            "ck": "%(table_name)s_%(constraint_name)s_check",
            "ix": "%(table_name)s_%(column_0_N_name)s_idx",
        }
    )
    # A `Mapped[Money]` column is a MoneyColumn unless it says otherwise, and so on.
    type_annotation_map: ClassVar[Mapping[type, object]] = {
        Money: MoneyColumn(),
        Shares: SharesColumn(),
        datetime: DateTime(timezone=True),
    }


def _values(members: Iterable[StrEnum]) -> list[str]:
    return [member.value for member in members]


def _pg_enum(enum: type[StrEnum], name: str) -> Enum:
    """A Postgres enum type that stores each member's value ("cash_sweep"), not its name."""
    return Enum(enum, name=name, values_callable=_values)


def _id() -> Mapped[int]:
    return mapped_column(BigInteger, Identity(always=True), primary_key=True)


class SecurityKind(StrEnum):
    STOCK = "stock"
    FUND = "fund"
    BOND = "bond"
    CASH_SWEEP = "cash_sweep"
    """Where an Account's cash is kept, worth exactly $1.00 a share."""


class RegistrationType(StrEnum):
    """The legal form of an Account, which sets its ownership and tax rules."""

    INDIVIDUAL = "individual"
    JOINT = "joint"
    TRADITIONAL_IRA = "traditional_ira"
    ROTH_IRA = "roth_ira"
    CUSTODIAL = "custodial"
    """For a minor (UTMA/UGMA)."""
    EDUCATION_529 = "529"


class TransactionKind(StrEnum):
    """The eight kinds in docs/learn/01-ledger-positions-and-dates.md. Reversals come with #35."""

    CONTRIBUTION = "contribution"
    WITHDRAWAL = "withdrawal"
    BUY = "buy"
    SELL = "sell"
    DIVIDEND = "dividend"
    INTEREST = "interest"
    FEE = "fee"
    TRANSFER = "transfer"


class Security(Base):
    """Something an Account can hold: a fund, a stock, a bond, or the cash sweep."""

    __tablename__ = "security"

    id: Mapped[int] = _id()
    identifier: Mapped[str] = mapped_column(unique=True)
    """The custodian's symbol for it, such as "LKBF"."""
    name: Mapped[str]
    kind: Mapped[SecurityKind] = mapped_column(_pg_enum(SecurityKind, "security_kind"))


class Account(Base):
    """A custodial account, identified by the custodian's account number."""

    __tablename__ = "account"

    id: Mapped[int] = _id()
    account_number: Mapped[str] = mapped_column(unique=True)
    registration_type: Mapped[RegistrationType] = mapped_column(
        _pg_enum(RegistrationType, "registration_type")
    )
    opened_on: Mapped[date]


class Transaction(Base):
    """One row of an Account's Ledger: a cash leg, and a share leg when a Security moved."""

    __tablename__ = "transaction"
    __table_args__ = (
        CheckConstraint("settlement_date >= trade_date", name="settles_after_trade"),
        CheckConstraint("shares is null or security_id is not null", name="shares_of_a_security"),
        # Positions are rebuilt from an Account's rows up to a Trade date (ADR 0015).
        Index(None, "account_id", "trade_date"),
    )

    id: Mapped[int] = _id()
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id"))
    security_id: Mapped[int | None] = mapped_column(ForeignKey("security.id"))
    """None for a cash-only Transaction, such as a contribution or a fee."""
    kind: Mapped[TransactionKind] = mapped_column(_pg_enum(TransactionKind, "transaction_kind"))
    trade_date: Mapped[date]
    settlement_date: Mapped[date]
    shares: Mapped[Shares | None]
    """The change in shares of `security`, signed: a sell is negative. None if no shares moved."""
    amount: Mapped[Money]
    """The change in cash, signed: money out is negative."""
    recorded_at: Mapped[datetime] = mapped_column(server_default=func.clock_timestamp())
    """When the row was written, by the database's clock, which `app` can't override; each row
    gets its own time, even within one transaction (`now()` would give them all its start). Not
    the Posting date, which is a Business day in the simulated world and arrives with the Close."""

    account: Mapped[Account] = relationship()
    security: Mapped[Security | None] = relationship()
