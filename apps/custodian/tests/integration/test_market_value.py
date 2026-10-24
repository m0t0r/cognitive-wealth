"""Market value from the v0 ledger fixture, checked against docs/learn/01's Part 5 by hand."""

from datetime import date

import pytest
from sqlalchemy.orm import Session

from custodian.ledger_fixture import LEDGER_V0_PATH, read_ledger_fixture
from custodian.load import load
from custodian.market_value import ValuedPosition, market_value_as_of
from custodian.models import Security, SecurityKind, SecurityPrice, Transaction, TransactionKind
from custodian.money import Money, Price, Shares
from custodian.world import WORLD_V0_PATH, read_world
from tests.integration.examples import danas_account

JOINT = "CW-000001"
IRA = "CW-000002"

# The primer's Part 5 table: Dana's Positions on Friday 6 March, at Friday's closing prices.
FRIDAYS_POSITIONS = (
    ValuedPosition("LKBF", Shares("300"), Price("10.02"), Money("3006.00")),
    ValuedPosition("LKSF", Shares("30"), Price("153.40"), Money("4602.00")),
    ValuedPosition("SWEEP", Shares("6476.65"), Price("1.00"), Money("6476.65")),
)


def load_v0(session: Session) -> None:
    load(session, read_world(WORLD_V0_PATH), read_ledger_fixture(LEDGER_V0_PATH))


def test_danas_market_value_on_friday(session: Session) -> None:
    load_v0(session)

    value = market_value_as_of(session, JOINT, date(2026, 3, 6))

    assert value.positions == FRIDAYS_POSITIONS
    assert value.total == Money("14084.65")
    assert value.unpriced == frozenset()


@pytest.mark.parametrize("day", [date(2026, 3, 7), date(2026, 3, 9)])
def test_a_day_with_no_price_uses_the_last_one_before_it(session: Session, day: date) -> None:
    # Saturday has no close, and the fixture's prices end on Friday.
    load_v0(session)

    value = market_value_as_of(session, JOINT, day, known_on=day)

    assert value.positions == FRIDAYS_POSITIONS
    assert value.total == Money("14084.65")


def test_a_security_with_no_price_is_left_out_of_the_total(session: Session) -> None:
    ledger = read_ledger_fixture(LEDGER_V0_PATH)
    no_bond_prices = ledger.model_copy(update={"prices": {"LKSF": ledger.prices["LKSF"]}})
    load(session, read_world(WORLD_V0_PATH), no_bond_prices)

    value = market_value_as_of(session, JOINT, date(2026, 3, 6))

    # Not valued at $0.00: it has no value at all, and the total says what it leaves out.
    assert value.unpriced == frozenset({"LKBF"})
    assert [position.identifier for position in value.positions] == ["LKSF", "SWEEP"]
    assert value.total == Money("11078.65")  # 4,602.00 + 6,476.65


def test_an_account_with_no_positions_is_worth_nothing(session: Session) -> None:
    load_v0(session)

    value = market_value_as_of(session, IRA, date(2026, 2, 27))

    assert value.positions == ()
    assert value.total == Money("0.00")
    assert value.unpriced == frozenset()


def test_the_total_is_rounded_once_not_line_by_line(session: Session) -> None:
    # Two Positions worth $0.005 each. Each line rounds half-even to 0.00, but the total is 0.01.
    account = danas_account()
    day = date(2026, 3, 6)
    for identifier in ["TINY1", "TINY2"]:
        security = Security(identifier=identifier, name=identifier, kind=SecurityKind.STOCK)
        session.add_all(
            [
                SecurityPrice(security=security, price_date=day, price=Price("5")),
                Transaction(
                    account=account,
                    security=security,
                    kind=TransactionKind.TRANSFER,
                    shares=Shares("0.001"),
                    amount=Money(0),
                    trade_date=day,
                    settlement_date=day,
                    posting_date=day,
                ),
            ]
        )
    session.commit()

    value = market_value_as_of(session, account.account_number, day)

    assert [position.market_value for position in value.positions] == [Money("0.00")] * 2
    assert value.total == Money("0.01")


def test_an_unknown_account_has_no_market_value_to_give(session: Session) -> None:
    load_v0(session)

    with pytest.raises(LookupError, match="CW-999999"):
        market_value_as_of(session, "CW-999999", date(2026, 3, 6))
