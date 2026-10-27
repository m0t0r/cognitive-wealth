"""`yields:write` as an agent runs it (#236), with the Treasury's files served from a folder.

Each test points `SOURCE_URL` at `file://` copies of the Treasury's yearly CSVs, made from the
committed file, so nothing reaches the network, and the committed files at copies in `tmp_path`,
so a real run never rewrites them.
"""

import csv
import json
import shutil
from collections.abc import Callable
from pathlib import Path

import pytest

from custodian import treasury_yields
from custodian.treasury_yields import TREASURY_YIELDS_PATH, TREASURY_YIELDS_SOURCE_PATH, main

# The committed file's columns, as the Treasury's yearly CSVs head them.
_TREASURY_HEADERS = {
    "1mo": "1 Mo",
    "1.5mo": "1.5 Month",
    "2mo": "2 Mo",
    "3mo": "3 Mo",
    "4mo": "4 Mo",
    "6mo": "6 Mo",
    "1y": "1 Yr",
    "2y": "2 Yr",
    "3y": "3 Yr",
    "5y": "5 Yr",
    "7y": "7 Yr",
    "10y": "10 Yr",
    "20y": "20 Yr",
    "30y": "30 Yr",
}

type Edit = Callable[[dict[str, str]], dict[str, str] | None]
"""Changes one committed row before it's served, or drops it by returning None."""


@pytest.fixture
def treasury(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Callable[[Edit], Path]:
    """Serve the committed yields as the Treasury's yearly files, each row through `edit`."""
    committed = tmp_path / "committed"
    committed.mkdir()
    shutil.copy(TREASURY_YIELDS_PATH, committed / TREASURY_YIELDS_PATH.name)
    shutil.copy(TREASURY_YIELDS_SOURCE_PATH, committed / TREASURY_YIELDS_SOURCE_PATH.name)
    monkeypatch.setattr(treasury_yields, "TREASURY_YIELDS_PATH", committed / "treasury-yields.csv")
    monkeypatch.setattr(
        treasury_yields,
        "TREASURY_YIELDS_SOURCE_PATH",
        committed / "treasury-yields.source.json",
    )

    def serve(edit: Edit) -> Path:
        served = tmp_path / "treasury"
        served.mkdir()
        lines = [line for line in TREASURY_YIELDS_PATH.read_text().splitlines() if line[0] != "#"]
        by_year: dict[str, list[dict[str, str]]] = {}
        for row in csv.DictReader(lines):
            edited = edit(row)
            if edited is None:
                continue
            year, month, day = edited.pop("date").split("-")
            treasury_row = {"Date": f"{month}/{day}/{year}"}
            # A column the committed file doesn't have keeps the header `edit` gave it.
            treasury_row |= {_TREASURY_HEADERS.get(t, t): p for t, p in edited.items()}
            by_year.setdefault(year, []).append(treasury_row)
        for year, rows in by_year.items():
            with (served / f"{year}.csv").open("w", newline="") as file:
                writer = csv.DictWriter(file, fieldnames=list(rows[0]))
                writer.writeheader()
                writer.writerows(rows)
        monkeypatch.setattr(treasury_yields, "SOURCE_URL", served.as_uri() + "/{year}.csv")
        return committed

    return serve


def unchanged(row: dict[str, str]) -> dict[str, str]:
    return row


def a_new_last_yield(row: dict[str, str]) -> dict[str, str]:
    # The Treasury revising the 30-year yield on the last day, 31 August 2026, from 5.25.
    return {**row, "30y": "5.30"} if row["date"] == "2026-08-31" else row


def test_unchanged_yields_write_nothing_and_need_no_rebuild(
    treasury: Callable[[Edit], Path], capsys: pytest.CaptureFixture[str]
) -> None:
    committed = treasury(unchanged)
    before = (committed / "treasury-yields.source.json").read_text()

    exit_code = main(["--json"])

    assert exit_code == 0
    output = json.loads(capsys.readouterr().out)
    assert output["lastDay"] == "2026-08-31"
    assert (output["changed"], output["rebuildNeeded"], output["rebuild"]) == (False, False, None)
    assert "cta" not in output
    # Not even the retrieval date is rewritten.
    assert (committed / "treasury-yields.source.json").read_text() == before


def test_a_dry_run_says_the_file_would_change_and_writes_nothing(
    treasury: Callable[[Edit], Path], capsys: pytest.CaptureFixture[str]
) -> None:
    committed = treasury(a_new_last_yield)

    exit_code = main(["--dry-run", "--json"])

    assert exit_code == 0
    output = json.loads(capsys.readouterr().out)
    assert (output["dryRun"], output["changed"], output["rebuildNeeded"]) == (True, True, False)
    assert (committed / "treasury-yields.csv").read_text() == TREASURY_YIELDS_PATH.read_text()
    [next_step] = output["cta"]["commands"]
    assert next_step["command"] == "pnpm --filter custodian yields:write"


def test_changed_yields_are_written_and_say_how_to_rebuild_the_database(
    treasury: Callable[[Edit], Path], capsys: pytest.CaptureFixture[str]
) -> None:
    committed = treasury(a_new_last_yield)

    exit_code = main(["--json"])

    assert exit_code == 0
    output = json.loads(capsys.readouterr().out)
    assert (output["changed"], output["rebuildNeeded"]) == (True, True)
    written = (committed / "treasury-yields.csv").read_text()
    assert written.splitlines()[-1].endswith(",5.30")
    source = json.loads((committed / "treasury-yields.source.json").read_text())
    assert source["sha256"] == output["sha256"]
    # Said, with the README's section to follow, but never suggested as a command to run: the
    # rebuild deletes the user's local custodian data, so an agent asks first.
    assert "Rebuilding it from empty" in output["rebuild"]
    assert "ask the user" in output["rebuild"]
    assert "cta" not in output


def test_no_yields_for_the_pins_last_day_is_refused(
    treasury: Callable[[Edit], Path], capsys: pytest.CaptureFixture[str]
) -> None:
    treasury(lambda row: None if row["date"] == "2026-08-31" else row)

    exit_code = main(["--json"])

    assert exit_code == 1
    error = json.loads(capsys.readouterr().out)
    assert (error["code"], error["retryable"]) == ("no_treasury_yields", False)
    assert "2026-08-31" in error["message"]


def test_a_treasury_file_with_a_new_column_is_refused(
    treasury: Callable[[Edit], Path], capsys: pytest.CaptureFixture[str]
) -> None:
    # A column the Treasury might add one day: served under its own header, which no tenor has.
    treasury(lambda row: {**row, "8 Yr": "4.50"})

    exit_code = main(["--json"])

    assert exit_code == 1
    error = json.loads(capsys.readouterr().out)
    assert (error["code"], error["retryable"]) == ("treasury_format_changed", False)
    assert "8 Yr" in error["message"]


def test_a_treasury_it_cant_reach_is_retryable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # A folder with no files in it: urllib fails to open each year's URL, as with no network.
    monkeypatch.setattr(treasury_yields, "SOURCE_URL", tmp_path.as_uri() + "/{year}.csv")

    exit_code = main(["--json"])

    assert exit_code == 1
    error = json.loads(capsys.readouterr().out)
    assert (error["code"], error["retryable"]) == ("treasury_unavailable", True)
