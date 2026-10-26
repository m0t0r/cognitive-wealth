"""Fixtures for every test under tests/. pytest finds this file by name; tests don't import it."""

import pytest

from custodian.factor_file import FIXTURE_PIN_PATH


@pytest.fixture(autouse=True)
def no_database_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """Unset the shell's DATABASE_URL and DATABASE_PASSWORD_FILE for every test (`autouse=True`).

    They may point at the dev database. A test reaches Postgres only through the fixtures in
    tests/integration/, so code that reads the environment by mistake fails instead of writing
    to real data. `monkeypatch` puts them back after the test.
    """
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("DATABASE_PASSWORD_FILE", raising=False)


@pytest.fixture(autouse=True)
def the_fixture_factor_file(monkeypatch: pytest.MonkeyPatch) -> None:
    """Point every test, and any command it runs, at the fixture Pin and its folder as the cache.

    The fixture is already in that folder under its SHA-256, so getting it is a cache hit and no
    test downloads anything or reads the machine's real cache. A test that needs a download or a
    miss passes its own Pin and cache to `factor_file()`.
    """
    monkeypatch.setenv("FACTOR_FILE_PIN", str(FIXTURE_PIN_PATH))
    monkeypatch.setenv("FACTOR_FILE_CACHE", str(FIXTURE_PIN_PATH.parent))
