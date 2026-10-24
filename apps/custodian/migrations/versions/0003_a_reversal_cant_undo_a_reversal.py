"""A Reversal can't undo a Reversal: a wrong Reversal is fixed with a new Transaction (ADR 0016).

Settled cash takes a Reversal's direction from the row it names, which only works one level deep.
A check constraint sees only its own row, so a trigger looks up the row being undone.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-24
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # `using errcode = 'check_violation'` makes it fail like a check constraint, so the driver
    # raises an IntegrityError. It runs as the inserting role, and `app` can read the Ledger.
    op.execute("""
        create function transaction_reverses_no_reversal() returns trigger
        language plpgsql as $$
        begin
            if exists (
                select from "transaction" where id = new.reverses_id and kind = 'reversal'
            ) then
                raise exception 'transaction_reverses_no_reversal: transaction % is a Reversal,'
                    ' which can''t be undone; fix it with a new Transaction', new.reverses_id
                    using errcode = 'check_violation';
            end if;
            return new;
        end
        $$
    """)
    op.execute("""
        create trigger reverses_no_reversal
        before insert or update of reverses_id on "transaction"
        for each row when (new.reverses_id is not null)
        execute function transaction_reverses_no_reversal()
    """)


def downgrade() -> None:
    op.execute('drop trigger reverses_no_reversal on "transaction"')
    op.execute("drop function transaction_reverses_no_reversal()")
