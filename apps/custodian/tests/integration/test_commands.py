"""`world:load` and `feed:write` as an agent runs them (#236): in-process, on a test's database.

What they load and write is tested in test_load_world.py and test_feed.py; these check what the
commands say, their codes and their --dry-run.
"""

import json
from collections.abc import Callable
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from custodian.build_record import MarketInputs, record_build
from custodian.feed import main as feed_write
from custodian.load import main as world_load
from custodian.world import WORLD_V0_PATH
from tests.integration.postgres import Database, PostgresServer


@pytest.fixture
def as_app(
    postgres_server: PostgresServer, database: Database, monkeypatch: pytest.MonkeyPatch
) -> Database:
    """The test's database in DATABASE_URL, as the `app` role, as a command finds it."""
    url = postgres_server.url_for(database.name, "app")
    monkeypatch.setenv("DATABASE_URL", url.render_as_string(hide_password=False))
    return database


def counts(database: Database) -> dict[str, int]:
    """How many rows each table the load writes has, read as the migrator."""
    tables = ("build_record", "account", "security", "price", '"transaction"')
    with database.migrator.connect() as connection:
        return {
            table: connection.execute(text(f"select count(*) from {table}")).scalar_one()
            for table in tables
        }


def run(main: Callable[[list[str]], int], args: list[str]) -> int:
    """Run a command's `main` with --json; the test reads what it printed from `capsys`."""
    return main([*args, "--json"])


def test_a_dry_run_load_counts_everything_and_leaves_the_database_empty(
    as_app: Database, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code = run(world_load, ["--dry-run"])
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    assert output["dryRun"] is True
    assert (output["accounts"], output["prices"], output["transactions"]) == (2, 14, 13)
    # Not even the build record: the whole run is rolled back.
    assert set(counts(as_app).values()) == {0}
    [next_step] = output["cta"]["commands"]
    assert next_step["command"] == "pnpm --filter custodian world:load"


def test_a_database_built_from_other_inputs_is_refused(
    as_app: Database, capsys: pytest.CaptureFixture[str]
) -> None:
    with Session(as_app.app) as session:
        record_build(session, MarketInputs("a" * 64, "202602", "b" * 64, "e" * 64))

    exit_code = run(world_load, [])
    error = json.loads(capsys.readouterr().out)

    assert exit_code == 1
    assert (error["code"], error["retryable"]) == ("build_record_differs", False)
    assert "rebuilt from an empty database" in error["message"]


def test_a_load_that_would_change_an_account_is_a_load_conflict(
    as_app: Database, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert run(world_load, []) == 0
    loaded = counts(as_app)
    world = json.loads(WORLD_V0_PATH.read_text())
    world["custodian"]["accounts"][0]["opened_on"] = "2020-01-01"
    changed = tmp_path / "world.json"
    changed.write_text(json.dumps(world))
    capsys.readouterr()

    exit_code = run(world_load, ["--world", str(changed)])
    error = json.loads(capsys.readouterr().out)

    assert exit_code == 1
    assert error["code"] == "load_conflict"
    assert "already loaded with other details" in error["message"]
    assert counts(as_app) == loaded


def test_feed_write_returns_the_manifest_and_suggests_ingesting_it(
    as_app: Database, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert run(world_load, []) == 0
    root = tmp_path / "my feed"
    capsys.readouterr()

    exit_code = run(feed_write, ["--date", "2026-03-02", "--root", str(root)])
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    assert (output["dryRun"], output["asOf"]) == (False, "2026-03-02")
    assert output["delivery"] == str(root / "2026-03-02")
    files = {file["name"]: file for file in output["files"]}
    assert set(files) == {
        "accounts.csv",
        "positions.csv",
        "prices.csv",
        "securities.csv",
        "transactions.csv",
    }
    manifest = json.loads((root / "2026-03-02" / "manifest.json").read_text())
    assert manifest["files"] == output["files"]
    # The root isn't the default one, so the ingest is told where to look, quoted for the shell.
    [next_step] = output["cta"]["commands"]
    assert next_step["command"] == f"pnpm cw custodian ingest 2026-03-02 --root '{root}'"


def test_a_dry_run_feed_write_reports_the_same_manifest_and_writes_nothing(
    as_app: Database, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert run(world_load, []) == 0
    capsys.readouterr()
    run(feed_write, ["--date", "2026-03-02", "--root", str(tmp_path / "a")])
    written = json.loads(capsys.readouterr().out)

    exit_code = run(
        feed_write, ["--date", "2026-03-02", "--root", str(tmp_path / "b"), "--dry-run"]
    )
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    assert output["dryRun"] is True
    assert output["files"] == written["files"]
    assert not (tmp_path / "b").exists()
    assert date.fromisoformat(output["asOf"]) == date(2026, 3, 2)
