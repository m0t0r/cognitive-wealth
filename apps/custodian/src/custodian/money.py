"""Exact number types for money, share counts, prices and rates (ADR 0013). Never `float`.

Only the operations that mean something type-check:

- `Money ± Money` is `Money`, `Shares ± Shares` is `Shares`, and `UnroundedMoney +
  UnroundedMoney` is `UnroundedMoney`.
- `Shares * Price` and `Money * Rate` are `UnroundedMoney`, and `Money / Price` is
  `UnroundedShares`. Each becomes recorded `Money` or `Shares` only through a named
  `RoundingRule`, so a result is rounded once, at the end.

Sums and products are exact, or raise if they'd need more than 60 significant digits. A quotient
rarely ends (1 / 3), so division keeps 60 significant digits, far past a cent or a millionth of a
share.
"""

from decimal import (
    ROUND_DOWN,
    ROUND_HALF_EVEN,
    Context,
    Decimal,
    DivisionByZero,
    Inexact,
    InvalidOperation,
    Overflow,
)
from enum import Enum
from typing import ClassVar, Self

from pydantic import GetCoreSchemaHandler
from pydantic_core import core_schema

__all__ = ["Money", "Price", "Rate", "RoundingRule", "Shares", "UnroundedMoney", "UnroundedShares"]

_CENT = Decimal("0.01")
_SHARE_STEP = Decimal("0.000001")

# Explicit contexts, not Python's global one (28 digits, which any code can change). A trapped
# signal raises; an untrapped one is only recorded. `_EXACT` traps Inexact, so +, - and * raise
# rather than round. `_ROUNDING` lets division and the rounding rules round, as they must.
_PRECISION = 60
_EXACT = Context(prec=_PRECISION, traps=[InvalidOperation, DivisionByZero, Overflow, Inexact])
_ROUNDING = Context(prec=_PRECISION, traps=[InvalidOperation, DivisionByZero, Overflow])


class RoundingRule(Enum):
    """How an unrounded result becomes a recorded value. Each rule is named for its job."""

    HALF_EVEN = ROUND_HALF_EVEN
    """For aggregates: a tie goes to the even digit, so ties don't drift up over many sums."""

    DOWN = ROUND_DOWN
    """For shares bought with cash: drop the extra digits (toward zero), so the shares never cost
    more than the cash that bought them, as brokers do (docs/research/fractional-share-rounding.md).
    """


class _Exact:
    """An immutable wrapper around a `Decimal`. Subclasses decide which operations make sense."""

    __slots__ = ("_value",)
    _value: Decimal
    _step: ClassVar[Decimal | None] = None
    """The smallest step a fixed-scale type can hold (a cent, a millionth of a share), or None."""

    def __init__(self, value: int | str | Decimal) -> None:
        name = type(self).__name__
        # The type hint rules out float only for callers pyright checks, so check at runtime too.
        # bool is a subclass of int, and True isn't an amount.
        if isinstance(value, float | bool):
            raise TypeError(
                f"{name} takes an int, str or Decimal, not"
                f" {type(value).__name__}: a float can't hold most decimals exactly"
            )
        try:
            exact = Decimal(value)
        except InvalidOperation:
            raise ValueError(f"{name} can't be made from {value!r}") from None
        if not exact.is_finite():
            raise ValueError(f"{name} must be a finite number, not {value!r}")
        if self._step is not None:
            # Kept at its scale, as Postgres numeric with a declared scale returns it: 1.5 is 1.50.
            try:
                scaled = exact.quantize(self._step, context=_ROUNDING)
            except InvalidOperation:
                raise ValueError(f"{name} has too many digits: {value!r}") from None
            if scaled != exact:
                raise ValueError(f"{name} holds steps of {self._step}, so it can't hold {value!r}")
            exact = scaled
        object.__setattr__(self, "_value", exact)

    def __setattr__(self, name: str, value: object) -> None:
        raise AttributeError(f"{type(self).__name__} is immutable")

    def __eq__(self, other: object) -> bool:
        return (
            isinstance(other, _Exact) and type(other) is type(self) and self._value == other._value
        )

    def __hash__(self) -> int:
        return hash((type(self), self._value))

    def __str__(self) -> str:
        return str(self._value)

    def __repr__(self) -> str:
        return f'{type(self).__name__}("{self._value}")'

    def _decimal_of(self, other: object, kind: type[_Exact]) -> Decimal:
        """`other`'s Decimal, or a TypeError if it isn't a `kind`.

        The operators' type hints let pyright reject `Shares + Money`; this check stops code that
        pyright doesn't check from getting a wrong answer instead of an error.
        """
        if not isinstance(other, kind):
            raise TypeError(
                f"{type(self).__name__} can't be combined with {type(other).__name__} here,"
                f" only with {kind.__name__}"
            )
        return other._value


class _DecimalString(_Exact):
    """A kind that crosses the API boundary: a Pydantic field type, sent as a decimal string.

    Unrounded values aren't one, so they can't be sent before a rounding rule makes them Money.
    """

    __slots__ = ()

    @classmethod
    def __get_pydantic_core_schema__(
        cls, source_type: object, handler: GetCoreSchemaHandler
    ) -> core_schema.CoreSchema:
        # Pydantic calls this hook to learn how to validate and serialize a field of this type.
        return core_schema.json_or_python_schema(
            # From JSON: only a string. A JSON number has already been through a float.
            json_schema=core_schema.chain_schema(
                [core_schema.str_schema(), core_schema.no_info_plain_validator_function(cls._parse)]
            ),
            # From Python: an instance, or anything the constructor takes.
            python_schema=core_schema.no_info_plain_validator_function(cls._parse),
            serialization=core_schema.plain_serializer_function_ser_schema(
                str, return_schema=core_schema.str_schema(), when_used="json"
            ),
        )

    @classmethod
    def _parse(cls, value: object) -> Self:
        if isinstance(value, cls):
            return value
        if not isinstance(value, int | str | Decimal):
            raise ValueError(
                f"{cls.__name__} takes an int, str or Decimal, not {type(value).__name__}"
            )
        try:
            return cls(value)
        except TypeError as error:
            # Pydantic reports a ValueError as a validation error; a TypeError would escape.
            raise ValueError(str(error)) from None


class Money(_DecimalString):
    """US dollars in whole cents: every amount that is stored, sent or shown."""

    __slots__ = ()
    _step = _CENT

    def __add__(self, other: Money) -> Money:
        return Money(_EXACT.add(self._value, self._decimal_of(other, Money)))

    def __sub__(self, other: Money) -> Money:
        return Money(_EXACT.subtract(self._value, self._decimal_of(other, Money)))

    def __mul__(self, rate: Rate) -> UnroundedMoney:
        return UnroundedMoney(_EXACT.multiply(self._value, self._decimal_of(rate, Rate)))

    def __truediv__(self, price: Price) -> UnroundedShares:
        return UnroundedShares(_ROUNDING.divide(self._value, self._decimal_of(price, Price)))


class UnroundedMoney(_Exact):
    """Dollars, unrounded, mid-calculation. Becomes `Money` only through a `RoundingRule`."""

    __slots__ = ()

    def __add__(self, other: UnroundedMoney) -> UnroundedMoney:
        # So a total of many products, such as a Market value, is rounded once, not per line.
        return UnroundedMoney(_EXACT.add(self._value, self._decimal_of(other, UnroundedMoney)))

    def to_money(self, rule: RoundingRule) -> Money:
        return Money(self._value.quantize(_CENT, rounding=rule.value, context=_ROUNDING))


class Price(_DecimalString):
    """Dollars per share, to as many decimal places as the source quotes."""

    __slots__ = ()


class Rate(_DecimalString):
    """A fraction such as a fee rate, tax rate or return, at full precision."""

    __slots__ = ()


class Shares(_DecimalString):
    """A count of a security, to at most six decimal places."""

    __slots__ = ()
    _step = _SHARE_STEP

    def __add__(self, other: Shares) -> Shares:
        return Shares(_EXACT.add(self._value, self._decimal_of(other, Shares)))

    def __sub__(self, other: Shares) -> Shares:
        return Shares(_EXACT.subtract(self._value, self._decimal_of(other, Shares)))

    def __mul__(self, price: Price) -> UnroundedMoney:
        return UnroundedMoney(_EXACT.multiply(self._value, self._decimal_of(price, Price)))


class UnroundedShares(_Exact):
    """A share count, unrounded, mid-calculation. Becomes `Shares` via a `RoundingRule`."""

    __slots__ = ()

    def to_shares(self, rule: RoundingRule) -> Shares:
        return Shares(self._value.quantize(_SHARE_STEP, rounding=rule.value, context=_ROUNDING))
