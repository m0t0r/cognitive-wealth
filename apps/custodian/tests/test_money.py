import json

import pytest
from pydantic import BaseModel, ValidationError

from custodian.money import Money, Price, Rate, RoundingRule, Shares


def test_shares_times_price_keeps_every_decimal_until_rounded() -> None:
    value = Shares("1000") * Price("23.4567")

    assert value.to_money(RoundingRule.HALF_EVEN) == Money("23456.70")


def test_a_dividend_reinvested_at_a_price_buys_fractional_shares() -> None:
    bought = Money("37.50") / Price("84.2731")

    assert bought.to_shares(RoundingRule.HALF_EVEN) == Shares("0.444982")


@pytest.mark.parametrize(
    ("amount", "rate", "rounded"),
    [
        ("0.25", "0.5", "0.12"),  # $0.125: the tie goes down, to the even 2
        ("0.27", "0.5", "0.14"),  # $0.135: the tie goes up, to the even 4
    ],
)
def test_half_even_sends_a_tie_to_the_even_cent(amount: str, rate: str, rounded: str) -> None:
    value = Money(amount) * Rate(rate)

    assert value.to_money(RoundingRule.HALF_EVEN) == Money(rounded)


@pytest.mark.parametrize("kind", [Money, Shares, Price, Rate])
def test_a_float_is_refused(kind: type[Money | Shares | Price | Rate]) -> None:
    with pytest.raises(TypeError, match="float"):
        kind(0.1)  # pyright: ignore[reportArgumentType] -- the runtime check is what's under test


@pytest.mark.parametrize(
    ("kind", "value"),
    [
        (Money, "0.125"),  # Money is whole cents; round an UnroundedMoney instead
        (Shares, "0.4449818"),  # Shares stop at six decimal places
        (Price, "twelve"),
        (Rate, "NaN"),
        (Money, "Infinity"),
    ],
)
def test_a_value_the_type_cannot_hold_is_refused(
    kind: type[Money | Shares | Price | Rate], value: str
) -> None:
    with pytest.raises(ValueError):
        kind(value)


def test_money_adds_and_subtracts_money() -> None:
    assert Money("10.00") - Money("2.55") + Money("0.05") == Money("7.50")


def test_shares_add_and_subtract_shares() -> None:
    assert Shares("1.5") + Shares("0.444982") - Shares("1") == Shares("0.944982")


@pytest.mark.parametrize(
    ("value", "text"),
    [
        (Money("1.5"), "1.50"),  # whole cents, always two places
        (Money(-20), "-20.00"),
        (Shares("0.444982"), "0.444982"),
        (Shares(1000), "1000.000000"),
        (Price("84.2731"), "84.2731"),  # as many places as the source quoted
        (Rate("0.0075"), "0.0075"),
    ],
)
def test_each_type_converts_to_a_decimal_string(
    value: Money | Shares | Price | Rate, text: str
) -> None:
    assert str(value) == text
    assert type(value)(text) == value


def test_mixing_kinds_fails_at_runtime_too() -> None:
    # pyright rejects this (see typing_misuses.py); the ignore lets the test run the `+` anyway,
    # as code that pyright doesn't check would.
    with pytest.raises(TypeError):
        Shares("1") + Money("1.00")  # pyright: ignore[reportOperatorIssue, reportUnusedExpression]


class Reinvestment(BaseModel):
    dividend: Money
    price: Price
    shares: Shares
    fee_rate: Rate


def test_a_pydantic_model_round_trips_through_json_as_decimal_strings() -> None:
    reinvestment = Reinvestment(
        dividend=Money("37.50"),
        price=Price("84.2731"),
        shares=Shares("0.444982"),
        fee_rate=Rate("0.0075"),
    )

    sent = reinvestment.model_dump_json()

    assert json.loads(sent) == {
        "dividend": "37.50",
        "price": "84.2731",
        "shares": "0.444982",
        "fee_rate": "0.0075",
    }
    assert Reinvestment.model_validate_json(sent) == reinvestment


@pytest.mark.parametrize("dividend", ["37.5", "37"])  # JSON numbers, not strings
def test_a_json_number_is_refused(dividend: str) -> None:
    with pytest.raises(ValidationError):
        Reinvestment.model_validate_json(
            f'{{"dividend": {dividend}, "price": "84.2731", "shares": "1", "fee_rate": "0"}}'
        )


def test_a_value_the_type_cannot_hold_is_a_validation_error() -> None:
    with pytest.raises(ValidationError, match="dividend"):
        Reinvestment.model_validate_json(
            '{"dividend": "37.505", "price": "84.2731", "shares": "1", "fee_rate": "0"}'
        )


def test_the_json_schema_says_string() -> None:
    schema = Reinvestment.model_json_schema()

    assert schema["properties"]["dividend"]["type"] == "string"
