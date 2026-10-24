from pathlib import Path

import pytest

from custodian.database import database_url, engine_from_env


@pytest.mark.parametrize("scheme", ["postgres", "postgresql", "postgresql+psycopg"])
def test_a_postgres_url_connects_through_psycopg(scheme: str) -> None:
    url = database_url({"DATABASE_URL": f"{scheme}://app@localhost:5434/custodian"})

    assert url.render_as_string() == "postgresql+psycopg://app@localhost:5434/custodian"


def test_the_password_file_sets_the_password(tmp_path: Path) -> None:
    password_file = tmp_path / "password"
    password_file.write_text("s3cret\n")  # as `openssl rand -hex 32 >` writes it, with a newline

    url = database_url(
        {
            "DATABASE_URL": "postgres://app:ignored@localhost:5434/custodian",
            "DATABASE_PASSWORD_FILE": str(password_file),
        }
    )

    assert url.password == "s3cret"


def test_without_a_url_it_says_which_variable_is_missing() -> None:
    with pytest.raises(LookupError, match="DATABASE_URL is not set"):
        database_url({})


def test_tests_never_see_a_database_url_from_the_shell() -> None:
    # tests/conftest.py unsets it, so nothing here can reach the dev database by accident.
    with pytest.raises(LookupError, match="DATABASE_URL is not set"):
        engine_from_env()


def test_another_database_is_refused() -> None:
    with pytest.raises(ValueError, match="must be a postgres:// URL, not mysql://"):
        database_url({"DATABASE_URL": "mysql://app@localhost/custodian"})
