"""Connecting to the custodian's Postgres, configured like Cognitive Wealth's (`@repo/db`).

`DATABASE_URL` names the server, database and role, and `DATABASE_PASSWORD_FILE`, when set, holds
the password, so a secret never has to sit in an environment variable.
"""

import os
from collections.abc import Mapping
from pathlib import Path

from sqlalchemy import URL, Engine, create_engine, make_url

__all__ = ["NoDatabase", "database_url", "engine_from_env"]


class NoDatabase(LookupError):
    """`DATABASE_URL` isn't set, so there's no database to connect to."""


def database_url(environ: Mapping[str, str]) -> URL:
    """The URL from `environ`, with psycopg as the driver and the password file's password."""
    raw = environ.get("DATABASE_URL")
    if not raw:
        raise NoDatabase("DATABASE_URL is not set")
    url = make_url(raw)
    # `postgres://` is the form the rest of the repo uses; SQLAlchemy only knows `postgresql://`.
    if url.get_backend_name() not in ("postgres", "postgresql"):
        raise ValueError(f"DATABASE_URL must be a postgres:// URL, not {url.drivername}://")
    url = url.set(drivername="postgresql+psycopg")
    password_file = environ.get("DATABASE_PASSWORD_FILE")
    if password_file:
        url = url.set(password=Path(password_file).read_text().strip())
    return url


def engine_from_env(environ: Mapping[str, str] = os.environ) -> Engine:
    return create_engine(database_url(environ))
