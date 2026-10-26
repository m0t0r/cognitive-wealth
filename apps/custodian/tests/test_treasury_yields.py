import csv
import hashlib
import json
from datetime import date

from custodian.factor_file import PIN_PATH, read_pin
from custodian.money import Rate
from custodian.treasury_yields import (
    TREASURY_YIELDS_PATH,
    TREASURY_YIELDS_SOURCE_PATH,
    Tenor,
    read_treasury_yields,
    yields_csv,
)


def test_the_committed_file_depends_on_its_yields_alone() -> None:
    # Its SHA-256 goes into every database's build record (build_record.py), so writing the same
    # yields again, on any day, must give the same bytes; otherwise a rerun of yields:write would
    # force every database to be rebuilt with no yield changed.
    committed = TREASURY_YIELDS_PATH.read_text()
    lines = [line for line in committed.splitlines() if not line.startswith("#")]
    rows = {
        date.fromisoformat(row.pop("date")): {Tenor(t): p for t, p in row.items() if p}
        for row in csv.DictReader(lines)
    }

    rewritten = yields_csv(rows, last_day=read_pin(PIN_PATH).ends_on)

    assert rewritten == committed


def test_where_and_when_the_yields_came_from_is_recorded_beside_them() -> None:
    source = json.loads(TREASURY_YIELDS_SOURCE_PATH.read_text())

    assert source["url"].startswith("https://home.treasury.gov/")
    assert date.fromisoformat(source["retrieved_on"]) >= read_pin(PIN_PATH).ends_on
    # It describes the committed file, so the two can't drift apart unnoticed.
    assert source["sha256"] == hashlib.sha256(TREASURY_YIELDS_PATH.read_bytes()).hexdigest()


def test_the_committed_yields_run_from_2020_to_the_pinned_factor_files_last_date() -> None:
    curves = read_treasury_yields(TREASURY_YIELDS_PATH)

    # 1 January 2020 was a holiday: the first Business day of 2020 is the 2nd.
    assert curves[0].day == date(2020, 1, 2)
    assert curves[-1].day == read_pin(PIN_PATH).ends_on
    assert [curve.day for curve in curves] == sorted({curve.day for curve in curves})


def test_each_yield_is_a_fraction_as_the_treasury_published_it() -> None:
    curves = {curve.day: curve for curve in read_treasury_yields(TREASURY_YIELDS_PATH)}

    # The Treasury's 2020 file, in percent: 01/02/2020,1.53,1.55,1.54,1.57,1.56,1.58,1.59,1.67,
    # 1.79,1.88,2.19,2.33 (1 month, 2, 3 and 6 months, then 1, 2, 3, 5, 7, 10, 20 and 30 years).
    first = curves[date(2020, 1, 2)].yields
    assert first[Tenor.ONE_MONTH] == Rate("0.0153")
    assert first[Tenor.TEN_YEARS] == Rate("0.0188")
    assert first[Tenor.THIRTY_YEARS] == Rate("0.0233")


def test_a_tenor_not_yet_published_is_absent_not_zero() -> None:
    curves = {curve.day: curve for curve in read_treasury_yields(TREASURY_YIELDS_PATH)}

    # The 4-month bill's yield starts in 2022, the 1.5-month's in 2025.
    assert Tenor.FOUR_MONTHS not in curves[date(2020, 1, 2)].yields
    assert Tenor.FOUR_MONTHS not in curves[date(2022, 1, 3)].yields
    assert Tenor.FOUR_MONTHS in curves[date(2022, 12, 30)].yields
    assert Tenor.ONE_AND_A_HALF_MONTHS not in curves[date(2025, 1, 2)].yields
    assert curves[date(2025, 12, 31)].yields[Tenor.ONE_AND_A_HALF_MONTHS] == Rate("0.0375")
