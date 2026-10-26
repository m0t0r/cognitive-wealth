from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from custodian.factor_file import FIXTURE_PIN_PATH, FactorFileMismatch, read_pin
from custodian.main import app


def test_the_api_starts_with_the_pinned_factor_file() -> None:
    # tests/conftest.py points the Factor file at the fixture Pin, already in its cache.
    # `with` runs the app's start-up, as Uvicorn does; a bare TestClient(app) skips it.
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200


def test_the_api_refuses_to_start_when_the_cached_factor_file_differs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pin = read_pin(FIXTURE_PIN_PATH)
    (tmp_path / f"{pin.sha256}.zip").write_bytes(b"something else")
    monkeypatch.setenv("FACTOR_FILE_CACHE", str(tmp_path))

    with pytest.raises(FactorFileMismatch, match=pin.sha256), TestClient(app):
        pass
