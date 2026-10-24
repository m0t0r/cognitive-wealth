import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from custodian.ledger_fixture import LEDGER_V0_PATH, read_ledger_fixture


def write_fixture_with_row(tmp_path: Path, number: int, change: dict[str, object]) -> Path:
    """A copy of the v0 ledger fixture with `change` merged into row `number`."""
    fixture = json.loads(LEDGER_V0_PATH.read_text())
    fixture["transactions"][number - 1] |= change
    path = tmp_path / "ledger.json"
    path.write_text(json.dumps(fixture))
    return path


def test_the_v0_fixture_holds_danas_week_and_the_iras_first_day() -> None:
    fixture = read_ledger_fixture(LEDGER_V0_PATH)

    assert [(row.row, row.account, row.kind) for row in fixture.transactions][8:] == [
        (9, "CW-000001", "reversal"),
        (10, "CW-000001", "dividend"),
        (11, "CW-000001", "interest"),
        (12, "CW-000002", "contribution"),
        (13, "CW-000002", "buy"),
    ]


def test_a_reversal_must_negate_the_row_it_undoes(tmp_path: Path) -> None:
    path = write_fixture_with_row(tmp_path, 9, {"amount": "-10.50"})

    with pytest.raises(ValidationError, match=r"transactions\.8: .*negate row 5"):
        read_ledger_fixture(path)


def test_a_reversal_must_undo_an_earlier_row(tmp_path: Path) -> None:
    path = write_fixture_with_row(tmp_path, 9, {"reverses": 12})

    with pytest.raises(ValidationError, match=r"transactions\.8: .*an earlier row"):
        read_ledger_fixture(path)


def test_rows_are_numbered_in_order(tmp_path: Path) -> None:
    path = write_fixture_with_row(tmp_path, 3, {"row": 4})

    with pytest.raises(ValidationError, match=r"transactions\.2\.row: .*should be 3"):
        read_ledger_fixture(path)
