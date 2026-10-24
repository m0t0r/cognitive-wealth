"""Alembic runs this for every command. It connects as the `migrator` role and runs migrations.

From the command line (`pnpm --filter custodian db:migrate`) it connects with DATABASE_URL and
DATABASE_PASSWORD_FILE. Tests pass a connection of their own in `config.attributes`.
"""

import logging

from alembic import context
from sqlalchemy import Connection

from custodian.database import engine_from_env
from custodian.models import Base


def run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=Base.metadata)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    raise SystemExit("Offline (--sql) mode isn't supported: run migrations against a database.")

given: object = context.config.attributes.get("connection")
if isinstance(given, Connection):
    run_migrations(given)
else:
    # Print "Running upgrade … -> …" for each migration, as `alembic.ini` would configure.
    logging.basicConfig(format="%(message)s")
    logging.getLogger("alembic").setLevel(logging.INFO)
    engine = engine_from_env()
    try:
        with engine.connect() as connection:
            run_migrations(connection)
    finally:
        engine.dispose()
