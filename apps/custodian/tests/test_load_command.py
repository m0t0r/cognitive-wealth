"""`world:load`'s refusals that come before any row is written (#236), with no database.

What it loads is tested in tests/integration/test_load_world.py, and its database refusals in
tests/integration/test_commands.py.
"""

import json
import shutil
from pathlib import Path

import pytest

from custodian.factor_file import FIXTURE_PIN_PATH
from custodian.ledger_fixture import LEDGER_V0_PATH
from custodian.load import main

# Never connected to: the engine is made first, but the refusals below all come before a query.
UNUSED_DATABASE = "postgres://app@127.0.0.1:9/custodian"


def run(args: list[str], capsys: pytest.CaptureFixture[str]) -> tuple[int, str]:
    """Run world:load with --json; returns its exit code and the code it printed."""
    exit_code = main([*args, "--json"])
    error = json.loads(capsys.readouterr().out)
    return exit_code, error["code"]


def a_pin(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, *, sha256: str) -> Path:
    """The fixture Pin with another SHA-256, in FACTOR_FILE_PIN, and an empty cache folder."""
    pin = json.loads(FIXTURE_PIN_PATH.read_text())
    pin["sha256"] = sha256
    path = tmp_path / "pin.json"
    path.write_text(json.dumps(pin))
    cache = tmp_path / "cache"
    cache.mkdir()
    monkeypatch.setenv("FACTOR_FILE_PIN", str(path))
    monkeypatch.setenv("FACTOR_FILE_CACHE", str(cache))
    monkeypatch.setenv("DATABASE_URL", UNUSED_DATABASE)
    return cache


def test_without_a_database_it_says_so_before_getting_any_market_data(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # A Pin whose file can't be had: had world:load looked for it first, it would say that.
    a_pin(tmp_path, monkeypatch, sha256="0" * 64)
    monkeypatch.delenv("DATABASE_URL")

    assert run([], capsys) == (1, "no_database")


def test_a_cached_factor_file_that_isnt_the_pinned_one_is_a_pin_mismatch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # The fixture file, cached under a name the Pin now gives another SHA-256.
    cache = a_pin(tmp_path, monkeypatch, sha256="0" * 64)
    fixture_zip = next(FIXTURE_PIN_PATH.parent.glob("*.zip"))
    shutil.copy(fixture_zip, cache / f"{'0' * 64}.zip")

    assert run([], capsys) == (1, "pin_mismatch")


def test_a_factor_file_it_cant_download_is_unavailable_and_retryable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Nothing cached, and the Pin's address (port 9, discard) gives nothing.
    a_pin(tmp_path, monkeypatch, sha256="0" * 64)

    exit_code = main(["--json"])

    assert exit_code == 1
    error = json.loads(capsys.readouterr().out)
    assert (error["code"], error["retryable"]) == ("factor_file_unavailable", True)


def test_a_world_file_that_isnt_there_is_invalid_input(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert run(["--world", str(tmp_path / "nope.json")], capsys) == (1, "invalid_input")


def test_a_ledger_the_catalog_doesnt_agree_with_is_refused_before_loading(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    ledger = json.loads(LEDGER_V0_PATH.read_text())
    ledger["prices"]["NOPE"] = ledger["prices"].pop("LKSF")
    path = tmp_path / "ledger.json"
    path.write_text(json.dumps(ledger))

    assert run(["--ledger", str(path)], capsys) == (1, "files_disagree")
