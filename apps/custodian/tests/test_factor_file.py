import hashlib
import shutil
import threading
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from custodian.factor_file import (
    FIXTURE_PIN_PATH,
    PIN_PATH,
    FactorFileDownloadFailed,
    FactorFileMismatch,
    FactorReturns,
    Pin,
    factor_file,
    read_factor_file,
    read_pin,
)
from custodian.money import Rate

FIXTURE = FIXTURE_PIN_PATH.parent


def fixture_bytes(pin: Pin) -> bytes:
    return (FIXTURE / f"{pin.sha256}.zip").read_bytes()


@dataclass
class Archive:
    """A local stand-in for the Wayback Machine: serves `body` and counts the requests."""

    body: bytes
    url: str = ""
    requests: list[str] = field(default_factory=list[str])
    cut_after: int | None = None
    """When set, promises the whole body but sends only this many bytes, then hangs up."""


@contextmanager
def archive_serving(body: bytes) -> Generator[Archive]:
    archive = Archive(body)

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            archive.requests.append(self.path)
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Length", str(len(archive.body)))
            self.end_headers()
            self.wfile.write(archive.body[: archive.cut_after])

        def log_message(self, format: str, *args: object) -> None:
            pass  # keep the test output quiet (the base class logs every request)

    # Port 0: the system picks a free one.
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    archive.url = f"http://127.0.0.1:{server.server_port}/factor-file.zip"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield archive
    finally:
        server.shutdown()
        server.server_close()


def test_a_cached_file_is_returned_without_a_request(tmp_path: Path) -> None:
    pin = read_pin(FIXTURE_PIN_PATH)
    shutil.copy(FIXTURE / f"{pin.sha256}.zip", tmp_path)

    # The fixture Pin's address is a closed port: a request would fail the test.
    path = factor_file(pin, cache=tmp_path)

    assert path == tmp_path / f"{pin.sha256}.zip"


def test_an_empty_cache_downloads_once_from_the_archived_address(tmp_path: Path) -> None:
    fixture_pin = read_pin(FIXTURE_PIN_PATH)
    with archive_serving(fixture_bytes(fixture_pin)) as archive:
        pin = fixture_pin.model_copy(update={"archived_url": archive.url})

        first = factor_file(pin, cache=tmp_path)
        second = factor_file(pin, cache=tmp_path)

    assert archive.requests == ["/factor-file.zip"]
    assert first == second == tmp_path / f"{pin.sha256}.zip"
    assert first.read_bytes() == fixture_bytes(pin)


def test_a_wrong_file_from_the_archive_is_refused_and_not_cached(tmp_path: Path) -> None:
    fixture_pin = read_pin(FIXTURE_PIN_PATH)
    wrong = b"not the pinned file"
    with archive_serving(wrong) as archive:
        pin = fixture_pin.model_copy(update={"archived_url": archive.url})

        with pytest.raises(FactorFileMismatch) as caught:
            factor_file(pin, cache=tmp_path)

    message = str(caught.value)
    assert pin.sha256 in message
    assert hashlib.sha256(wrong).hexdigest() in message
    assert list(tmp_path.iterdir()) == []


def test_a_cached_file_that_differs_from_the_pin_is_refused(tmp_path: Path) -> None:
    pin = read_pin(FIXTURE_PIN_PATH)
    changed = fixture_bytes(pin) + b"\0"
    (tmp_path / f"{pin.sha256}.zip").write_bytes(changed)

    with pytest.raises(FactorFileMismatch) as caught:
        factor_file(pin, cache=tmp_path)

    message = str(caught.value)
    assert pin.sha256 in message
    assert hashlib.sha256(changed).hexdigest() in message


def test_no_network_with_an_empty_cache_is_a_failed_download(tmp_path: Path) -> None:
    # The fixture Pin's address is a closed port, as good as no network.
    pin = read_pin(FIXTURE_PIN_PATH)

    with pytest.raises(FactorFileDownloadFailed, match=r"127\.0\.0\.1:9"):
        factor_file(pin, cache=tmp_path)

    assert list(tmp_path.iterdir()) == []


def test_an_interrupted_download_leaves_nothing_in_the_cache(tmp_path: Path) -> None:
    fixture_pin = read_pin(FIXTURE_PIN_PATH)
    with archive_serving(fixture_bytes(fixture_pin)) as archive:
        archive.cut_after = len(archive.body) // 2
        pin = fixture_pin.model_copy(update={"archived_url": archive.url})

        with pytest.raises(FactorFileDownloadFailed):
            factor_file(pin, cache=tmp_path)

    assert list(tmp_path.iterdir()) == []


def test_the_reader_gives_each_day_as_fractions_and_the_last_date() -> None:
    pin = read_pin(FIXTURE_PIN_PATH)

    factors = read_factor_file(FIXTURE / f"{pin.sha256}.zip")

    assert factors.crsp_month == pin.crsp_month == "202602"
    assert factors.last_date == pin.ends_on == date(2026, 2, 27)
    assert len(factors.days) == 9
    # The file's first row: 20260217,    0.41,   -0.12,    0.08,   0.016 (percent).
    assert factors.days[0] == FactorReturns(
        day=date(2026, 2, 17),
        mkt_rf=Rate("0.0041"),
        smb=Rate("-0.0012"),
        hml=Rate("0.0008"),
        rf=Rate("0.00016"),
    )


def test_the_real_pin_names_an_archived_copy_without_downloading_it() -> None:
    pin = read_pin(PIN_PATH)

    assert pin.archived_url.startswith("https://web.archive.org/web/")
    assert pin.archived_url.endswith(f"id_/{pin.original_url}")
    assert pin.crsp_month == "202608"
    assert pin.ends_on == date(2026, 8, 31)
    assert len(pin.sha256) == 64
