"""What an Account's Positions are worth on a day: shares * price (docs/learn/01, Part 5).

Like Positions, it is never stored: prices change every day, so it is worked out when asked, from
the Positions as known on `known_on` and the stored prices (ADR 0016):

- A Security's price is its latest close on or before the As-of date, so a Saturday uses Friday's.
  The cash sweep is always `CASH_SWEEP_PRICE`.
- A Security with no price on or before the As-of date has no value, not $0.00. It is left out of
  the total, and the result names it, as custodians' statements say "Excludes unpriced
  securities".
- Every line is added at full precision and the total rounded to cents once (ADR 0013), so the
  total can differ by a cent or so from the sum of the lines, each rounded to the cent.
"""

from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.orm import Session

from custodian.models import Security, SecurityKind, SecurityPrice
from custodian.money import Money, Price, RoundingRule, Shares, UnroundedMoney
from custodian.positions import CASH_SWEEP_PRICE, positions_as_of

__all__ = ["MarketValue", "ValuedPosition", "market_value_as_of"]


@dataclass(frozen=True)
class ValuedPosition:
    """One priced Position, as a row of the Custodian feed's `positions.csv` (#37) has it."""

    identifier: str
    shares: Shares
    price: Price
    """The price used: the latest on or before the As-of date."""
    market_value: Money
    """`shares * price`, rounded to cents (half-even) for this line alone."""


@dataclass(frozen=True)
class MarketValue:
    positions: tuple[ValuedPosition, ...]
    """The priced Positions, by identifier."""
    total: Money
    """The priced Positions' value, added unrounded and rounded once, so not always their sum."""
    unpriced: frozenset[str]
    """The Securities held but left out of `total`, having no price yet. Usually empty."""


def market_value_as_of(
    session: Session, account_number: str, as_of: date, *, known_on: date | None = None
) -> MarketValue:
    """The Account's Market value at the end of `as_of`, as known on `known_on`."""
    held = positions_as_of(session, account_number, as_of, known_on=known_on)

    kinds = {
        identifier: kind
        for identifier, kind in session.execute(
            select(Security.identifier, Security.kind).where(Security.identifier.in_(held.keys()))
        )
    }
    # Each held Security's latest price on or before `as_of`. `distinct_on(identifier)` is
    # Postgres's `distinct on`: the first row per Security in this order, so the latest. A
    # Security with no price yet has no row.
    latest = {
        identifier: price
        for identifier, price in session.execute(
            select(Security.identifier, SecurityPrice.price)
            .join(SecurityPrice.security)
            .where(Security.identifier.in_(held.keys()), SecurityPrice.price_date <= as_of)
            .ext(distinct_on(Security.identifier))
            .order_by(Security.identifier, SecurityPrice.price_date.desc())
        )
    }

    positions: list[ValuedPosition] = []
    unpriced: set[str] = set()
    total = UnroundedMoney(0)
    for identifier, shares in sorted(held.items()):
        price = (
            CASH_SWEEP_PRICE
            if kinds[identifier] == SecurityKind.CASH_SWEEP
            else latest.get(identifier)
        )
        if price is None:
            unpriced.add(identifier)
            continue
        value = shares * price
        total = total + value
        positions.append(
            ValuedPosition(identifier, shares, price, value.to_money(RoundingRule.HALF_EVEN))
        )
    return MarketValue(
        positions=tuple(positions),
        total=total.to_money(RoundingRule.HALF_EVEN),
        unpriced=frozenset(unpriced),
    )
