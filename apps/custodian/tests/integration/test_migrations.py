import os
import shutil
import subprocess
from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text

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
