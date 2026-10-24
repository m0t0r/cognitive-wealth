"""The Custodian feed from the v0 ledger fixture, checked against docs/learn/03's Reyes Delivery.

Each test writes Deliveries into a LocalFeedStore under `tmp_path` and reads them back through
the FeedStore interface, as Ingestion (#40) will.
"""

import csv
import hashlib
import io
import json
from collections.abc import Generator, Iterator
from contextlib import contextmanager
from datetime import date, timedelta
from pathlib import Path

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session

from custodian.feed import write_delivery
from custodian.feed_store import FeedStore, LocalFeedStore
from custodian.ledger_fixture import LEDGER_V0_PATH, LedgerFixture, read_ledger_fixture
from custodian.load import load
from custodian.money import Shares
from custodian.positions import positions_as_of
from custodian.world import WORLD_V0_PATH, WorldFile, read_world
from tests.integration.postgres import CUSTODIAN, MIGRATED_DATABASE, Database, PostgresServer

MONDAY = date(2026, 3, 2)
FRIDAY = date(2026, 3, 6)
REPO = CUSTODIAN.parents[1]


def load_v0(session: Session) -> None:
    load(session, read_world(WORLD_V0_PATH), read_ledger_fixture(LEDGER_V0_PATH))


def days(first: date, last: date) -> Iterator[date]:
    """Every day from `first` to `last`, weekends too: the feed has no Business-day calendar yet."""
    day = first
    while day <= last:
        yield day
        day += timedelta(days=1)


# The fixture's week, and the Monday after it, when nothing more happens.
FIXTURE_DAYS = list(days(date(2026, 2, 26), date(2026, 3, 9)))


def rows_of(store: FeedStore, key: str) -> list[dict[str, str]]:
    """A CSV file's rows, read back through the store, keyed by the header row's names."""
    return list(csv.DictReader(io.StringIO(store.get(key).decode())))


def test_the_reyes_delivery_for_monday_2_march(
    session: Session, database: Database, tmp_path: Path
) -> None:
    # The primer's Part 3, file by file, with the real columns: rows 3, 4, 12 and 13 were
    # posted that Monday, and the Positions and prices are the Close of 2 March.
    load_v0(session)
    store = LocalFeedStore(tmp_path)

    write_delivery(database.app, store, MONDAY)

    assert store.list("2026-03-02/") == [
        "2026-03-02/accounts.csv",
        "2026-03-02/manifest.json",
        "2026-03-02/positions.csv",
        "2026-03-02/prices.csv",
        "2026-03-02/securities.csv",
        "2026-03-02/transactions.csv",
    ]
    assert store.get("2026-03-02/securities.csv") == (
        b"identifier,name,kind\n"
        b"LKBF,Larkspur Bond Fund,fund\n"
        b"LKSF,Larkspur Stock Fund,fund\n"
        b"SWEEP,Larkspur Bank Sweep,cash_sweep\n"
    )
    assert store.get("2026-03-02/accounts.csv") == (
        b"account_number,registration_type,opened_on\n"
        b"CW-000001,joint,2026-02-26\n"
        b"CW-000002,traditional_ira,2026-03-02\n"
    )
    assert store.get("2026-03-02/transactions.csv") == (
        b"transaction_id,account_number,kind,reverses,security,shares,amount,"
        b"trade_date,settlement_date,posting_date\n"
        b"TX-000000003,CW-000001,contribution,,,,10000.00,2026-03-02,2026-03-02,2026-03-02\n"
        b"TX-000000004,CW-000001,buy,,LKSF,40.000000,-6010.00,2026-03-02,2026-03-03,2026-03-02\n"
        b"TX-000000012,CW-000002,contribution,,,,6000.00,2026-03-02,2026-03-02,2026-03-02\n"
        b"TX-000000013,CW-000002,buy,,LKSF,20.000000,-3005.00,2026-03-02,2026-03-03,2026-03-02\n"
    )
    assert store.get("2026-03-02/positions.csv") == (
        b"account_number,security,shares,price,market_value\n"
        b"CW-000001,LKBF,300.000000,10.00,3000.00\n"
        b"CW-000001,LKSF,40.000000,150.25,6010.00\n"
        b"CW-000001,SWEEP,5990.000000,1.00,5990.00\n"
        b"CW-000002,LKSF,20.000000,150.25,3005.00\n"
        b"CW-000002,SWEEP,2995.000000,1.00,2995.00\n"
    )
    assert store.get("2026-03-02/prices.csv") == (
        b"security,price\nLKBF,10.00\nLKSF,150.25\nSWEEP,1.00\n"
    )


def test_the_manifest_lists_each_files_rows_and_content_hash(
    session: Session, database: Database, tmp_path: Path
) -> None:
    load_v0(session)
    store = LocalFeedStore(tmp_path)

    returned = write_delivery(database.app, store, MONDAY)

    manifest = json.loads(store.get("2026-03-02/manifest.json"))
    assert manifest["format_version"] == 1
    assert manifest["as_of_date"] == "2026-03-02"
    assert [(file["name"], file["rows"]) for file in manifest["files"]] == [
        ("accounts.csv", 2),
        ("positions.csv", 5),
        ("prices.csv", 3),
        ("securities.csv", 3),
        ("transactions.csv", 4),
    ]
    for file in manifest["files"]:
        content = store.get(f"2026-03-02/{file['name']}")
        assert file["sha256"] == hashlib.sha256(content).hexdigest()
        assert file["rows"] == content.count(b"\n") - 1  # not counting the header row
    assert returned.model_dump(mode="json") == manifest


def test_writing_a_day_again_gives_the_same_bytes(
    session: Session, database: Database, tmp_path: Path
) -> None:
    # So a Delivery sent again is a Redelivery, which Ingestion ignores, not a Restatement.
    load_v0(session)
    first, second = LocalFeedStore(tmp_path / "first"), LocalFeedStore(tmp_path / "second")

    for day in FIXTURE_DAYS:
        write_delivery(database.app, first, day)
        write_delivery(database.app, second, day)
        write_delivery(database.app, second, day)

    keys = first.list("")
    assert len(keys) == 6 * len(FIXTURE_DAYS)
    assert second.list("") == keys
    assert all(second.get(key) == first.get(key) for key in keys)


def test_a_world_rebuilt_in_another_order_gives_the_same_bytes(
    session: Session, database: Database, postgres_server: PostgresServer, tmp_path: Path
) -> None:
    # The second database is loaded with its Accounts and Securities the other way round, so
    # every `id` differs: the IRA's rows are numbered first. Nothing published depends on them.
    world = read_world(WORLD_V0_PATH)
    ledger = read_ledger_fixture(LEDGER_V0_PATH)
    load(session, world, ledger)
    reversed_world = world.model_copy(
        update={
            "custodian": world.custodian.model_copy(
                update={"accounts": world.custodian.accounts[::-1]}
            )
        }
    )
    reversed_ledger = ledger.model_copy(update={"securities": ledger.securities[::-1]})
    first, second = LocalFeedStore(tmp_path / "first"), LocalFeedStore(tmp_path / "second")

    with rebuilt(postgres_server, reversed_world, reversed_ledger) as other:
        for day in FIXTURE_DAYS:
            write_delivery(database.app, first, day)
            write_delivery(other, second, day)

    keys = first.list("")
    assert second.list("") == keys
    assert all(second.get(key) == first.get(key) for key in keys)


@contextmanager
def rebuilt(server: PostgresServer, world: WorldFile, ledger: LedgerFixture) -> Generator[Engine]:
    """A second migrated database holding `world` and `ledger`, dropped on leaving the `with`."""
    name = server.create_database(MIGRATED_DATABASE)
    engine = create_engine(server.url_for(name, "app"))
    try:
        with Session(engine) as session:
            load(session, world, ledger)
        yield engine
    finally:
        engine.dispose()
        server.drop_database(name)


def test_positions_agree_with_positions_as_of_for_every_account(
    session: Session, database: Database, tmp_path: Path
) -> None:
    load_v0(session)
    store = LocalFeedStore(tmp_path)

    for day in FIXTURE_DAYS:
        write_delivery(database.app, store, day)

        published: dict[str, dict[str, Shares]] = {}
        for row in rows_of(store, f"{day.isoformat()}/positions.csv"):
            published.setdefault(row["account_number"], {})[row["security"]] = Shares(row["shares"])
        open_accounts = [row["account_number"] for row in rows_of(store, f"{day}/accounts.csv")]
        for number in open_accounts:
            # Known on the day itself: a Correction posted later changes only later Deliveries.
            assert published.get(number, {}) == positions_as_of(session, number, day, known_on=day)
        assert set(published) <= set(open_accounts)
        session.rollback()  # end the read, so the next day's sees the database afresh


def test_a_correction_arrives_in_the_delivery_of_the_day_it_was_posted(
    session: Session, database: Database, tmp_path: Path
) -> None:
    # The primer's row 5, Tuesday's dividend of $9.00, was wrong. Its Reversal (row 9) and the
    # right dividend (row 10) were posted on Friday, with Tuesday's Trade date.
    load_v0(session)
    store = LocalFeedStore(tmp_path)

    write_delivery(database.app, store, date(2026, 3, 3))
    write_delivery(database.app, store, FRIDAY)

    tuesday = rows_of(store, "2026-03-03/transactions.csv")
    friday = rows_of(store, "2026-03-06/transactions.csv")
    assert [(row["transaction_id"], row["amount"]) for row in tuesday] == [("TX-000000005", "9.00")]
    assert [
        (row["transaction_id"], row["kind"], row["reverses"], row["amount"], row["trade_date"])
        for row in friday
    ] == [
        ("TX-000000009", "reversal", "TX-000000005", "-9.00", "2026-03-03"),
        ("TX-000000010", "dividend", "", "10.50", "2026-03-03"),
        ("TX-000000011", "interest", "", "1.15", "2026-03-06"),
    ]
    assert {row["posting_date"] for row in friday} == {"2026-03-06"}


def test_every_transaction_is_sent_exactly_once(
    session: Session, database: Database, tmp_path: Path
) -> None:
    load_v0(session)
    store = LocalFeedStore(tmp_path)

    sent: list[str] = []
    for day in FIXTURE_DAYS:
        write_delivery(database.app, store, day)
        sent += [row["transaction_id"] for row in rows_of(store, f"{day}/transactions.csv")]

    assert sorted(sent) == [f"TX-{number:09d}" for number in range(1, 14)]


def test_a_quiet_day_still_gets_a_transactions_file(
    session: Session, database: Database, tmp_path: Path
) -> None:
    # Friday 27 February: nothing was posted, so the file is its header row alone, and the
    # Manifest says 0 rows, so a quiet day looks different from a lost file (primer, Part 3).
    load_v0(session)
    store = LocalFeedStore(tmp_path)

    manifest = write_delivery(database.app, store, date(2026, 2, 27))

    assert store.get("2026-02-27/transactions.csv") == (
        b"transaction_id,account_number,kind,reverses,security,shares,amount,"
        b"trade_date,settlement_date,posting_date\n"
    )
    assert [file.rows for file in manifest.files if file.name == "transactions.csv"] == [0]
    # The IRA opens on 2 March, so it isn't in the Accounts yet.
    assert store.get("2026-02-27/accounts.csv") == (
        b"account_number,registration_type,opened_on\nCW-000001,joint,2026-02-26\n"
    )


def test_a_position_with_no_price_is_sent_without_one(
    session: Session, database: Database, tmp_path: Path
) -> None:
    # It is still a Position, so it is still sent, but with no value rather than $0.00.
    ledger = read_ledger_fixture(LEDGER_V0_PATH)
    no_bond_prices = ledger.model_copy(update={"prices": {"LKSF": ledger.prices["LKSF"]}})
    load(session, read_world(WORLD_V0_PATH), no_bond_prices)
    store = LocalFeedStore(tmp_path)

    write_delivery(database.app, store, MONDAY)

    assert rows_of(store, "2026-03-02/positions.csv")[0] == {
        "account_number": "CW-000001",
        "security": "LKBF",
        "shares": "300.000000",
        "price": "",
        "market_value": "",
    }
    assert store.get("2026-03-02/prices.csv") == b"security,price\nLKSF,150.25\nSWEEP,1.00\n"


class RecordingStore(LocalFeedStore):
    """A local store that remembers the order keys were put in."""

    def __init__(self, root: Path) -> None:
        super().__init__(root)
        self.put_order: list[str] = []

    def put(self, key: str, content: bytes) -> None:
        self.put_order.append(key)
        super().put(key, content)


def test_the_manifest_is_written_last(session: Session, database: Database, tmp_path: Path) -> None:
    load_v0(session)
    store = RecordingStore(tmp_path)

    write_delivery(database.app, store, MONDAY)

    assert len(store.put_order) == 6
    assert store.put_order[-1] == "2026-03-02/manifest.json"


def test_the_primer_quotes_the_real_hashes_for_2_march(
    session: Session, database: Database, tmp_path: Path
) -> None:
    # docs/learn/03 shows 2 March's files and Manifest as this writer writes them, and quotes
    # their hashes. A change to the format fails here until the primer is updated with it.
    primer = (REPO / "docs" / "learn" / "03-custodian-feed-and-ingestion.md").read_text()
    load_v0(session)
    store = LocalFeedStore(tmp_path)

    manifest = write_delivery(database.app, store, MONDAY)

    for file in manifest.files:
        assert f'"sha256": "{file.sha256}"' in primer, file.name
    assert hashlib.sha256(store.get("2026-03-02/manifest.json")).hexdigest() in primer
