"""Positions rebuilt from the v0 ledger fixture, checked against docs/learn/01's tables by hand.

LKSF is the Stock Fund, LKBF the Bond Fund, and SWEEP the cash sweep, so cash is SWEEP shares.
"""

from datetime import date

import pytest
from sqlalchemy.orm import Session

from custodian.ledger_fixture import LEDGER_V0_PATH, read_ledger_fixture
from custodian.load import load
from custodian.money import Shares
from custodian.positions import positions_as_of
from custodian.security_catalog import SECURITY_CATALOG_PATH, read_security_catalog
from custodian.world import WORLD_V0_PATH, read_world

JOINT = "CW-000001"
IRA = "CW-000002"


def load_v0(session: Session) -> None:
    load(
        session,
        world=read_world(WORLD_V0_PATH),
        catalog=read_security_catalog(SECURITY_CATALOG_PATH),
        ledger=read_ledger_fixture(LEDGER_V0_PATH),
    )


# The primer's "Positions at the end of each day", and Friday from Parts 4 and 5. Each day is
# asked that same evening, so the Correction posted on Friday is only counted from Friday.
@pytest.mark.parametrize(
    ("day", "positions"),
    [
        (date(2026, 2, 25), {}),
        (date(2026, 2, 26), {"SWEEP": "2000.00", "LKBF": "300"}),
        (date(2026, 2, 27), {"SWEEP": "2000.00", "LKBF": "300"}),
        (date(2026, 3, 2), {"SWEEP": "5990.00", "LKSF": "40", "LKBF": "300"}),
        (date(2026, 3, 3), {"SWEEP": "5999.00", "LKSF": "40", "LKBF": "300"}),
        # The sale settles on Thursday, but counts from its Trade date (ADR 0015).
        (date(2026, 3, 4), {"SWEEP": "7474.00", "LKSF": "30", "LKBF": "300"}),
        (date(2026, 3, 5), {"SWEEP": "6474.00", "LKSF": "30", "LKBF": "300"}),
        (date(2026, 3, 6), {"SWEEP": "6476.65", "LKSF": "30", "LKBF": "300"}),
        (date(2026, 3, 9), {"SWEEP": "6476.65", "LKSF": "30", "LKBF": "300"}),
    ],
)
def test_danas_positions_at_the_end_of_each_day(
    session: Session, day: date, positions: dict[str, str]
) -> None:
    load_v0(session)

    assert positions_as_of(session, JOINT, day, known_on=day) == {
        identifier: Shares(shares) for identifier, shares in positions.items()
    }


@pytest.mark.parametrize(
    ("asked_on", "cash"),
    [
        (date(2026, 3, 4), "5999.00"),  # rows 1 to 5
        (date(2026, 3, 9), "6000.50"),  # rows 1 to 5, and the Correction: 9 and 10
    ],
)
def test_cash_on_tuesday_depends_on_when_it_is_asked(
    session: Session, asked_on: date, cash: str
) -> None:
    # The primer's Part 4, "Why not just change row 5?".
    load_v0(session)

    positions = positions_as_of(session, JOINT, date(2026, 3, 3), known_on=asked_on)

    assert positions["SWEEP"] == Shares(cash)


def test_without_known_on_every_row_posted_so_far_counts(session: Session) -> None:
    load_v0(session)

    assert positions_as_of(session, JOINT, date(2026, 3, 3))["SWEEP"] == Shares("6000.50")


def test_a_settlement_date_never_moves_a_position(session: Session) -> None:
    # Row 6, the sale on Wed 4 Mar, settles on Thu 5 Mar. Say it settled a week late instead:
    # the Positions on Wednesday are the same, since they count from the Trade date (ADR 0015).
    ledger = read_ledger_fixture(LEDGER_V0_PATH)
    late = ledger.model_copy(
        update={
            "transactions": [
                row.model_copy(update={"settlement_date": date(2026, 3, 11)})
                if row.number == 6
                else row
                for row in ledger.transactions
            ]
        }
    )
    load(
        session,
        world=read_world(WORLD_V0_PATH),
        catalog=read_security_catalog(SECURITY_CATALOG_PATH),
        ledger=late,
    )

    assert positions_as_of(session, JOINT, date(2026, 3, 4), known_on=date(2026, 3, 4)) == {
        "SWEEP": Shares("7474.00"),
        "LKSF": Shares("30"),
        "LKBF": Shares("300"),
    }


def test_the_iras_positions_are_its_own(session: Session) -> None:
    load_v0(session)

    assert positions_as_of(session, IRA, date(2026, 2, 27)) == {}
    assert positions_as_of(session, IRA, date(2026, 3, 6)) == {
        "SWEEP": Shares("2995.00"),
        "LKSF": Shares("20"),
    }


def test_an_unknown_account_has_no_positions_to_give(session: Session) -> None:
    load_v0(session)

    with pytest.raises(LookupError, match="CW-999999"):
        positions_as_of(session, "CW-999999", date(2026, 3, 6))
