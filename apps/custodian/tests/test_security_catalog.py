import json
import re
from collections import Counter
from decimal import Decimal
from pathlib import Path

import pytest
from pydantic import BaseModel, ValidationError

from custodian.models import SecurityKind
from custodian.security_catalog import (
    INVALID_CATALOGS_PATH,
    SECURITY_CATALOG_PATH,
    Blend,
    Factors,
    NoDriver,
    Treasury,
    read_security_catalog,
)
from custodian.treasury_yields import Tenor

REPO_ROOT = Path(__file__).parents[3]

SECTION = "docs/research/security-catalog.md#{}"

ONE_OF_EACH = {
    "securities": [
        {
            "identifier": "LKSF",
            "name": "Larkspur Stock Fund",
            "kind": "fund",
            "research": SECTION.format("large-blend-stock-fund"),
            "price_driver": {
                "type": "factors",
                "mkt_rf": "1.00",
                "smb": "-0.10",
                "hml": "0.05",
                "own_volatility": "0.010",
            },
        },
        {
            "identifier": "LKBF",
            "name": "Larkspur Bond Fund",
            "kind": "fund",
            "research": SECTION.format("intermediate-term-treasury-fund"),
            "price_driver": {
                "type": "treasury",
                "tenor": "5y",
                "duration": "5.0",
                "own_volatility": "0.008",
            },
        },
        {
            "identifier": "LKBL",
            "name": "Larkspur Balanced Fund",
            "kind": "fund",
            "research": SECTION.format("6040-balanced-fund"),
            "price_driver": {
                "type": "blend",
                "factors": {"weight": "0.60", "mkt_rf": "1.00", "smb": "-0.10", "hml": "0.05"},
                "treasury": {"weight": "0.40", "tenor": "7y", "duration": "6.0"},
                "own_volatility": "0.006",
            },
        },
        {
            "identifier": "SWEEP",
            "name": "Larkspur Bank Sweep",
            "kind": "cash_sweep",
            "research": SECTION.format("cash-sweep"),
            "price_driver": {"type": "none"},
        },
    ]
}


def write_catalog(tmp_path: Path, catalog: object) -> Path:
    path = tmp_path / "security-catalog.json"
    path.write_text(json.dumps(catalog))
    return path


def test_each_price_driver_is_read_with_its_own_numbers(tmp_path: Path) -> None:
    catalog = read_security_catalog(write_catalog(tmp_path, ONE_OF_EACH))

    stock_fund, bond_fund, balanced_fund, sweep = catalog.securities
    assert (stock_fund.identifier, stock_fund.kind) == ("LKSF", SecurityKind.FUND)
    assert stock_fund.price_driver == Factors(
        type="factors",
        mkt_rf=Decimal("1.00"),
        smb=Decimal("-0.10"),
        hml=Decimal("0.05"),
        own_volatility=Decimal("0.010"),
    )
    assert isinstance(bond_fund.price_driver, Treasury)
    assert (bond_fund.price_driver.tenor, bond_fund.price_driver.duration) == (
        Tenor.FIVE_YEARS,
        Decimal("5.0"),
    )
    assert isinstance(balanced_fund.price_driver, Blend)
    assert balanced_fund.price_driver.factors.weight == Decimal("0.60")
    assert balanced_fund.price_driver.treasury.tenor == Tenor.SEVEN_YEARS
    assert sweep.price_driver == NoDriver(type="none")


class InvalidCatalog(BaseModel):
    """One entry of fixtures/invalid-security-catalogs/cases.json."""

    file: str
    field: str
    """The path of the bad field, which the error must name."""


def invalid_catalogs() -> list[InvalidCatalog]:
    cases = json.loads((INVALID_CATALOGS_PATH / "cases.json").read_text())
    return [InvalidCatalog.model_validate(case) for case in cases]


@pytest.mark.parametrize("case", invalid_catalogs(), ids=lambda case: case.file)
def test_each_invalid_catalog_is_refused_naming_the_bad_field(case: InvalidCatalog) -> None:
    with pytest.raises(ValidationError) as caught:
        read_security_catalog(INVALID_CATALOGS_PATH / case.file)

    # One error: the file breaks its own rule and no other.
    assert caught.value.error_count() == 1
    assert case.field in str(caught.value)


def test_every_invalid_catalog_file_is_listed() -> None:
    files = {path.name for path in INVALID_CATALOGS_PATH.glob("*.json")} - {"cases.json"}

    assert files == {case.file for case in invalid_catalogs()}


def test_the_committed_catalog_has_the_agreed_mix() -> None:
    catalog = read_security_catalog(SECURITY_CATALOG_PATH)

    mix = Counter((security.kind, security.price_driver.type) for security in catalog.securities)
    assert mix == {
        (SecurityKind.FUND, "factors"): 6,  # stock funds
        (SecurityKind.STOCK, "factors"): 6,
        (SecurityKind.FUND, "treasury"): 4,  # bond funds
        (SecurityKind.FUND, "blend"): 2,  # balanced funds
        (SecurityKind.CASH_SWEEP, "none"): 1,
    }


def test_the_committed_catalog_keeps_the_worlds_first_securities() -> None:
    # The feed fixtures, the world file and the Household page's tests name them.
    catalog = read_security_catalog(SECURITY_CATALOG_PATH)

    first = {
        security.identifier: (security.name, security.kind, security.price_driver.type)
        for security in catalog.securities
        if security.identifier in {"LKSF", "LKBF", "SWEEP"}
    }
    assert first == {
        "LKSF": ("Larkspur Stock Fund", SecurityKind.FUND, "factors"),
        "LKBF": ("Larkspur Bond Fund", SecurityKind.FUND, "treasury"),
        "SWEEP": ("Larkspur Bank Sweep", SecurityKind.CASH_SWEEP, "none"),
    }


def github_anchor(heading: str) -> str:
    """The anchor GitHub gives a heading: `60/40 balanced fund` is `6040-balanced-fund`."""
    return re.sub(r"[^a-z0-9 -]", "", heading.lower()).replace(" ", "-")


def test_every_entry_names_a_section_of_the_research_note() -> None:
    catalog = read_security_catalog(SECURITY_CATALOG_PATH)
    note = REPO_ROOT / "docs" / "research" / "security-catalog.md"
    headings = re.findall(r"^## (.+)$", note.read_text(), flags=re.MULTILINE)
    sections = {SECTION.format(github_anchor(heading)) for heading in headings}

    assert {security.research for security in catalog.securities} <= sections
