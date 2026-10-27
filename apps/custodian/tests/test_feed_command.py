"""`feed:write` as an agent runs it, before it reaches a database (#236).

The Deliveries it writes are tested in tests/integration/test_feed.py; these check what it says.
"""

import json

import pytest

from custodian.feed import main


def test_without_a_database_it_says_no_database(capsys: pytest.CaptureFixture[str]) -> None:
    # tests/conftest.py unsets DATABASE_URL, as in a worktree that has no custodian database (#223).
    exit_code = main(["--date", "2026-03-02", "--json"])

    assert exit_code == 1
    error = json.loads(capsys.readouterr().out)
    assert error["code"] == "no_database"
    assert error["retryable"] is False
    assert "DATABASE_URL" in error["message"]


def test_without_json_the_error_is_toon_as_in_cw(capsys: pytest.CaptureFixture[str]) -> None:
    exit_code = main(["--date", "2026-03-02"])

    assert exit_code == 1
    lines = capsys.readouterr().out.splitlines()
    assert lines[0] == "code: no_database"
    assert lines[-1] == "retryable: false"


@pytest.mark.parametrize(
    "args",
    [
        ["--json"],
        ["--date", "2 March", "--json"],
        ["--date", "2026-03-02", "--when", "x", "--json"],
    ],
    ids=["no date", "not a date", "an unknown option"],
)
def test_bad_options_are_invalid_input(args: list[str], capsys: pytest.CaptureFixture[str]) -> None:
    exit_code = main(args)

    assert exit_code == 1
    error = json.loads(capsys.readouterr().out)
    assert (error["code"], error["retryable"]) == ("invalid_input", False)


def test_schema_describes_the_options_and_output_in_camel_case(
    capsys: pytest.CaptureFixture[str],
) -> None:
    # Even without the required --date: it describes the command, it doesn't run it.
    exit_code = main(["--schema", "--json"])

    assert exit_code == 0
    schema = json.loads(capsys.readouterr().out)
    assert schema["options"]["required"] == ["date"]
    assert set(schema["options"]["properties"]) == {"date", "root", "dryRun"}
    assert schema["options"]["properties"]["date"]["format"] == "date"
    assert set(schema["output"]["properties"]) == {"dryRun", "asOf", "delivery", "files"}
