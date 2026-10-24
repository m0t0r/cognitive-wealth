"""Reversals in the Ledger, and each Security's price for each Business day.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_KINDS = (
    "contribution",
    "withdrawal",
    "buy",
    "sell",
    "dividend",
    "interest",
    "fee",
    "transfer",
)


def _set_transaction_kinds(kinds: Sequence[str]) -> None:
    """Replace the transaction_kind type with one of exactly `kinds`.

    `alter type … add value` would be shorter, but Postgres won't let a value added that way be
    used, as the check constraint below uses it, until the migration's transaction commits.
    """
    op.execute("alter type transaction_kind rename to transaction_kind_old")
    sa.Enum(*kinds, name="transaction_kind").create(op.get_bind())
    op.execute(
        'alter table "transaction" alter column kind'
        " type transaction_kind using kind::text::transaction_kind"
    )
    op.execute("drop type transaction_kind_old")


def upgrade() -> None:
    _set_transaction_kinds((*_KINDS, "reversal"))
    op.add_column("transaction", sa.Column("reverses_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        "transaction_reverses_id_fkey", "transaction", "transaction", ["reverses_id"], ["id"]
    )
    op.create_unique_constraint("transaction_reverses_id_key", "transaction", ["reverses_id"])
    # op.f(): the name is final, so the models' naming convention doesn't prefix it again.
    op.create_check_constraint(
        op.f("transaction_reversal_names_what_it_undoes_check"),
        "transaction",
        "(kind = 'reversal') = (reverses_id is not null)",
    )

    op.create_table(
        "price",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), primary_key=True),
        sa.Column("security_id", sa.BigInteger(), nullable=False),
        sa.Column("price_date", sa.Date(), nullable=False),
        sa.Column("price", sa.Numeric(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="price_pkey"),
        sa.ForeignKeyConstraint(["security_id"], ["security.id"], name="price_security_id_fkey"),
        sa.UniqueConstraint("security_id", "price_date", name="price_security_id_price_date_key"),
        sa.CheckConstraint("price > 0", name="price_positive_check"),
    )

    # A Reversal is inserted like any other row, naming the one it undoes. Prices are append-only
    # like the Ledger: `app` reads them and inserts them, and the database sets `id`.
    op.execute('grant insert (reverses_id) on table "transaction" to app')
    op.execute("grant select, insert (security_id, price_date, price) on table price to app")


def downgrade() -> None:
    op.drop_table("price")
    op.drop_constraint("transaction_reversal_names_what_it_undoes_check", "transaction")
    op.drop_column("transaction", "reverses_id")
    _set_transaction_kinds(_KINDS)
