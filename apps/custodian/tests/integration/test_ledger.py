from datetime import date

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from custodian.models import (
    Security,
    SecurityKind,
    SecurityPrice,
    Transaction,
    TransactionKind,
)
from custodian.money import Money, Price, Shares
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


def a_dividend() -> Transaction:
    # The primer's row 5: the Bond Fund's dividend on Tue 3 Mar, which turned out to be wrong.
    return Transaction(
        account=danas_account(),
        security=bond_fund(),
        kind=TransactionKind.DIVIDEND,
        trade_date=date(2026, 3, 3),
        settlement_date=date(2026, 3, 3),
        posting_date=date(2026, 3, 3),
        amount=Money("9.00"),
    )


def reversal_of(
    original: Transaction, kind: TransactionKind = TransactionKind.REVERSAL
) -> Transaction:
    # The primer's row 9: the same row with every amount negated, posted the day it was found.
    return Transaction(
        account=original.account,
        security=original.security,
        kind=kind,
        reverses=original,
        trade_date=original.trade_date,
        settlement_date=original.settlement_date,
        posting_date=date(2026, 3, 6),
        amount=Money("-9.00"),
    )


def test_a_reversal_names_the_transaction_it_undoes(session: Session) -> None:
    dividend = a_dividend()
    session.add(reversal_of(dividend))
    session.commit()
    session.expire_all()

    reversal = session.scalars(
        select(Transaction).where(Transaction.kind == TransactionKind.REVERSAL)
    ).one()

    assert reversal.reverses is not None
    assert (reversal.reverses.kind, reversal.reverses.amount) == (
        TransactionKind.DIVIDEND,
        Money("9.00"),
    )


def test_a_reversal_must_name_a_transaction(session: Session) -> None:
    reversal = reversal_of(a_dividend())
    reversal.reverses = None
    session.add(reversal)

    with pytest.raises(IntegrityError, match="transaction_reversal_names_what_it_undoes_check"):
        session.commit()


def test_only_a_reversal_names_a_transaction(session: Session) -> None:
    session.add(reversal_of(a_dividend(), kind=TransactionKind.WITHDRAWAL))

    with pytest.raises(IntegrityError, match="transaction_reversal_names_what_it_undoes_check"):
        session.commit()


def test_a_transaction_is_reversed_at_most_once(session: Session) -> None:
    dividend = a_dividend()
    session.add_all([reversal_of(dividend), reversal_of(dividend)])

    with pytest.raises(IntegrityError, match="transaction_reverses_id_key"):
        session.commit()


def test_a_reversal_cant_undo_a_reversal(session: Session) -> None:
    # A wrong Reversal is fixed with a new Transaction (ADR 0016): Settled cash takes a
    # Reversal's direction from the row it names, which only works if that row isn't one.
    reversal = reversal_of(a_dividend())
    undo = reversal_of(reversal)
    undo.amount = Money("9.00")
    session.add(undo)

    with pytest.raises(IntegrityError, match="transaction_reverses_no_reversal"):
        session.commit()


def test_a_price_keeps_the_decimal_places_it_was_quoted_with(session: Session) -> None:
    session.add(
        SecurityPrice(security=bond_fund(), price_date=date(2026, 3, 6), price=Price("10.0200"))
    )
    session.commit()
    session.expire_all()

    assert str(session.scalars(select(SecurityPrice.price)).one()) == "10.0200"


def test_a_security_has_one_price_a_day(session: Session) -> None:
    fund = bond_fund()
    session.add_all(
        [
            SecurityPrice(security=fund, price_date=date(2026, 3, 6), price=Price("10.02")),
            SecurityPrice(security=fund, price_date=date(2026, 3, 6), price=Price("10.03")),
        ]
    )

    with pytest.raises(IntegrityError, match="price_security_id_price_date_key"):
        session.commit()
