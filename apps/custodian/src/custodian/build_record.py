"""Which market inputs built the custodian's database, and the check that they still do.

Everything the custodian stores about the market (prices, from #46) is worked out from the Factor
file, the Treasury yields and the Security catalog. If the Pin moved and the database kept its old
rows, one history would mix two worlds' prices. So the first load records each input's SHA-256,
and from then on the API and every command that needs market data refuse a database built from
other inputs: it must be rebuilt from empty (ADR 0019).
"""

import hashlib
import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from custodian.factor_file import PIN_PATH, factor_file, read_pin
from custodian.models import BuildRecord
from custodian.security_catalog import SECURITY_CATALOG_PATH
from custodian.treasury_yields import TREASURY_YIELDS_PATH

__all__ = [
    "BuildMismatch",
    "MarketInputs",
    "check_build",
    "factor_file_cache",
    "market_inputs",
    "record_build",
]


class BuildMismatch(Exception):
    """The database was built from other market inputs than the committed ones."""


@dataclass(frozen=True)
class MarketInputs:
    """The SHA-256 of each market input the world is built from, and the Factor file's CRSP month.

    Two builds are the same when their hashes are. The CRSP month is only there for a person to
    read in a refusal: the file's SHA-256 already decides it, so it's left out of `==`.
    """

    factor_file_sha256: str
    treasury_yields_sha256: str
    security_catalog_sha256: str
    factor_file_crsp_month: str = field(compare=False)


def factor_file_cache(environ: Mapping[str, str]) -> Path:
    """Where Factor files are cached: one folder per machine, shared by every checkout.

    `FACTOR_FILE_CACHE` overrides it (Compose points it at a volume). Otherwise it's the user's
    cache folder, as other tools keep theirs: `$XDG_CACHE_HOME`, or `~/.cache`.
    """
    if override := environ.get("FACTOR_FILE_CACHE"):
        return Path(override)
    base = environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(base) / "cognitive-wealth" / "factor-files"


def market_inputs(environ: Mapping[str, str] = os.environ) -> MarketInputs:
    """The committed inputs, after getting the verified Factor file, or raising why not.

    `FACTOR_FILE_PIN` names another Pin file: the tests' and `cw verify compose up`'s fixture, which needs
    no network. Everything else uses the world's.
    """
    pin = read_pin(Path(environ.get("FACTOR_FILE_PIN") or PIN_PATH))
    factor_file(pin, cache=factor_file_cache(environ))
    return MarketInputs(
        factor_file_sha256=pin.sha256,
        factor_file_crsp_month=pin.crsp_month,
        treasury_yields_sha256=_sha256(TREASURY_YIELDS_PATH),
        security_catalog_sha256=_sha256(SECURITY_CATALOG_PATH),
    )


def record_build(session: Session, inputs: MarketInputs) -> None:
    """Write the record into a database that has none, or check the one that's there."""
    with session.begin():
        if _recorded(session) is None:
            session.add(
                BuildRecord(
                    factor_file_sha256=inputs.factor_file_sha256,
                    factor_file_crsp_month=inputs.factor_file_crsp_month,
                    treasury_yields_sha256=inputs.treasury_yields_sha256,
                    security_catalog_sha256=inputs.security_catalog_sha256,
                )
            )
    check_build(session, inputs)


def check_build(session: Session, inputs: MarketInputs) -> None:
    """Refuse a database built from other inputs. One with no record yet has nothing to refuse."""
    with session.begin():
        recorded = _recorded(session)
    if recorded is None or recorded == inputs:
        return
    differences = [
        f"the {name} was {built} and is now {now}"
        for name, built, now in (
            ("Factor file", _factor_file(recorded), _factor_file(inputs)),
            ("Treasury yields", recorded.treasury_yields_sha256, inputs.treasury_yields_sha256),
            (
                "Security catalog",
                # Empty in a database built before the catalog was recorded (migration 0006).
                recorded.security_catalog_sha256 or "not recorded",
                inputs.security_catalog_sha256,
            ),
        )
        if built != now
    ]
    raise BuildMismatch(
        "The custodian's database was built from other market inputs ("
        + "; ".join(differences)
        + "), so it must be rebuilt from an empty database"
    )


def _recorded(session: Session) -> MarketInputs | None:
    record = session.scalars(select(BuildRecord)).one_or_none()
    if record is None:
        return None
    return MarketInputs(
        factor_file_sha256=record.factor_file_sha256,
        factor_file_crsp_month=record.factor_file_crsp_month,
        treasury_yields_sha256=record.treasury_yields_sha256,
        security_catalog_sha256=record.security_catalog_sha256,
    )


def _factor_file(inputs: MarketInputs) -> str:
    return f"the {inputs.factor_file_crsp_month} CRSP file ({inputs.factor_file_sha256})"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()
