"""Fixtures for every test under tests/. pytest finds this file by name; tests don't import it."""

import pytest


@pytest.fixture(autouse=True)
def no_database_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """Unset the shell's DATABASE_URL and DATABASE_PASSWORD_FILE for every test (`autouse=True`).

    They may point at the dev database. A test reaches Postgres only through the fixtures in
    tests/integration/, so code that reads the environment by mistake fails instead of writing
    to real data. `monkeypatch` puts them back after the test.
    """
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("DATABASE_PASSWORD_FILE", raising=False)
