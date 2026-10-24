"""Each Transaction's public ID, the Custodian's own, which the feed publishes (ADR 0017).

`id` stays inside the custodian (ADR 0003). `transaction_id` is set by whoever records the row,
with no default: a random one would give a rebuilt world new IDs, so the same day's Delivery would
come out as different bytes and look like a Restatement.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("transaction", sa.Column("transaction_id", sa.String(), nullable=True))
    # Rows already loaded get the ID `world:load` gives them now: the ledger fixture numbers its
    # rows as an empty database numbers their `id`s, so row 3 becomes TX-000000003. A database
    # loaded any other way is rebuilt from empty instead.
    op.execute("update \"transaction\" set transaction_id = 'TX-' || lpad(id::text, 9, '0')")
    op.alter_column("transaction", "transaction_id", nullable=False)
    op.create_unique_constraint("transaction_transaction_id_key", "transaction", ["transaction_id"])
    # Inserted with the row, like its other data columns; still never changed (append-only).
    op.execute('grant insert (transaction_id) on table "transaction" to app')


def downgrade() -> None:
    op.drop_column("transaction", "transaction_id")
