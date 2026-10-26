"""Treasury yields: the US Treasury's daily par yield curve, committed in `market/`.

They're a work of the US government, so unlike the Factor file they're committed rather than
pinned (ADR 0019). The file runs from the first Business day of 2020 to the pinned Factor file's
last date, so real history ends on one day for every market input.

`pnpm --filter custodian yields:write` rebuilds it from the Treasury's yearly CSVs. It's run by
hand, when the Pin moves; no test or start-up runs it. Its values are kept as published, in
percent, and `read_treasury_yields` turns them into fractions. The file holds nothing but the
yields, so its SHA-256, which the build record keeps, changes only when a yield does: run again
on unchanged yields, the script writes nothing.
"""

import argparse
import csv
import hashlib
import io
import json
import urllib.request
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from enum import StrEnum
from pathlib import Path

from custodian.cli import script_args
from custodian.factor_file import PIN_PATH, read_pin
from custodian.money import Rate

__all__ = [
    "TREASURY_YIELDS_PATH",
    "TREASURY_YIELDS_SOURCE_PATH",
    "Tenor",
    "YieldCurve",
    "main",
    "read_treasury_yields",
    "yields_csv",
]

_MARKET = Path(__file__).parents[2] / "market"

TREASURY_YIELDS_PATH = _MARKET / "treasury-yields.csv"

TREASURY_YIELDS_SOURCE_PATH = _MARKET / "treasury-yields.source.json"
"""Where the yields came from, when, and the SHA-256 of the file that run wrote."""

FIRST_DAY = date(2020, 1, 1)

SOURCE_URL = (
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
    "daily-treasury-rates.csv/{year}/all?type=daily_treasury_yield_curve"
    "&field_tdr_date_value={year}&page&_format=csv"
)
"""One year's daily par yield curve, as the Treasury's "Daily Treasury Par Yield Curve Rates"
page offers it for download."""


class Tenor(StrEnum):
    """How long until a Treasury security repays: a column of the yield curve."""

    ONE_MONTH = "1mo"
    ONE_AND_A_HALF_MONTHS = "1.5mo"
    """Published from 18 February 2025."""
    TWO_MONTHS = "2mo"
    THREE_MONTHS = "3mo"
    FOUR_MONTHS = "4mo"
    """Published from 19 October 2022."""
    SIX_MONTHS = "6mo"
    ONE_YEAR = "1y"
    TWO_YEARS = "2y"
    THREE_YEARS = "3y"
    FIVE_YEARS = "5y"
    SEVEN_YEARS = "7y"
    TEN_YEARS = "10y"
    TWENTY_YEARS = "20y"
    THIRTY_YEARS = "30y"


_TREASURY_COLUMNS = {
    "1 Mo": Tenor.ONE_MONTH,
    "1.5 Month": Tenor.ONE_AND_A_HALF_MONTHS,
    "2 Mo": Tenor.TWO_MONTHS,
    "3 Mo": Tenor.THREE_MONTHS,
    "4 Mo": Tenor.FOUR_MONTHS,
    "6 Mo": Tenor.SIX_MONTHS,
    "1 Yr": Tenor.ONE_YEAR,
    "2 Yr": Tenor.TWO_YEARS,
    "3 Yr": Tenor.THREE_YEARS,
    "5 Yr": Tenor.FIVE_YEARS,
    "7 Yr": Tenor.SEVEN_YEARS,
    "10 Yr": Tenor.TEN_YEARS,
    "20 Yr": Tenor.TWENTY_YEARS,
    "30 Yr": Tenor.THIRTY_YEARS,
}
"""The Treasury's column headers, which name the same tenors less tidily."""


@dataclass(frozen=True)
class YieldCurve:
    """One Business day's Treasury yields."""

    day: date
    yields: Mapping[Tenor, Rate]
    """Each tenor's yield, a fraction a year: the published 4.11 (percent) is `Rate("0.0411")`.
    A tenor the Treasury didn't publish that day isn't in it: absent, never zero."""


def read_treasury_yields(path: Path) -> list[YieldCurve]:
    """Every day in the committed file at `path`, oldest first."""
    curves: list[YieldCurve] = []
    lines = (line for line in path.read_text().splitlines() if not line.startswith("#"))
    for row in csv.DictReader(lines):
        day = date.fromisoformat(row.pop("date"))
        yields = {
            Tenor(tenor): Rate.from_percent(percent) for tenor, percent in row.items() if percent
        }
        curves.append(YieldCurve(day=day, yields=yields))
    return curves


# --- `yields:write`: the rebuild from the Treasury's CSVs, run by hand.


def _treasury_rows(text: str) -> dict[date, dict[Tenor, str]]:
    """One yearly Treasury CSV's percents (as published) by day. Unknown columns are refused."""
    rows: dict[date, dict[Tenor, str]] = {}
    for row in csv.DictReader(io.StringIO(text)):
        day = datetime.strptime(row.pop("Date"), "%m/%d/%Y").date()
        unknown = set(row) - set(_TREASURY_COLUMNS)
        if unknown:
            raise ValueError(f"The Treasury's file has columns this script doesn't know: {unknown}")
        rows[day] = {_TREASURY_COLUMNS[name]: value for name, value in row.items() if value}
    return rows


def _download(year: int) -> str:
    with urllib.request.urlopen(SOURCE_URL.format(year=year), timeout=60) as response:
        body: bytes = response.read()
    return body.decode("utf-8-sig")  # `-sig` drops a byte-order mark, if the file starts with one


def yields_csv(rows: Mapping[date, Mapping[Tenor, str]], *, last_day: date) -> str:
    """The committed file's text for `rows` (percents as published), up to `last_day`.

    It depends on the yields and the Pin alone, never on when it's written: its SHA-256 is in
    every database's build record, so the same yields must always give the same bytes. When they
    were retrieved goes in `treasury-yields.source.json` instead, which isn't hashed.
    """
    out = io.StringIO()
    out.write("# The Treasury's Daily Treasury Par Yield Curve Rates, in percent, as published\n")
    out.write("# Where and when they were retrieved: treasury-yields.source.json\n")
    out.write(f"# From {FIRST_DAY} to {last_day}, the pinned Factor file's last date\n")
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(["date", *Tenor])
    for day in sorted(rows):
        if FIRST_DAY <= day <= last_day:
            writer.writerow([day.isoformat(), *(rows[day].get(tenor, "") for tenor in Tenor)])
    return out.getvalue()


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="yields:write", description=__doc__)
    parser.parse_args(script_args(argv))

    last_day = read_pin(PIN_PATH).ends_on
    rows: dict[date, dict[Tenor, str]] = {}
    for year in range(FIRST_DAY.year, last_day.year + 1):
        rows |= _treasury_rows(_download(year))
    if last_day not in rows:
        raise SystemExit(f"The Treasury has no yields for {last_day}, the Factor file's last date")

    text = yields_csv(rows, last_day=last_day)
    if TREASURY_YIELDS_PATH.exists() and TREASURY_YIELDS_PATH.read_text() == text:
        # Nothing to write, not even the retrieval date: the committed yields are still right.
        print(f"The Treasury's yields to {last_day} are unchanged; nothing written")
        return
    TREASURY_YIELDS_PATH.write_text(text)
    source = {
        "url": SOURCE_URL,
        "retrieved_on": date.today().isoformat(),
        "sha256": hashlib.sha256(text.encode()).hexdigest(),
    }
    TREASURY_YIELDS_SOURCE_PATH.write_text(json.dumps(source, indent=2) + "\n")
    print(
        f"Wrote a changed {TREASURY_YIELDS_PATH.name}: its SHA-256 is new, so every custodian"
        " database built from the old file must be rebuilt from empty (ADR 0019)"
    )


if __name__ == "__main__":
    main()
