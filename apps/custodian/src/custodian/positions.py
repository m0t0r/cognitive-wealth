"""An Account's Positions on a day, rebuilt by adding up its Ledger (ADR 0015).

This is the primer's key idea made into code (docs/learn/01-ledger-positions-and-dates.md, "What
is a Position?"): Positions are never stored. They are a fold over the Transactions, like
`transactions.reduce(apply, empty)` in TypeScript.

Two dates pick the rows that count:

- `as_of`, the As-of date: rows with a Trade date up to it. The Settlement date never matters
  here: a buy counts from the day it was agreed, even though it settles a day later.
- `known_on`, the day asked: rows with a Posting date up to it, so a Correction posted on Friday
  is left out of an answer given on Wednesday. Leave it out to count every row posted so far.

Settled cash, the cash an Account can withdraw, is the same fold over the cash legs with one
change: money coming in counts from its Settlement date, not its Trade date (ADR 0016).
"""

from datetime import date

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session, aliased

from custodian.models import Account, Security, SecurityKind, Transaction
from custodian.money import Money, Price, RoundingRule, Shares

__all__ = ["CASH_SWEEP_PRICE", "Positions", "positions_as_of", "settled_cash_as_of"]

type Positions = dict[str, Shares]
"""Shares held, keyed by Security identifier. Cash is shares of the cash sweep."""

CASH_SWEEP_PRICE = Price("1.00")
"""The cash sweep is worth exactly $1.00 a share, so $5,990.00 of cash is 5,990 sweep shares."""


def positions_as_of(
    session: Session, account_number: str, as_of: date, *, known_on: date | None = None
) -> Positions:
    """The Account's Positions at the end of `as_of`, as known on `known_on`.

    A Security the Account holds none of, such as one bought and then all sold, is left out.
    """
    account_id = _account_id(session, account_number)

    # Each row's two legs: the cash leg (`amount`) and, if a Security moved, the share leg.
    # An outer join keeps the cash-only rows, such as a fee, whose `security_id` is null.
    rows = (
        select(Security.identifier, Transaction.shares, Transaction.amount)
        .outerjoin(Transaction.security)
        .where(Transaction.account_id == account_id, Transaction.trade_date <= as_of)
    )
    if known_on is not None:
        rows = rows.where(Transaction.posting_date <= known_on)

    # The fold: start from nothing and add each row's legs. Dollars are only added to dollars and
    # shares to shares (ADR 0013). A Reversal needs no special case: its legs are negated, so
    # adding it cancels the row it undoes.
    cash = Money(0)
    shares: dict[str, Shares] = {}
    for identifier, moved, amount in session.execute(rows):
        cash = cash + amount
        # A row with shares always has a Security: the `shares_of_a_security` check sees to it.
        if moved is not None:
            shares[identifier] = shares.get(identifier, Shares(0)) + moved

    if cash != Money(0):
        sweep = session.scalars(
            select(Security.identifier).where(Security.kind == SecurityKind.CASH_SWEEP)
        ).one()
        # Exact at $1.00 a share, so the rounding rule never has anything to round.
        shares[sweep] = (cash / CASH_SWEEP_PRICE).to_shares(RoundingRule.HALF_EVEN)
    return {identifier: held for identifier, held in shares.items() if held != Shares(0)}


def settled_cash_as_of(
    session: Session, account_number: str, as_of: date, *, known_on: date | None = None
) -> Money:
    """The cash the Account could withdraw at the end of `as_of`, as known on `known_on`.

    Money going out counts from its Trade date, since it's already owed; money coming in only from
    its Settlement date, once it has arrived. It can be negative: nothing floors it at zero.
    """
    account_id = _account_id(session, account_number)

    # A Reversal takes its direction from the row it undoes, not from its own sign, and shares
    # that row's dates, so the pair counts from the same day and cancels on every As-of date.
    # By its own sign, a Reversal of an unsettled sale would count at once as money out, while
    # the sale it undoes doesn't count yet.
    original = aliased(Transaction)
    direction = func.coalesce(original.amount, Transaction.amount)
    counts_from = case(
        (direction < Money(0), Transaction.trade_date), else_=Transaction.settlement_date
    )
    rows = (
        select(Transaction.amount)
        .outerjoin(original, Transaction.reverses.of_type(original))
        .where(Transaction.account_id == account_id, counts_from <= as_of)
    )
    if known_on is not None:
        rows = rows.where(Transaction.posting_date <= known_on)

    settled = Money(0)
    for amount in session.scalars(rows):
        settled = settled + amount
    return settled


def _account_id(session: Session, account_number: str) -> int:
    account_id = session.scalars(
        select(Account.id).where(Account.account_number == account_number)
    ).one_or_none()
    if account_id is None:
        raise LookupError(f"There is no Account {account_number}")
    return account_id
