"""The build record: which market inputs built this database (ADR 0019).

One row, written by the first `world:load`, holding the Factor file's and the Treasury yields'
SHA-256, and the Factor file's CRSP month for people to read. A database that already has data
gets it on its next load: what it holds so far is the hand-written ledger fixture, which no market
input built.

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "build_record",
        sa.Column("singleton", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("factor_file_sha256", sa.String(), nullable=False),
        sa.Column("factor_file_crsp_month", sa.String(), nullable=False),
        sa.Column("treasury_yields_sha256", sa.String(), nullable=False),
        sa.Column(
            "recorded_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.clock_timestamp(),
            nullable=False,
        ),
        # op.f(): the name is final, so the models' naming convention doesn't prefix it again.
        sa.PrimaryKeyConstraint("singleton", name=op.f("build_record_pkey")),
        sa.CheckConstraint("singleton", name=op.f("build_record_one_row_check")),
    )
    # Written once and never changed, like the Ledger: a different build is a new database.
    op.execute(
        "grant select, insert (factor_file_sha256, factor_file_crsp_month, treasury_yields_sha256)"
        " on table build_record to app"
    )


def downgrade() -> None:
    op.drop_table("build_record")
