"""What every package script shares: its arguments, with or without pnpm's `--` in front (#104),
and cw's contract (#236): output as data, error codes, next steps, --schema and --llms."""

import json
from pathlib import Path

import pytest

from custodian.cli import CliError, Command, Cta, Done, Options, Output, run, script_args


class GreetOptions(Options):
    name: str
    """Who to greet"""
    loud: bool = False


class GreetOutput(Output):
    greeting: str
    said_loudly: bool


def greet(options: GreetOptions) -> Done[GreetOutput]:
    if options.name == "nobody":
        raise CliError(
            code="nobody_there",
            message="There's nobody to greet",
            cta=[Cta(command="greet --name world", description="Greet the world instead")],
        )
    if options.name == "bug":
        raise KeyError("a bug")
    greeting = f"Hello, {options.name}" + ("!" if options.loud else "")
    return Done(
        GreetOutput(greeting=greeting, said_loudly=options.loud),
        cta=[Cta(command="greet --name again", description="Greet again")],
    )


GREET = Command(
    name="greet", description="Greet someone", options=GreetOptions, output=GreetOutput, run=greet
)


def test_output_is_toon_by_default_in_camel_case_with_the_next_steps(
    capsys: pytest.CaptureFixture[str],
) -> None:
    exit_code = run(GREET, ["--name", "Ana", "--loud"])

    assert exit_code == 0
    assert capsys.readouterr().out == (
        # TOON quotes a string with a comma in it, since a comma separates a table's values.
        'greeting: "Hello, Ana!"\n'
        "saidLoudly: true\n"
        "cta:\n"
        '  description: "Suggested command:"\n'
        "  commands[1]{command,description}:\n"
        "    greet --name again,Greet again\n"
    )


@pytest.mark.parametrize("flags", [["--json"], ["--format", "json"]])
def test_json_on_request(flags: list[str], capsys: pytest.CaptureFixture[str]) -> None:
    exit_code = run(GREET, ["--name", "Ana", *flags])

    assert exit_code == 0
    assert json.loads(capsys.readouterr().out) == {
        "greeting": "Hello, Ana",
        "saidLoudly": False,
        "cta": {
            "description": "Suggested command:",
            "commands": [{"command": "greet --name again", "description": "Greet again"}],
        },
    }


def test_a_refusal_prints_its_code_and_next_step_and_exits_1(
    capsys: pytest.CaptureFixture[str],
) -> None:
    exit_code = run(GREET, ["--name", "nobody", "--json"])

    assert exit_code == 1
    assert json.loads(capsys.readouterr().out) == {
        "code": "nobody_there",
        "message": "There's nobody to greet",
        "retryable": False,
        "cta": {
            "description": "Suggested command:",
            "commands": [
                {"command": "greet --name world", "description": "Greet the world instead"}
            ],
        },
    }


def test_a_bug_is_unknown_with_its_traceback_on_stderr(
    capsys: pytest.CaptureFixture[str],
) -> None:
    exit_code = run(GREET, ["--name", "bug", "--json"])

    assert exit_code == 1
    captured = capsys.readouterr()
    error = json.loads(captured.out)
    assert (error["code"], error["message"]) == ("UNKNOWN", "KeyError: 'a bug'")
    assert "Traceback" in captured.err


class WhereOptions(Options):
    folder: Path = Path("/default")


class WhereOutput(Output):
    folder: Path


WHERE = Command(
    name="where",
    description="Say which folder it was given",
    options=WhereOptions,
    output=WhereOutput,
    run=lambda options: Done(WhereOutput(folder=options.folder)),
)


def test_a_relative_path_is_read_from_where_pnpm_was_run_as_in_cw(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # pnpm runs the script in apps/custodian, and says in INIT_CWD where it was typed.
    monkeypatch.setenv("INIT_CWD", str(tmp_path))
    monkeypatch.chdir(tmp_path.parent)

    run(WHERE, ["--folder", ".dev/feed", "--json"])

    assert json.loads(capsys.readouterr().out)["folder"] == str(tmp_path / ".dev" / "feed")


def test_without_pnpm_a_relative_path_is_read_from_the_working_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv("INIT_CWD", raising=False)
    monkeypatch.chdir(tmp_path)

    run(WHERE, ["--folder", "feed", "--json"])

    assert json.loads(capsys.readouterr().out)["folder"] == str(tmp_path / "feed")


def test_an_absolute_path_and_the_default_are_kept_as_they_are(
    capsys: pytest.CaptureFixture[str],
) -> None:
    run(WHERE, ["--folder", "/srv/feed", "--json"])
    given = json.loads(capsys.readouterr().out)
    run(WHERE, ["--json"])
    default = json.loads(capsys.readouterr().out)

    assert (given["folder"], default["folder"]) == ("/srv/feed", "/default")


def test_schema_describes_the_error_envelope_too(capsys: pytest.CaptureFixture[str]) -> None:
    exit_code = run(GREET, ["--schema", "--json"])

    assert exit_code == 0
    error = json.loads(capsys.readouterr().out)["error"]
    assert error["required"] == ["code", "message", "retryable"]
    assert set(error["properties"]) == {"code", "message", "retryable", "cta"}


def test_an_unknown_format_is_invalid_input_with_nothing_on_stderr(
    capsys: pytest.CaptureFixture[str],
) -> None:
    exit_code = run(GREET, ["--name", "Ana", "--format", "xml"])

    assert exit_code == 1
    captured = capsys.readouterr()
    assert captured.out.splitlines()[0] == "code: invalid_input"
    assert captured.err == ""


def test_llms_lists_every_custodian_command(capsys: pytest.CaptureFixture[str]) -> None:
    # Any command's --llms lists all of them: an agent needs to find only one.
    exit_code = run(GREET, ["--llms"])

    assert exit_code == 0
    manifest = capsys.readouterr().out
    for name in ("world:generate", "world:load", "feed:write", "yields:write"):
        assert f"| `pnpm --filter custodian {name}` |" in manifest


def test_llms_in_json_gives_each_commands_options_and_output(
    capsys: pytest.CaptureFixture[str],
) -> None:
    exit_code = run(GREET, ["--llms", "--json"])

    assert exit_code == 0
    commands = {c["name"]: c for c in json.loads(capsys.readouterr().out)["commands"]}
    assert list(commands) == ["world:generate", "world:load", "feed:write", "yields:write"]
    assert "dryRun" in commands["world:load"]["options"]["properties"]
    assert "rebuildNeeded" in commands["yields:write"]["output"]["properties"]


def test_a_leading_double_dash_is_dropped() -> None:
    assert script_args(["--", "--date", "2026-03-06"]) == ["--date", "2026-03-06"]


def test_arguments_without_one_are_kept_as_they_are() -> None:
    assert script_args(["--date", "2026-03-06"]) == ["--date", "2026-03-06"]


def test_only_a_leading_one_is_dropped() -> None:
    assert script_args(["--world", "w.json", "--", "x"]) == ["--world", "w.json", "--", "x"]
