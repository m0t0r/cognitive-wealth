import os
import shutil
import subprocess
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import Row, select, text
from sqlalchemy.orm import Session

from custodian.ledger_fixture import LEDGER_V0_PATH, read_ledger_fixture
from custodian.load import LoadConflict, load
from custodian.models import Transaction, TransactionKind
from custodian.money import Money, Price
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
        [pnpm, "run", "world:load"],
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
    assert {table: len(rows) for table, rows in loaded.items()} == {
        "account": 2,
        "security": 3,
        "price": 14,
        '"transaction"': 13,
    }
    assert "Loaded 2 Accounts, 3 Securities, 14 prices and 13 Transactions" in output


def test_each_transaction_gets_its_fixture_rows_transaction_id(session: Session) -> None:
    load(session, read_world(WORLD_V0_PATH), read_ledger_fixture(LEDGER_V0_PATH))

    recorded = session.execute(
        select(Transaction.transaction_id, Transaction.kind, Transaction.amount).order_by(
            Transaction.transaction_id
        )
    ).all()

    assert len(recorded) == 13
    # The primer's row 9 is the Reversal of row 5's dividend, and row 13 the IRA's buy.
    assert recorded[8] == ("TX-000000009", TransactionKind.REVERSAL, Money("-9.00"))
    assert recorded[12] == ("TX-000000013", TransactionKind.BUY, Money("-3005.00"))


def test_a_load_that_would_change_the_ledger_is_refused(
    session: Session, database: Database
) -> None:
    world = read_world(WORLD_V0_PATH)
    ledger = read_ledger_fixture(LEDGER_V0_PATH)
    load(session, world, ledger)
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
        load(session, world, changed)

    assert everything_in(database) == loaded


def test_a_load_that_would_change_a_price_is_refused(session: Session, database: Database) -> None:
    world = read_world(WORLD_V0_PATH)
    ledger = read_ledger_fixture(LEDGER_V0_PATH)
    load(session, world, ledger)
    loaded = everything_in(database)
    bond_fund_prices = {**ledger.prices["LKBF"], date(2026, 2, 26): Price("10.01")}
    changed = ledger.model_copy(update={"prices": {**ledger.prices, "LKBF": bond_fund_prices}})

    with pytest.raises(LoadConflict, match=r"LKBF's price on 2026-02-26 is already 10\.00"):
        load(session, world, changed)

    assert everything_in(database) == loaded
