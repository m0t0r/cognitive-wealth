"""Fixtures for the tests under tests/integration/: pytest finds them by name, with no import.

These tests need Docker, so `pnpm --filter custodian test:integration` runs them and `test` skips
them, as the TypeScript packages split theirs. The migrations run once, into a template database,
and every test that asks for `database` gets a fresh copy of it, dropped afterwards. So no test
sees another's rows, and pytest-randomly shuffles the order on every run to prove it.
"""

from collections.abc import Iterator

import pytest
from alembic import command
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from tests.integration.postgres import (
    EMPTY_DATABASE,
    MIGRATED_DATABASE,
    Database,
    PostgresServer,
    alembic_config,
    start_postgres,
)


@pytest.fixture(scope="session")
def postgres_server() -> Iterator[PostgresServer]:
    """Started once per run (`scope="session"`), with the migrated template, and stopped after."""
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


@pytest.fixture
def database(postgres_server: PostgresServer) -> Iterator[Database]:
    """A migrated database for this test alone, dropped when the test ends."""
    name = postgres_server.create_database(MIGRATED_DATABASE)
    app = create_engine(postgres_server.url_for(name, "app"))
    migrator = create_engine(postgres_server.url_for(name, "migrator"))
    try:
        yield Database(name=name, app=app, migrator=migrator)
    finally:
        app.dispose()
        migrator.dispose()
        postgres_server.drop_database(name)


@pytest.fixture
def empty_database(postgres_server: PostgresServer) -> Iterator[str]:
    """A database as the roles script leaves it, with no tables, for this test alone."""
    name = postgres_server.create_database(EMPTY_DATABASE)
    try:
        yield name
    finally:
        postgres_server.drop_database(name)


@pytest.fixture
def session(database: Database) -> Iterator[Session]:
    """A session as the `app` role, the one the custodian service will connect as."""
    with Session(database.app) as session:
        yield session
