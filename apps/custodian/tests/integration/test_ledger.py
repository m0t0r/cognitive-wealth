from datetime import date

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from custodian.models import Security, SecurityKind, Transaction, TransactionKind
from custodian.money import Money, Shares
from tests.integration.examples import bond_fund, danas_account


@pytest.mark.parametrize(
    ("shares", "amount"),
    [
        ("0.444981", "-37.50"),  # a reinvested dividend's fractional shares (ADR 0013)
        ("-10", "1520.00"),  # a sell: shares out, cash in
        ("1.5", "0.1"),  # stored at the column's scale, and equal to what went in
        ("9999999999999.999999", "99999999999999999.99"),  # the largest values the columns hold
    ],
)
def test_money_and_shares_come_back_exactly_as_recorded(
    session: Session, shares: str, amount: str
) -> None:
    session.add(
        Transaction(
            account=danas_account(),
            security=bond_fund(),
            kind=TransactionKind.BUY,
            trade_date=date(2026, 3, 2),
            posting_date=date(2026, 3, 2),
            settlement_date=date(2026, 3, 3),
            shares=Shares(shares),
            amount=Money(amount),
        )
    )
    session.commit()
    session.expire_all()  # forget the objects, so the values below are read back from Postgres

    recorded = session.scalars(select(Transaction)).one()

    assert recorded.shares == Shares(shares)
    assert recorded.amount == Money(amount)
    assert isinstance(recorded.amount, Money)


def test_the_cash_sweep_is_stored_as_its_own_kind(session: Session) -> None:
    session.add(Security(identifier="SWEEP", name="Bank sweep", kind=SecurityKind.CASH_SWEEP))
    session.commit()
    session.expire_all()

    assert session.scalars(select(Security.kind)).one() is SecurityKind.CASH_SWEEP


def test_a_transaction_cant_settle_before_its_trade_date(session: Session) -> None:
    session.add(
        Transaction(
            account=danas_account(),
            kind=TransactionKind.CONTRIBUTION,
            trade_date=date(2026, 3, 3),
            posting_date=date(2026, 3, 3),
            settlement_date=date(2026, 3, 2),
            amount=Money("1000.00"),
        )
    )

    with pytest.raises(IntegrityError, match="transaction_settles_after_trade_check"):
        session.commit()


def test_shares_cant_move_without_a_security(session: Session) -> None:
    session.add(
        Transaction(
            account=danas_account(),
            kind=TransactionKind.TRANSFER,
            trade_date=date(2026, 3, 2),
            posting_date=date(2026, 3, 2),
            settlement_date=date(2026, 3, 2),
            shares=Shares("100"),
            amount=Money("0.00"),
        )
    )

    with pytest.raises(IntegrityError, match="transaction_shares_of_a_security_check"):
        session.commit()


def test_a_correction_keeps_its_trade_date_and_the_later_day_it_was_posted(
    session: Session,
) -> None:
    # The primer's row 10: the right dividend for Tue 3 Mar, found and posted on Fri 6 Mar.
    session.add(
        Transaction(
            account=danas_account(),
            security=bond_fund(),
            kind=TransactionKind.DIVIDEND,
            trade_date=date(2026, 3, 3),
            settlement_date=date(2026, 3, 3),
            posting_date=date(2026, 3, 6),
            amount=Money("10.50"),
        )
    )
    session.commit()
    session.expire_all()

    recorded = session.scalars(select(Transaction)).one()

    assert (recorded.trade_date, recorded.posting_date) == (date(2026, 3, 3), date(2026, 3, 6))


def test_a_transaction_cant_be_posted_before_its_trade_date(session: Session) -> None:
    session.add(
        Transaction(
            account=danas_account(),
            kind=TransactionKind.CONTRIBUTION,
            trade_date=date(2026, 3, 3),
            settlement_date=date(2026, 3, 3),
            posting_date=date(2026, 3, 2),
            amount=Money("1000.00"),
        )
    )

    with pytest.raises(IntegrityError, match="transaction_posted_after_trade_check"):
        session.commit()
