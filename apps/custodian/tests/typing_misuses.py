"""Misuses of the money types that pyright must reject. Checked by `pnpm check-types`, never run.

Each line expects an error, named in its ignore comment. `reportUnnecessaryTypeIgnoreComment` is on
in `pyproject.toml`, so if a misuse stops being an error, its ignore is unnecessary and pyright
fails. pytest doesn't collect this file, because its name doesn't start with `test_`.
"""

# The misuses are bare expressions; without this, each line would carry a second error.
# pyright: reportUnusedExpression=false

from custodian.money import Money, Price, Rate, Shares


def misuses() -> None:
    money = Money("37.50")
    shares = Shares("0.444981")
    price = Price("84.2731")
    rate = Rate("0.0075")
    unrounded = shares * price

    # Kinds that measure different things don't combine.
    shares + money  # pyright: ignore[reportOperatorIssue]
    money + shares  # pyright: ignore[reportOperatorIssue]
    money - price  # pyright: ignore[reportOperatorIssue]
    shares * money  # pyright: ignore[reportOperatorIssue]
    shares * rate  # pyright: ignore[reportOperatorIssue]

    # Prices and rates are factors, not amounts: adding two has no meaning.
    price + price  # pyright: ignore[reportOperatorIssue]
    rate + rate  # pyright: ignore[reportOperatorIssue]

    # Money * Money and Money * Price have no meaning either.
    money * money  # pyright: ignore[reportOperatorIssue]
    money * price  # pyright: ignore[reportOperatorIssue]

    # An unrounded amount isn't Money until a rounding rule makes it so.
    money + unrounded  # pyright: ignore[reportOperatorIssue]
    _recorded: Money = unrounded  # pyright: ignore[reportAssignmentType]
    unrounded.to_money("half-even")  # pyright: ignore[reportArgumentType]

    # Built from an int, str or Decimal, never a float.
    Money(37.5)  # pyright: ignore[reportArgumentType]
    Shares(0.444982)  # pyright: ignore[reportArgumentType]
    Price(84.2731)  # pyright: ignore[reportArgumentType]
    Rate(0.0075)  # pyright: ignore[reportArgumentType]
