import hashlib
import json
import os
import shutil
import subprocess
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import Row, select, text
from sqlalchemy.orm import Session

from custodian.factor_file import FIXTURE_PIN_PATH, read_pin
from custodian.ledger_fixture import LEDGER_V0_PATH, read_ledger_fixture
from custodian.load import LoadConflict, load
from custodian.models import Security
from custodian.money import Money, Price
from custodian.security_catalog import SECURITY_CATALOG_PATH, read_security_catalog
from custodian.world import WORLD_V0_PATH, read_world
from tests.integration.postgres import CUSTODIAN, Database, PostgresServer

TABLES = ("account", "security", "price", '"transaction"')


def everything_in(database: Database) -> dict[str, list[Row[tuple[object, ...]]]]:
    """Every row of every table, `id` and `recorded_at` included, read as the migrator."""
    with database.migrator.connect() as connection:
        return {
            table: list(connection.execute(text(f"select * from {table} order by id")))
            for table in TABLES
        }


def run_world_load(postgres_server: PostgresServer, database: Database, tmp_path: Path) -> str:
    """`pnpm --filter custodian world:load` as the `app` role, configured as for Compose."""
    password_file = tmp_path / "custodian_db_app_password"
    password_file.write_text(postgres_server.app_password)
    url = postgres_server.url_for(database.name, "app").set(drivername="postgres", password=None)
    pnpm = shutil.which("pnpm")
    assert pnpm, "pnpm is not on PATH"

    result = subprocess.run(
        [pnpm, "run", "world:load", "--json"],
        cwd=CUSTODIAN,
        env={
            **os.environ,
            "DATABASE_URL": url.render_as_string(hide_password=False),
            "DATABASE_PASSWORD_FILE": str(password_file),
        },
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout


def test_loading_the_world_twice_changes_nothing(
    postgres_server: PostgresServer, database: Database, tmp_path: Path
) -> None:
    run_world_load(postgres_server, database, tmp_path)
    loaded = everything_in(database)

    output = run_world_load(postgres_server, database, tmp_path)

    assert everything_in(database) == loaded
    securities = len(read_security_catalog(SECURITY_CATALOG_PATH).securities)
    assert {table: len(rows) for table, rows in loaded.items()} == {
        "account": 2,
        "security": securities,
        "price": 14,
        '"transaction"': 13,
    }
    loaded_output = json.loads(output)
    assert {key: loaded_output[key] for key in ("accounts", "securities", "prices")} == {
        "accounts": 2,
        "securities": securities,
        "prices": 14,
    }
    assert loaded_output["transactions"] == 13
    # The last Transaction in the ledger fixture was posted on Friday 6 March 2026.
    [next_step] = loaded_output["cta"]["commands"]
    assert next_step["command"] == "pnpm --filter custodian feed:write --date 2026-03-06"
    # The first load recorded the inputs: tests/conftest.py's fixture Pin, the committed yields.
    with database.migrator.connect() as connection:
        recorded = connection.execute(
            text(
                "select factor_file_sha256, factor_file_crsp_month, security_catalog_sha256"
                " from build_record"
            )
        ).one()
    pin = read_pin(FIXTURE_PIN_PATH)
    catalog_sha256 = hashlib.sha256(SECURITY_CATALOG_PATH.read_bytes()).hexdigest()
    assert tuple(recorded) == (pin.sha256, pin.crsp_month, catalog_sha256)


def test_a_load_that_would_change_the_ledger_is_refused(
    session: Session, database: Database
) -> None:
    world = read_world(WORLD_V0_PATH)
    catalog = read_security_catalog(SECURITY_CATALOG_PATH)
    ledger = read_ledger_fixture(LEDGER_V0_PATH)
    load(session, world=world, catalog=catalog, ledger=ledger)
    loaded = everything_in(database)
    # The primer's row 8, the withdrawal, written down as $1,000.01 instead.
    changed = ledger.model_copy(
        update={
            "transactions": [
                row.model_copy(update={"amount": Money("-1000.01")}) if row.number == 8 else row
                for row in ledger.transactions
            ]
        }
    )

    with pytest.raises(LoadConflict, match="CW-000001's Ledger differs from the fixture at row 8"):
        load(session, world=world, catalog=catalog, ledger=changed)

    assert everything_in(database) == loaded


def test_a_load_that_would_change_a_price_is_refused(session: Session, database: Database) -> None:
    world = read_world(WORLD_V0_PATH)
    catalog = read_security_catalog(SECURITY_CATALOG_PATH)
    ledger = read_ledger_fixture(LEDGER_V0_PATH)
    load(session, world=world, catalog=catalog, ledger=ledger)
    loaded = everything_in(database)
    bond_fund_prices = {**ledger.prices["LKBF"], date(2026, 2, 26): Price("10.01")}
    changed = ledger.model_copy(update={"prices": {**ledger.prices, "LKBF": bond_fund_prices}})

    with pytest.raises(LoadConflict, match=r"LKBF's price on 2026-02-26 is already 10\.00"):
        load(session, world=world, catalog=catalog, ledger=changed)

    assert everything_in(database) == loaded


def test_every_security_comes_from_the_catalog(session: Session) -> None:
    catalog = read_security_catalog(SECURITY_CATALOG_PATH)

    load(
        session,
        world=read_world(WORLD_V0_PATH),
        catalog=catalog,
        ledger=read_ledger_fixture(LEDGER_V0_PATH),
    )

    loaded = {
        (security.identifier, security.name, security.kind)
        for security in session.scalars(select(Security))
    }
    assert loaded == {
        (security.identifier, security.name, security.kind) for security in catalog.securities
    }


def test_a_ledger_naming_a_security_the_catalog_doesnt_have_is_refused(
    session: Session, database: Database
) -> None:
    world = read_world(WORLD_V0_PATH)
    catalog = read_security_catalog(SECURITY_CATALOG_PATH)
    ledger = read_ledger_fixture(LEDGER_V0_PATH)
    # The catalog without the Bond Fund, which the ledger buys in row 2.
    no_bond_fund = catalog.model_copy(
        update={
            "securities": [
                security for security in catalog.securities if security.identifier != "LKBF"
            ]
        }
    )

    with pytest.raises(ValueError, match=r"prices\.LKBF: not a Security in the catalog"):
        load(session, world=world, catalog=no_bond_fund, ledger=ledger)
    # Without its prices too, the first Transaction naming it is refused.
    no_bond_prices = ledger.model_copy(
        update={"prices": {key: by_day for key, by_day in ledger.prices.items() if key != "LKBF"}}
    )
    with pytest.raises(ValueError, match="Transaction 2: 'LKBF' isn't a Security in the catalog"):
        load(session, world=world, catalog=no_bond_fund, ledger=no_bond_prices)

    assert all(rows == [] for rows in everything_in(database).values())
