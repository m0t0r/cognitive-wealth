from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from custodian.build_record import BuildMismatch, MarketInputs, check_build, record_build
from custodian.main import app
from tests.integration.postgres import Database, PostgresServer

BUILT = MarketInputs(
    factor_file_sha256="a" * 64,
    factor_file_crsp_month="202602",
    treasury_yields_sha256="b" * 64,
    security_catalog_sha256="e" * 64,
)


def test_the_first_load_into_an_empty_database_writes_the_record(session: Session) -> None:
    record_build(session, BUILT)

    # The same inputs again: what every later load and start-up does.
    record_build(session, BUILT)
    check_build(session, BUILT)


def test_a_database_built_with_one_pin_is_refused_after_the_pin_moves(session: Session) -> None:
    record_build(session, BUILT)
    moved = replace(BUILT, factor_file_sha256="c" * 64, factor_file_crsp_month="202608")

    with pytest.raises(BuildMismatch, match="rebuilt") as caught:
        record_build(session, moved)
    # Both CRSP months, which a person can read, and both hashes, which decide.
    assert f"the 202602 CRSP file ({'a' * 64})" in str(caught.value)
    assert f"the 202608 CRSP file ({'c' * 64})" in str(caught.value)
    with pytest.raises(BuildMismatch):
        check_build(session, moved)


def test_the_crsp_month_is_shown_but_never_compared(session: Session) -> None:
    # The file's SHA-256 already decides its CRSP month, so the month alone can't refuse.
    record_build(session, BUILT)

    check_build(session, replace(BUILT, factor_file_crsp_month="202608"))


def test_changed_yields_are_refused_too(session: Session) -> None:
    record_build(session, BUILT)

    with pytest.raises(BuildMismatch, match="Treasury yields"):
        check_build(session, replace(BUILT, treasury_yields_sha256="d" * 64))


def test_a_changed_security_catalog_is_refused_too(session: Session) -> None:
    record_build(session, BUILT)

    with pytest.raises(BuildMismatch, match=f"the Security catalog was {'e' * 64} and is now"):
        check_build(session, replace(BUILT, security_catalog_sha256="f" * 64))


def test_the_api_refuses_to_start_on_a_database_built_from_other_inputs(
    postgres_server: PostgresServer,
    database: Database,
    session: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # tests/conftest.py already points the Factor file at the fixture Pin and its cache.
    record_build(session, BUILT)
    password_file = tmp_path / "custodian_db_app_password"
    password_file.write_text(postgres_server.app_password)
    url = postgres_server.url_for(database.name, "app").set(drivername="postgres", password=None)
    monkeypatch.setenv("DATABASE_URL", url.render_as_string(hide_password=False))
    monkeypatch.setenv("DATABASE_PASSWORD_FILE", str(password_file))

    # `with` runs the app's start-up, as Uvicorn does; a bare TestClient(app) skips it.
    with pytest.raises(BuildMismatch), TestClient(app):
        pass
