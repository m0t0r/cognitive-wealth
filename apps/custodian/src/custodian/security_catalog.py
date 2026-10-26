"""The Security catalog: every Security in the world, and what drives each one's price.

It's the custodian's own, committed in `market/security-catalog.json`, and the world loader fills
the `security` table (identifier, name, kind) from it. Cognitive Wealth never reads it: it learns
about Securities from the Security master in the feed (GLOSSARY.md, "Security catalog").

Each number in it comes from research into the real kind of fund or company the Security is
modelled on, in docs/research/security-catalog.md; each entry names the section its numbers come
from. The catalog is a market input (ADR 0019): the build record keeps its SHA-256, so it holds
the numbers alone, never a date it was written.

Every Security is a US one, a labelled simplification: the only market inputs are US Factor
returns and US Treasury yields, so nothing in them moves when another country's market falls alone.
"""

from collections.abc import Mapping
from decimal import Decimal
from pathlib import Path
from typing import Annotated, Literal, Self

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator

from custodian.models import SecurityKind
from custodian.treasury_yields import Tenor

__all__ = [
    "INVALID_CATALOGS_PATH",
    "SECURITY_CATALOG_PATH",
    "Blend",
    "BlendFactors",
    "BlendTreasury",
    "CatalogSecurity",
    "Factors",
    "NoDriver",
    "PriceDriver",
    "SecurityCatalog",
    "Treasury",
    "read_security_catalog",
]

_CUSTODIAN = Path(__file__).parents[2]

SECURITY_CATALOG_PATH = _CUSTODIAN / "market" / "security-catalog.json"

INVALID_CATALOGS_PATH = _CUSTODIAN / "fixtures" / "invalid-security-catalogs"
"""Catalogs that each break one rule, listed in `cases.json` with the field to name."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


def _decimal_string(value: object) -> object:
    """Refuse a JSON number: `1.1` would pass through a float on its way to a `Decimal`."""
    if not isinstance(value, str | Decimal):
        raise ValueError('write the number as a string, such as "1.10"')
    return value


type _Number = Annotated[Decimal, BeforeValidator(_decimal_string)]

type Exposure = _Number
"""How strongly a Security follows one factor (GLOSSARY.md, "Factor exposure")."""

type Duration = Annotated[_Number, Field(gt=0)]
"""In years: with a duration of 5, a rise of 1 percentage point lowers the price by about 5%."""

type OwnVolatility = Annotated[_Number, Field(ge=0)]
"""How much a Security moves on its own, beyond its price driver (GLOSSARY.md, "Own volatility"):
the standard deviation of that part of its Return, a fraction a year (0.25 is 25%)."""

type Weight = Annotated[_Number, Field(gt=0, lt=1)]
"""A blend part's share of the Security's value: 0.60 is 60%."""


class Factors(_Strict):
    """A stock fund or a stock: priced from its exposures to the three Fama/French factors."""

    type: Literal["factors"]
    mkt_rf: Exposure
    smb: Exposure
    hml: Exposure
    own_volatility: OwnVolatility


class Treasury(_Strict):
    """A bond fund: priced from the change in one Treasury yield, times its duration."""

    type: Literal["treasury"]
    tenor: Tenor
    """The yield it follows: a tenor the Treasury publishes, such as `5y`."""
    duration: Duration
    own_volatility: OwnVolatility


class BlendFactors(_Strict):
    """A balanced fund's stock part."""

    weight: Weight
    mkt_rf: Exposure
    smb: Exposure
    hml: Exposure


class BlendTreasury(_Strict):
    """A balanced fund's bond part."""

    weight: Weight
    tenor: Tenor
    duration: Duration


class Blend(_Strict):
    """A balanced fund: a stock part priced as `Factors` and a bond part priced as `Treasury`."""

    type: Literal["blend"]
    factors: BlendFactors
    treasury: BlendTreasury
    own_volatility: OwnVolatility


class NoDriver(_Strict):
    """The Cash sweep: worth exactly $1.00, whatever the market does. Its rate is #47's."""

    type: Literal["none"]


# A discriminated union: Pydantic reads `type` first and parses the rest as that one model, so an
# error names the field within it (`price_driver.treasury.duration`), not every model that failed.
type PriceDriver = Annotated[Factors | Treasury | Blend | NoDriver, Field(discriminator="type")]


class CatalogSecurity(_Strict):
    identifier: str
    name: str
    kind: SecurityKind
    """As the Security master sends it. A bond fund or a balanced fund is a `fund`; `bond` is an
    individual bond, which the world doesn't have."""
    research: str
    """The section of docs/research/security-catalog.md its numbers come from."""
    price_driver: PriceDriver


_DRIVERS_OF_KIND: Mapping[SecurityKind, frozenset[str]] = {
    SecurityKind.STOCK: frozenset({"factors"}),
    SecurityKind.FUND: frozenset({"factors", "treasury", "blend"}),
    SecurityKind.CASH_SWEEP: frozenset({"none"}),
    SecurityKind.BOND: frozenset(),
}
"""Which price drivers each kind of Security can have. The world has no individual bonds."""


class SecurityCatalog(_Strict):
    securities: list[CatalogSecurity]

    # The rules that need more than one field. As in world.py, each message starts with the bad
    # field's path, since an error raised here is reported against the whole catalog.
    @model_validator(mode="after")
    def _securities_fit_together(self) -> Self:
        identifiers: set[str] = set()
        for index, security in enumerate(self.securities):
            where = f"securities.{index}"
            if security.identifier in identifiers:
                raise ValueError(
                    f"{where}.identifier: {security.identifier!r} is already a Security"
                )
            identifiers.add(security.identifier)
            driver = security.price_driver
            if driver.type not in _DRIVERS_OF_KIND[security.kind]:
                allowed = " or ".join(sorted(_DRIVERS_OF_KIND[security.kind])) or "nothing"
                raise ValueError(
                    f"{where}.price_driver: a {security.kind} is priced by {allowed},"
                    f" not {driver.type}"
                )
            if isinstance(driver, Blend):
                total = driver.factors.weight + driver.treasury.weight
                if total != 1:
                    raise ValueError(f"{where}.price_driver: the weights add up to {total}, not 1")
        return self


def read_security_catalog(path: Path) -> SecurityCatalog:
    """The catalog at `path`, or a `ValidationError` naming each bad field."""
    return SecurityCatalog.model_validate_json(path.read_text())
