"""The run's throwaway Postgres, for the fixtures in conftest.py, the tests that need its parts,
and example_deliveries.py.

One container per run, set up like Compose's `custodian-db`: the same image, the same roles script
and scram-sha-256 passwords. It is never the dev database: its passwords are random, its data is
in memory, and Testcontainers' reaper removes it when the run ends.
"""

import secrets
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from uuid import uuid4

import yaml
from alembic import command
from alembic.config import Config
from sqlalchemy import URL, Connection, Engine, create_engine, make_url, text
from testcontainers.community.postgres import PostgresContainer
from testcontainers.core.config import testcontainers_config

__all__ = [
    "CUSTODIAN",
    "EMPTY_DATABASE",
    "MIGRATED_DATABASE",
    "Database",
    "PostgresServer",
    "Role",
    "alembic_config",
    "migrated_database",
    "start_migrated_postgres",
    "start_postgres",
]

CUSTODIAN = Path(__file__).parents[2]
REPO_ROOT = CUSTODIAN.parent.parent

EMPTY_DATABASE = "custodian"
"""The database the roles script sets up: the roles can reach it, but it has no tables."""
MIGRATED_DATABASE = "custodian_migrated"
"""A copy of EMPTY_DATABASE, migrated to head once per run. Each test's database copies it."""

type Role = Literal["migrator", "app"]

# Testcontainers' reaper, pinned by digest as in apps/web-e2e (its default is an old tag).
testcontainers_config.ryuk_image = (
    "testcontainers/ryuk:0.14.0"
    "@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0"
)


def compose_image() -> str:
    """The `custodian-db` image from compose.yaml, so tests run on exactly what Compose runs."""
    compose: object = yaml.safe_load((REPO_ROOT / "compose.yaml").read_text())
    # A `match` checks the shape and pulls the value out in one step: the `str(image)` pattern
    # only matches a string, so pyright knows `image` is one.
    match compose:
        case {"services": {"custodian-db": {"image": str(image)}}}:
            return image
        case _:
            raise LookupError("compose.yaml has no services.custodian-db.image")


def alembic_config(connection: Connection) -> Config:
    """Alembic's config from pyproject.toml, told to run on `connection`.

    migrations/env.py uses the connection instead of reading DATABASE_URL, so the migrations run
    in this process, on the test's own database.
    """
    config = Config(toml_file=str(CUSTODIAN / "pyproject.toml"))
    config.attributes["connection"] = connection
    return config


@dataclass(frozen=True)
class Database:
    """One test's own database, with an engine for each role."""

    name: str
    app: Engine
    migrator: Engine


@dataclass(frozen=True)
class PostgresServer:
    """The run's Postgres: a superuser URL and the two roles' passwords."""

    superuser_url: URL
    migrator_password: str
    app_password: str

    def url_for(self, database: str, role: Role) -> URL:
        """A URL for `database`, signed in as `role`."""
        password = self.migrator_password if role == "migrator" else self.app_password
        return self.superuser_url.set(database=database, username=role, password=password)

    def create_database(self, template: str, name: str | None = None) -> str:
        """A new database copied from `template`, which the roles can connect to as to EMPTY's.

        A copy keeps everything inside the template (tables and the grants on them), but not who
        may connect to the database itself, so that is set again here.
        """
        name = name or f"test_{uuid4().hex}"
        with self._superuser() as connection:
            connection.execute(text(f'create database "{name}" template "{template}"'))
            connection.execute(text(f'alter database "{name}" owner to migrator'))
            connection.execute(text(f'revoke all on database "{name}" from public'))
            connection.execute(text(f'grant connect on database "{name}" to app'))
        return name

    def drop_database(self, name: str) -> None:
        with self._superuser() as connection:
            connection.execute(text(f'drop database "{name}" with (force)'))

    @contextmanager
    def _superuser(self) -> Generator[Connection]:
        """A superuser connection that commits each statement, for `with self._superuser() as c:`.

        CREATE and DROP DATABASE can't run inside a transaction. The code after `yield` runs when
        the `with` block ends, even if it raised.
        """
        engine = create_engine(self.superuser_url, isolation_level="AUTOCOMMIT")
        try:
            with engine.connect() as connection:
                yield connection
        finally:
            engine.dispose()


@contextmanager
def start_postgres() -> Generator[PostgresServer]:
    """Start the container, and stop it when the `with` block ends."""
    # Random passwords: Docker may publish the port on every host interface.
    superuser_password = secrets.token_hex(24)
    migrator_password = secrets.token_hex(24)
    app_password = secrets.token_hex(24)
    container = (
        PostgresContainer(
            compose_image(),
            username="postgres",
            password=superuser_password,
            dbname=EMPTY_DATABASE,
            driver="psycopg",
        )
        .with_env("POSTGRES_INITDB_ARGS", "--auth-local=scram-sha-256 --auth-host=scram-sha-256")
        .with_copy_into_container(
            CUSTODIAN / "docker/initdb/01-roles.sh",
            "/docker-entrypoint-initdb.d/01-roles.sh",
            0o755,
        )
        .with_copy_into_container(
            migrator_password.encode(), "/run/secrets/custodian_db_migrator_password", 0o444
        )
        .with_copy_into_container(
            app_password.encode(), "/run/secrets/custodian_db_app_password", 0o444
        )
        # Disposable data: keep it in memory and skip durability work.
        .with_tmpfs_mount("/var/lib/postgresql")
        .with_command("postgres -c fsync=off -c synchronous_commit=off -c full_page_writes=off")
    )
    with container:
        yield PostgresServer(
            superuser_url=make_url(container.get_connection_url()),
            migrator_password=migrator_password,
            app_password=app_password,
        )


@contextmanager
def start_migrated_postgres() -> Generator[PostgresServer]:
    """`start_postgres`, plus MIGRATED_DATABASE: a copy of EMPTY_DATABASE migrated to head."""
    with start_postgres() as server:
        server.create_database(EMPTY_DATABASE, name=MIGRATED_DATABASE)
        # `alembic upgrade head`, as `pnpm --filter custodian db:migrate` runs it.
        engine = create_engine(server.url_for(MIGRATED_DATABASE, "migrator"))
        try:
            with engine.begin() as connection:
                command.upgrade(alembic_config(connection), "head")
        finally:
            engine.dispose()
        yield server


@contextmanager
def migrated_database(server: PostgresServer) -> Generator[Database]:
    """A fresh copy of MIGRATED_DATABASE with an engine per role, dropped when the block ends."""
    name = server.create_database(MIGRATED_DATABASE)
    app = create_engine(server.url_for(name, "app"))
    migrator = create_engine(server.url_for(name, "migrator"))
    try:
        yield Database(name=name, app=app, migrator=migrator)
    finally:
        app.dispose()
        migrator.dispose()
        server.drop_database(name)
