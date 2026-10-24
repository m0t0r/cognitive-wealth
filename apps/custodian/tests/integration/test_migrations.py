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
