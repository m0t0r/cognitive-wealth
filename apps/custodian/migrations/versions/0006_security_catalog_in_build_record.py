"""The build record keeps the Security catalog's SHA-256 too (ADR 0019, #183).

A database recorded before this has no catalog hash, and its Securities came from the ledger
fixture, not the catalog. Its row gets an empty hash, which matches no catalog, so the API and
`world:load` refuse it until it's rebuilt from empty, as for any other changed input.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # The default only fills an existing row; dropped at once, so every new row names its hash.
    op.add_column(
        "build_record",
        sa.Column("security_catalog_sha256", sa.String(), server_default="", nullable=False),
    )
    op.alter_column("build_record", "security_catalog_sha256", server_default=None)
    op.execute("grant insert (security_catalog_sha256) on table build_record to app")


def downgrade() -> None:
    op.drop_column("build_record", "security_catalog_sha256")
