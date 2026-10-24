"""Settled cash from the v0 ledger fixture, checked against docs/learn/01's Part 3 by hand.

Money going out counts from its Trade date, money coming in from its Settlement date (ADR 0016).
"""

from datetime import date

import pytest
from sqlalchemy.orm import Session

from custodian.ledger_fixture import LEDGER_V0_PATH, FixtureTransaction, read_ledger_fixture
from custodian.load import load
from custodian.models import TransactionKind
from custodian.money import Money, Shares
from custodian.positions import settled_cash_as_of
from custodian.world import WORLD_V0_PATH, read_world

JOINT = "CW-000001"


def load_v0(session: Session) -> None:
    load(session, read_world(WORLD_V0_PATH), read_ledger_fixture(LEDGER_V0_PATH))


# The primer's Part 3 table, plus the days it leaves out. Each day is asked that same evening.
@pytest.mark.parametrize(
    ("day", "settled"),
    [
        (date(2026, 2, 25), "0.00"),
        (date(2026, 2, 26), "2000.00"),  # row 2's buy settles Friday, but is owed at once
        (date(2026, 2, 27), "2000.00"),
        (date(2026, 3, 2), "5990.00"),
        (date(2026, 3, 3), "5999.00"),
        (date(2026, 3, 4), "5954.00"),  # cash is 7,474.00: row 6's sale settles on Thursday
        (date(2026, 3, 5), "6474.00"),
        (date(2026, 3, 6), "6476.65"),  # with the Correction (rows 9 and 10), posted Friday
        (date(2026, 3, 9), "6476.65"),
    ],
)
def test_danas_settled_cash_at_the_end_of_each_day(
    session: Session, day: date, settled: str
) -> None:
    load_v0(session)

    assert settled_cash_as_of(session, JOINT, day, known_on=day) == Money(settled)


def test_a_reversal_before_settlement_cancels_on_every_day(session: Session) -> None:
    # Say Wednesday's sale (row 6) is found to be wrong that same day, and reversed: the money
    # never arrives. A Reversal counted by its own sign (-1,520.00, money out) would count at
    # once while the sale doesn't yet, leaving Wednesday at 4,434.00.
    ledger = read_ledger_fixture(LEDGER_V0_PATH)
    sale = ledger.transactions[5]
    reversal = FixtureTransaction(
        number=len(ledger.transactions) + 1,
        account=JOINT,
        kind=TransactionKind.REVERSAL,
        reverses=sale.number,
        security=sale.security,
        shares=None if sale.shares is None else Shares(0) - sale.shares,
        amount=Money(0) - sale.amount,
        trade_date=sale.trade_date,
        settlement_date=sale.settlement_date,
        posting_date=date(2026, 3, 4),
    )
    reversed_sale = ledger.model_copy(update={"transactions": [*ledger.transactions, reversal]})
    load(session, read_world(WORLD_V0_PATH), reversed_sale)

    def settled(day: date) -> Money:
        return settled_cash_as_of(session, JOINT, day, known_on=day)

    assert settled(date(2026, 3, 4)) == Money("5954.00")
    assert settled(date(2026, 3, 5)) == Money("4954.00")


@pytest.mark.parametrize(
    ("asked_on", "settled"),
    [
        (date(2026, 3, 5), "5999.00"),  # rows 1 to 5
        (date(2026, 3, 9), "6000.50"),  # and the Correction, posted Friday: rows 9 and 10
    ],
)
def test_a_correction_counts_once_it_is_posted(
    session: Session, asked_on: date, settled: str
) -> None:
    load_v0(session)

    assert settled_cash_as_of(session, JOINT, date(2026, 3, 3), known_on=asked_on) == Money(settled)


def test_settled_cash_is_not_floored_at_zero(session: Session) -> None:
    # Row 2's buy is owed on Thursday. Without row 1's contribution, nothing pays for it yet.
    ledger = read_ledger_fixture(LEDGER_V0_PATH)
    unpaid = ledger.model_copy(
        update={
            "transactions": [
                row.model_copy(update={"settlement_date": date(2026, 2, 27)})
                if row.number == 1
                else row
                for row in ledger.transactions
            ]
        }
    )
    load(session, read_world(WORLD_V0_PATH), unpaid)

    day = date(2026, 2, 26)
    assert settled_cash_as_of(session, JOINT, day, known_on=day) == Money("-3000.00")


def test_an_unknown_account_has_no_settled_cash_to_give(session: Session) -> None:
    load_v0(session)

    with pytest.raises(LookupError, match="CW-999999"):
        settled_cash_as_of(session, "CW-999999", date(2026, 3, 6))
