"""The example Deliveries in `fixtures/feed/`, which Cognitive Wealth's tests read.

`@repo/custodian-client`'s tests parse every row of them with the Zod schemas generated from
`openapi.json`, so the contract and the writer can't disagree. They are 2 March, and Friday
6 March, whose Reversal fills the columns 2 March leaves empty.

`test_feed.py` fails when the writer no longer writes exactly these bytes. Then rewrite them with
`pnpm --filter custodian feed:examples` (Docker): it starts the same throwaway Postgres as the
integration tests, never the dev database, loads the v0 world into it, and writes both days.
"""

import shutil
from datetime import date

from sqlalchemy.orm import Session

from custodian.feed import write_delivery
from custodian.feed_store import FeedStore, LocalFeedStore
from custodian.ledger_fixture import LEDGER_V0_PATH, read_ledger_fixture
from custodian.load import load
from custodian.world import WORLD_V0_PATH, read_world
from tests.integration.postgres import (
    CUSTODIAN,
    Database,
    migrated_database,
    start_migrated_postgres,
)

__all__ = ["EXAMPLE_DAYS", "EXAMPLE_DELIVERIES", "write_example_deliveries"]

EXAMPLE_DELIVERIES = CUSTODIAN / "fixtures" / "feed"
EXAMPLE_DAYS = (date(2026, 3, 2), date(2026, 3, 6))


def write_example_deliveries(database: Database, store: FeedStore) -> None:
    """Load the v0 world into `database` (migrated, and empty) and write each example day."""
    with Session(database.app) as session:
        load(session, read_world(WORLD_V0_PATH), read_ledger_fixture(LEDGER_V0_PATH))
    for day in EXAMPLE_DAYS:
        write_delivery(database.app, store, day)


def main() -> None:
    with start_migrated_postgres() as server, migrated_database(server) as database:
        # Start from nothing, so a file the writer no longer writes doesn't linger.
        shutil.rmtree(EXAMPLE_DELIVERIES, ignore_errors=True)
        write_example_deliveries(database, LocalFeedStore(EXAMPLE_DELIVERIES))
    days = ", ".join(day.isoformat() for day in EXAMPLE_DAYS)
    print(f"Wrote the Deliveries for {days} to {EXAMPLE_DELIVERIES}")


if __name__ == "__main__":
    main()
