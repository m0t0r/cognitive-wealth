from datetime import UTC, date, datetime

import pytest
from sqlalchemy import delete, func, insert, select, text, update
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

from custodian.models import (
    Account,
    RegistrationType,
    SecurityPrice,
    Transaction,
    TransactionKind,
)
from custodian.money import Money, Price
from tests.integration.examples import a_transaction_id, bond_fund, danas_account
from tests.integration.postgres import Database


def record_a_contribution(session: Session) -> None:
    session.add(
        Transaction(
            transaction_id=a_transaction_id(),
            account=danas_account(),
            kind=TransactionKind.CONTRIBUTION,
            trade_date=date(2026, 2, 26),
            posting_date=date(2026, 2, 26),
            settlement_date=date(2026, 2, 26),
            amount=Money("5000.00"),
        )
    )
    session.commit()


def test_the_app_can_record_and_read_transactions(session: Session) -> None:
    record_a_contribution(session)

    assert session.scalars(select(Transaction.amount)).all() == [Money("5000.00")]


def test_the_app_cant_change_a_transaction(session: Session) -> None:
    record_a_contribution(session)

    # `match` checks the message: Postgres refused it for lack of privilege, not for another reason.
    with pytest.raises(ProgrammingError, match="permission denied for table transaction"):
        session.execute(update(Transaction).values(amount=Money("5500.00")))


def test_the_app_cant_delete_a_transaction(session: Session) -> None:
    record_a_contribution(session)

    with pytest.raises(ProgrammingError, match="permission denied for table transaction"):
        session.execute(delete(Transaction))


def test_the_app_cant_choose_when_a_transaction_was_recorded(session: Session) -> None:
    record_a_contribution(session)
    account_id = session.scalars(select(Account.id)).one()

    with pytest.raises(ProgrammingError, match="permission denied for table transaction"):
        session.execute(
            insert(Transaction).values(
                account_id=account_id,
                kind=TransactionKind.CONTRIBUTION,
                trade_date=date(2026, 2, 26),
                posting_date=date(2026, 2, 26),
                settlement_date=date(2026, 2, 26),
                amount=Money("1.00"),
                recorded_at=datetime(2020, 1, 1, tzinfo=UTC),
            )
        )


def test_the_app_cant_change_a_price(session: Session) -> None:
    session.add(
        SecurityPrice(security=bond_fund(), price_date=date(2026, 3, 6), price=Price("10.02"))
    )
    session.commit()

    with pytest.raises(ProgrammingError, match="permission denied for table price"):
        session.execute(update(SecurityPrice).values(price=Price("10.03")))


def test_the_app_can_still_change_accounts(session: Session) -> None:
    record_a_contribution(session)

    session.execute(update(Account).values(registration_type=RegistrationType.JOINT))
    session.commit()

    assert session.scalars(select(Account.registration_type)).all() == [RegistrationType.JOINT]


def test_the_migrator_role_isnt_limited_to_appending(database: Database) -> None:
    # Only the app is limited: a migration may still need to rewrite rows.
    with Session(database.app) as session:
        record_a_contribution(session)

    with Session(database.migrator) as session:
        session.execute(delete(Transaction))
        session.commit()
        assert session.scalar(select(func.count()).select_from(Transaction)) == 0


def test_the_app_has_only_the_access_each_table_grants(database: Database) -> None:
    # Every table is listed, so a new one fails here until its migration grants `app` what it
    # needs: `app` has no default privileges (docker/initdb/01-roles.sh).
    with database.migrator.connect() as connection:
        on_tables = connection.execute(
            text("""
                select table_name, privilege_type from information_schema.table_privileges
                where grantee = 'app' and table_schema = 'public'
            """)
        ).all()
        inserted_columns = connection.execute(
            text("""
                select table_name, column_name from information_schema.column_privileges
                where grantee = 'app' and table_name in ('transaction', 'price', 'build_record')
                  and privilege_type = 'INSERT'
            """)
        ).all()

    privileges: dict[str, set[str]] = {}
    for table, privilege in on_tables:
        privileges.setdefault(table, set()).add(privilege)
    assert privileges == {
        "security": {"SELECT", "INSERT", "UPDATE", "DELETE"},
        "account": {"SELECT", "INSERT", "UPDATE", "DELETE"},
        "transaction": {"SELECT"},
        "price": {"SELECT"},
        "build_record": {"SELECT"},
    }
    # Inserting names the data columns only: the database sets `id` and `recorded_at`.
    columns: dict[str, set[str]] = {}
    for table, column in inserted_columns:
        columns.setdefault(table, set()).add(column)
    assert columns == {
        "transaction": {
            "transaction_id",
            "account_id",
            "security_id",
            "kind",
            "reverses_id",
            "trade_date",
            "settlement_date",
            "posting_date",
            "shares",
            "amount",
        },
        "price": {"security_id", "price_date", "price"},
        "build_record": {
            "factor_file_sha256",
            "factor_file_crsp_month",
            "treasury_yields_sha256",
            "security_catalog_sha256",
        },
    }
