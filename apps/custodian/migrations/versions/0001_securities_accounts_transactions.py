"""Securities, Accounts and the append-only Transactions of the Ledger.

Revision ID: 0001
Revises:
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# create_type=False: each enum type is created and dropped once, explicitly, below.
security_kind = postgresql.ENUM(
    "stock", "fund", "bond", "cash_sweep", name="security_kind", create_type=False
)
registration_type = postgresql.ENUM(
    "individual",
    "joint",
    "traditional_ira",
    "roth_ira",
    "custodial",
    "529",
    name="registration_type",
    create_type=False,
)
transaction_kind = postgresql.ENUM(
    "contribution",
    "withdrawal",
    "buy",
    "sell",
    "dividend",
    "interest",
    "fee",
    "transfer",
    name="transaction_kind",
    create_type=False,
)


def _id() -> sa.Column[int]:
    return sa.Column("id", sa.BigInteger(), sa.Identity(always=True), primary_key=True)


def upgrade() -> None:
    bind = op.get_bind()
    for enum in (security_kind, registration_type, transaction_kind):
        enum.create(bind)

    op.create_table(
        "security",
        _id(),
        sa.Column("identifier", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column[str]("kind", security_kind, nullable=False),
        sa.PrimaryKeyConstraint("id", name="security_pkey"),
        sa.UniqueConstraint("identifier", name="security_identifier_key"),
    )
    op.create_table(
        "account",
        _id(),
        sa.Column("account_number", sa.String(), nullable=False),
        sa.Column[str]("registration_type", registration_type, nullable=False),
        sa.Column("opened_on", sa.Date(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="account_pkey"),
        sa.UniqueConstraint("account_number", name="account_account_number_key"),
    )
    op.create_table(
        "transaction",
        _id(),
        sa.Column("account_id", sa.BigInteger(), nullable=False),
        sa.Column("security_id", sa.BigInteger(), nullable=True),
        sa.Column[str]("kind", transaction_kind, nullable=False),
        sa.Column("trade_date", sa.Date(), nullable=False),
        sa.Column("settlement_date", sa.Date(), nullable=False),
        sa.Column("shares", sa.Numeric(19, 6), nullable=True),
        sa.Column("amount", sa.Numeric(19, 2), nullable=False),
        sa.Column(
            "recorded_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.clock_timestamp(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="transaction_pkey"),
        sa.ForeignKeyConstraint(["account_id"], ["account.id"], name="transaction_account_id_fkey"),
        sa.ForeignKeyConstraint(
            ["security_id"], ["security.id"], name="transaction_security_id_fkey"
        ),
        sa.CheckConstraint(
            "settlement_date >= trade_date", name="transaction_settles_after_trade_check"
        ),
        sa.CheckConstraint(
            "shares is null or security_id is not null",
            name="transaction_shares_of_a_security_check",
        ),
    )
    op.create_index(
        "transaction_account_id_trade_date_idx", "transaction", ["account_id", "trade_date"]
    )

    # `app` starts with no access to a new table (docker/initdb/01-roles.sh), so each is granted
    # here. The Ledger is append-only: `app` reads Transactions and inserts them, naming only the
    # data columns, so the database sets `id` and `recorded_at`, and nothing can change a row.
    op.execute("grant select, insert, update, delete on table security, account to app")
    op.execute(
        "grant select, insert (account_id, security_id, kind, trade_date, settlement_date,"
        ' shares, amount) on table "transaction" to app'
    )


def downgrade() -> None:
    op.drop_table("transaction")
    op.drop_table("account")
    op.drop_table("security")
    bind = op.get_bind()
    for enum in (transaction_kind, registration_type, security_kind):
        enum.drop(bind)
