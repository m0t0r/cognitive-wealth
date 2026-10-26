import os
import shutil
import subprocess
from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

from custodian.build_record import BuildMismatch, MarketInputs, check_build
from custodian.models import Base
from tests.integration.postgres import CUSTODIAN, Database, PostgresServer, alembic_config


def test_the_package_script_migrates_an_empty_database_to_head(
    postgres_server: PostgresServer, empty_database: str, tmp_path: Path
) -> None:
    # Configured as for Compose's custodian-db: a URL without the password, and a password file.
    password_file = tmp_path / "custodian_db_migrator_password"
    password_file.write_text(postgres_server.migrator_password)
    url = postgres_server.url_for(empty_database, "migrator").set(
        drivername="postgres", password=None
    )
    pnpm = shutil.which("pnpm")
    assert pnpm, "pnpm is not on PATH"

    result = subprocess.run(
        [pnpm, "run", "db:migrate"],
        cwd=CUSTODIAN,
        # A copy of this process's environment with two variables set, like `{ ...a, b }`.
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
    assert "Running upgrade 0001 -> 0002" in result.stderr
    engine = create_engine(postgres_server.url_for(empty_database, "app"))
    try:
        assert set(inspect(engine).get_table_names()) == {
            "alembic_version",
            "account",
            "security",
            "transaction",
            "price",
            "build_record",
        }
    finally:
        engine.dispose()


def test_the_migrations_create_exactly_what_the_models_describe(database: Database) -> None:
    # What `alembic revision --autogenerate` would put in a new migration: nothing, if the
    # hand-written migrations and models agree.
    with database.migrator.connect() as connection:
        differences = compare_metadata(MigrationContext.configure(connection), Base.metadata)

    assert differences == []


def test_downgrading_to_base_leaves_only_alembics_table(database: Database) -> None:
    with database.migrator.begin() as connection:
        command.downgrade(alembic_config(connection), "base")

    with database.migrator.connect() as connection:
        tables = inspect(connection).get_table_names()
        types = connection.execute(text("select typname from pg_type where typtype = 'e'")).all()

    assert tables == ["alembic_version"]
    assert types == []


def test_rows_loaded_before_0004_get_the_id_world_load_gives_them(database: Database) -> None:
    # A dev database loaded before Transactions had a public ID. A `world:load` that failed and
    # rolled back still used up ids 1 to 13 (Postgres never hands an identity value back), so the
    # load that worked numbered its rows from 14. They still get TX-000000001 and TX-000000002,
    # by their order in the Ledger, as `world:load` gives them in an empty database.
    with database.migrator.begin() as connection:
        command.downgrade(alembic_config(connection), "0003")
        connection.execute(
            text("""
                insert into account (account_number, registration_type, opened_on)
                values ('CW-000001', 'joint', '2026-02-26');
                alter table "transaction" alter column id restart with 14;
                insert into "transaction"
                    (account_id, kind, trade_date, settlement_date, posting_date, amount)
                select id, 'contribution', '2026-02-26', '2026-02-26', '2026-02-26', 5000
                from account cross join generate_series(1, 2);
            """)
        )
        command.upgrade(alembic_config(connection), "head")

    with database.migrator.connect() as connection:
        ids = connection.execute(
            text('select id, transaction_id from "transaction" order by id')
        ).all()

    assert [tuple(row) for row in ids] == [(14, "TX-000000001"), (15, "TX-000000002")]


def test_a_database_recorded_before_0006_must_be_rebuilt(database: Database) -> None:
    # Its Securities came from the ledger fixture, not a catalog, so no catalog matches it.
    with database.migrator.begin() as connection:
        command.downgrade(alembic_config(connection), "0005")
        connection.execute(
            text("""
                insert into build_record
                    (factor_file_sha256, factor_file_crsp_month, treasury_yields_sha256)
                values (repeat('a', 64), '202608', repeat('b', 64))
            """)
        )
        command.upgrade(alembic_config(connection), "head")
    committed = MarketInputs(
        factor_file_sha256="a" * 64,
        factor_file_crsp_month="202608",
        treasury_yields_sha256="b" * 64,
        security_catalog_sha256="c" * 64,
    )

    with (
        Session(database.app) as session,
        pytest.raises(BuildMismatch, match="the Security catalog was not recorded"),
    ):
        check_build(session, committed)
