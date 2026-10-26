"""The Factor file: one pinned copy of the library's daily three-factor file, cached and checked.

The Pin (`market/factor-file.pin.json`) names a permanent copy in the Wayback Machine and its
SHA-256. The library replaces the file at its own address every month, so the custodian never
reads that address: a fresh clone downloads exactly the bytes the Pin names, or refuses.
"""

import hashlib
import http.client
import os
import re
import tempfile
import urllib.request
import zipfile
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from custodian.money import Rate

__all__ = [
    "FIXTURE_PIN_PATH",
    "PIN_PATH",
    "FactorFile",
    "FactorFileDownloadFailed",
    "FactorFileError",
    "FactorFileMismatch",
    "FactorReturns",
    "Pin",
    "factor_file",
    "read_factor_file",
    "read_pin",
]

_CUSTODIAN = Path(__file__).parents[2]

PIN_PATH = _CUSTODIAN / "market" / "factor-file.pin.json"
"""The world's Pin. Moving it is a deliberate rebuild of the world (ADR 0019)."""

FIXTURE_PIN_PATH = _CUSTODIAN / "fixtures" / "factor-file" / "pin.json"
"""The tests' Pin, of a made-up file in the library's format. Its folder is laid out as a cache,
with the file under its SHA-256, so it can serve as one without a download."""


class Pin(BaseModel):
    """Which copy of the Factor file the world is built from."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    archived_url: str
    """The permanent copy the custodian downloads: the Wayback Machine's raw bytes (`id_`)."""
    original_url: str
    """The library's own address, for reference. Never fetched: its contents change monthly."""
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    """The downloaded zip's SHA-256, in hex."""
    crsp_month: str = Field(pattern=r"^\d{6}$")
    """The month of CRSP data the file says it was built from, as it prints it: `202608`."""
    ends_on: date
    """The file's last date, the end of real history for every market input."""


def read_pin(path: Path) -> Pin:
    return Pin.model_validate_json(path.read_bytes())


class FactorFileError(Exception):
    """The Factor file the Pin names can't be had, so nothing that needs market data may start."""


class FactorFileMismatch(FactorFileError):
    """A file's SHA-256 isn't the Pin's: it's a different file, whatever its name says."""

    def __init__(self, *, source: str, expected: str, actual: str) -> None:
        super().__init__(
            f"The Factor file from {source} isn't the pinned one:"
            f" its SHA-256 is {actual}, the Pin's is {expected}"
        )


class FactorFileDownloadFailed(FactorFileError):
    """The cache has no copy and the archived address didn't give one."""


def factor_file(pin: Pin, *, cache: Path) -> Path:
    """The path of the verified Factor file `pin` names, downloading it into `cache` if missing.

    The file is cached under its SHA-256, so a name only ever holds those bytes and one cache can
    serve every checkout on the machine. A cached copy is still hashed on every call: a file
    changed on disk is refused, not trusted for its name.
    """
    path = cache / f"{pin.sha256}.zip"
    if path.exists():
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != pin.sha256:
            raise FactorFileMismatch(source=str(path), expected=pin.sha256, actual=actual)
        return path
    _download(pin, path)
    return path


_CHUNK = 64 * 1024


def _download(pin: Pin, path: Path) -> None:
    """Download into a temporary file beside `path`, and move it there only once it's verified.

    The move is a rename within one folder, so `path` either doesn't exist or holds the whole
    verified file: an interrupted or wrong download never leaves anything under its name.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    # delete=False: the file outlives the `with`, so it can be renamed; `finally` removes it if not.
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".partial-", delete=False) as partial:
        partial_path = Path(partial.name)
    try:
        digest = hashlib.sha256()
        try:
            with (
                urllib.request.urlopen(pin.archived_url, timeout=60) as response,
                partial_path.open("wb") as out,
            ):
                while chunk := response.read(_CHUNK):
                    digest.update(chunk)
                    out.write(chunk)
                # `read(n)` returns b"" when the server hangs up early, as if the file had ended;
                # `length` is how much of the promised Content-Length never came.
                if response.length:
                    raise http.client.IncompleteRead(b"", response.length)
        # OSError covers no network, a refused connection, a timeout and an HTTP error status;
        # HTTPException covers a connection closed before the promised length (IncompleteRead).
        except (OSError, http.client.HTTPException) as error:
            raise FactorFileDownloadFailed(
                f"The cache has no Factor file and {pin.archived_url} didn't give one: {error!r}"
            ) from None
        actual = digest.hexdigest()
        if actual != pin.sha256:
            raise FactorFileMismatch(source=pin.archived_url, expected=pin.sha256, actual=actual)
        os.replace(partial_path, path)
    finally:
        # Ctrl-C included: after a successful replace the partial file is already gone.
        partial_path.unlink(missing_ok=True)


@dataclass(frozen=True)
class FactorReturns:
    """One Business day's Factor returns, each a fraction (a `Rate`, ADR 0013).

    The file publishes percents: its `0.41` is `Rate("0.0041")`, divided by 100 exactly.
    """

    day: date
    mkt_rf: Rate
    """How much more the whole US market returned than `rf`."""
    smb: Rate
    """Small companies' return minus big ones'."""
    hml: Rate
    """Value companies' return minus growth ones'."""
    rf: Rate
    """The one-month Treasury bill's return for the day, the risk-free rate."""


@dataclass(frozen=True)
class FactorFile:
    crsp_month: str
    """The month of CRSP data the file was built from, as it prints it: `202608`."""
    days: Sequence[FactorReturns]
    """Every row, oldest first."""

    @property
    def last_date(self) -> date:
        """The end of real history: after it, #46 resamples."""
        return self.days[-1].day


_CRSP_MONTH = re.compile(r"created by using the (\d{6}) CRSP database")
_HEADER = ["", "Mkt-RF", "SMB", "HML", "RF"]
_ROW = re.compile(r"^\d{8},")


def read_factor_file(path: Path) -> FactorFile:
    """The daily rows of the zipped Factor file at `path`, skipping its notes and copyright lines.

    Call it with `factor_file()`'s result, so the bytes are the pinned ones.
    """
    with zipfile.ZipFile(path) as archive:
        [member] = archive.namelist()  # the library's zip holds just the one CSV
        text = archive.read(member).decode("ascii")
    lines = text.splitlines()  # splits on \r\n too, which the library writes

    if not (match := _CRSP_MONTH.search(text)):
        raise ValueError(f"{path} doesn't say which CRSP month it was built from")
    # The column header is the one line that starts with a comma: its first column, the date,
    # has no name.
    header = next((line for line in lines if line.startswith(",")), "")
    if [cell.strip() for cell in header.split(",")] != _HEADER:
        raise ValueError(f"{path} doesn't have the daily three-factor columns {_HEADER}")

    days: list[FactorReturns] = []
    for line in lines:
        if not _ROW.match(line):
            continue  # a note, the header, a blank line or the copyright
        day, mkt_rf, smb, hml, rf = (cell.strip() for cell in line.split(","))
        days.append(
            FactorReturns(
                day=datetime.strptime(day, "%Y%m%d").date(),
                mkt_rf=Rate.from_percent(mkt_rf),
                smb=Rate.from_percent(smb),
                hml=Rate.from_percent(hml),
                rf=Rate.from_percent(rf),
            )
        )
    if not days:
        raise ValueError(f"{path} has no daily rows")
    return FactorFile(crsp_month=match.group(1), days=tuple(days))
