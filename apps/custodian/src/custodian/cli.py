"""What the package scripts' command-line entry points share: `cw`'s contract, without incur.

`pnpm cw` (packages/cli, ADR 0026) is built on incur, a TypeScript library. These scripts are
Python, so this module gives them the same contract, and an agent reads every command in the repo
the same way (#236):

- **Output is data.** A command returns a Pydantic model, printed as TOON (the default) or JSON
  (`--json`), its fields in camelCase as `cw`'s are.
- **A failure** prints `{ code, message, retryable, cta? }` in the same format and exits 1. `code`
  is a named refusal (`no_database`, `load_conflict`, …), `invalid_input` for bad options, or
  `UNKNOWN` for a bug, whose traceback goes to stderr.
- **Next steps** come back as `cta`, the commands worth running next, folded into the output.
- **`--schema`** prints a command's options and output as JSON Schema, and **`--llms`** lists every
  command, so an agent can learn them without reading the docs.
"""

import argparse
import json
import os
import sys
import traceback
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, NoReturn, Protocol

import toon_format
from pydantic import BaseModel, ConfigDict, ValidationError
from pydantic.alias_generators import to_camel

from custodian.database import NoDatabase
from custodian.factor_file import FactorFileDownloadFailed, FactorFileError, FactorFileMismatch

__all__ = ["CliError", "Command", "Cta", "Done", "Options", "Output", "run", "script_args"]

type Format = Literal["toon", "json"]


def script_args(argv: Sequence[str] | None = None) -> list[str]:
    """The arguments a package script was given, without a leading `--`.

    pnpm 12 forwards a script's arguments without needing `--`, and passes one on when it's there:
    `pnpm feed:write -- --date …` runs `python -m custodian.feed -- --date …`. argparse reads
    everything after `--` as positional, so `--date` would go missing; dropping a leading one makes
    both forms work.
    """
    args = list(sys.argv[1:] if argv is None else argv)
    return args[1:] if args[:1] == ["--"] else args


class _Model(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        # Written in snake_case here, printed (and described by --schema) in camelCase, as cw's
        # Zod schemas are; `validate_by_name` lets the runner build one from argparse's names.
        alias_generator=to_camel,
        serialize_by_alias=True,
        validate_by_name=True,
        # Each field's docstring becomes its description in --schema and --help.
        use_attribute_docstrings=True,
    )


class Options(_Model):
    """A command's options, one field each: `as_of: date` is `--as-of`, `dry_run: bool` is the
    flag `--dry-run`. A field without a default is a required option."""


class Output(_Model):
    """What a command returns on success."""


@dataclass(frozen=True)
class Cta:
    """A command to run next, written out in full, as a person would type it."""

    command: str
    description: str


# How the next steps and a failure are printed, in cw's shapes; --schema describes them too.


class _CtaCommand(_Model):
    command: str
    description: str


class _CtaBlock(_Model):
    description: str
    """"Suggested command:", or "Suggested commands:" for more than one"""
    commands: list[_CtaCommand]


class _Error(_Model):
    code: str
    """What went wrong, to branch on: a named refusal, invalid_input, or UNKNOWN for a bug"""
    message: str
    """What went wrong, and how to fix it, for a person"""
    retryable: bool
    """Whether the same command may succeed if run again unchanged (a network failure)"""
    cta: _CtaBlock | None = None
    """The commands to run next, when there's one that helps"""


@dataclass(frozen=True)
class Done[D: Output]:
    """A command's result: its output, and the commands worth running next."""

    data: D
    cta: Sequence[Cta] = ()


class CliError(Exception):
    """A refusal, with the code an agent branches on. Raise it from a command's `run`.

    The domain modules keep their own exceptions; a command turns them into this one at its edge.
    """

    def __init__(
        self, *, code: str, message: str, retryable: bool = False, cta: Sequence[Cta] = ()
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.cta = cta


@dataclass(frozen=True)
class Command[O: Options, D: Output]:
    """One package script: `name` is its pnpm script, as in `pnpm --filter custodian feed:write`."""

    name: str
    description: str
    options: type[O]
    output: type[D]
    run: Callable[[O], Done[D]]

    def main(self, argv: Sequence[str] | None = None) -> int:
        """Run it on `argv` (by default the script's own arguments) and return its exit code."""
        return run(self, script_args(argv))


class _Described(Protocol):
    """What `--llms` needs of a command, whatever its options and output: every `Command` fits."""

    @property
    def name(self) -> str: ...
    @property
    def description(self) -> str: ...
    @property
    def options(self) -> type[Options]: ...
    @property
    def output(self) -> type[Output]: ...


class _Parser(argparse.ArgumentParser):
    """argparse, refusing bad options with `invalid_input` instead of printing usage and exiting."""

    def error(self, message: str) -> NoReturn:
        raise CliError(code="invalid_input", message=f"{message} (--help lists the options)")


def run[O: Options, D: Output](command: Command[O, D], args: Sequence[str]) -> int:
    """Parse `args`, run `command` and print its result or its error. Returns the exit code."""
    output_format = _format(args)
    try:
        if "--llms" in args:
            _print(_manifest(output_format), output_format)
            return 0
        if "--schema" in args:
            _print(_schema(command), output_format)
            return 0
        options = _options(command, args)
        done = command.run(options)
    except CliError as error:
        _print_error(error, output_format)
        return 1
    except Exception as error:
        _print_error(_known(error), output_format)
        return 1
    _print(_with_cta(done.data.model_dump(mode="json"), done.cta), output_format)
    return 0


def _format(args: Sequence[str]) -> Format:
    """`--json`, or `--format json`; TOON otherwise, as in cw. An unknown format is left to the
    full parse to refuse."""
    globals_only = _Parser(add_help=False)
    globals_only.add_argument("--json", action="store_true")
    globals_only.add_argument("--format", choices=["toon", "json"], default="toon")
    try:
        known, _ = globals_only.parse_known_args(args)
    except CliError:
        return "toon"
    return "json" if known.json or known.format == "json" else "toon"


def _options[O: Options, D: Output](command: Command[O, D], args: Sequence[str]) -> O:
    parser = _Parser(prog=command.name, description=command.description)
    for name, info in command.options.model_fields.items():
        flag = "--" + name.replace("_", "-")
        help_text = info.description or ""
        if info.annotation is bool:
            parser.add_argument(flag, dest=name, action="store_true", help=help_text)
        elif info.is_required():
            parser.add_argument(flag, dest=name, required=True, help=help_text)
        else:
            parser.add_argument(
                flag, dest=name, default=info.default, help=f"{help_text} (default: {info.default})"
            )
    parser.add_argument("--json", action="store_true", help="print JSON instead of TOON")
    parser.add_argument("--format", choices=["toon", "json"], help="toon (the default) or json")
    parser.add_argument("--schema", action="store_true", help="print the options and output")
    parser.add_argument("--llms", action="store_true", help="list every custodian command")
    parsed = vars(parser.parse_args(args))
    values = {name: parsed[name] for name in command.options.model_fields}
    for name, info in command.options.model_fields.items():
        # A path typed on the command line (a str; a default is already a Path) is read from where
        # it was typed, as in cw. pnpm runs the script in apps/custodian and says in INIT_CWD
        # where it was typed; run directly, that's the working directory. An absolute one stays.
        if info.annotation is Path and isinstance(values[name], str):
            typed_in = Path(os.environ.get("INIT_CWD") or os.getcwd())
            values[name] = typed_in / values[name]
    try:
        # argparse gives strings; Pydantic turns them into the fields' types (a date, a Path).
        return command.options.model_validate(values)
    except ValidationError as error:
        raise CliError(code="invalid_input", message=str(error)) from None


def _known(error: Exception) -> CliError:
    """A refusal several commands share, by its exception; anything else is a bug."""
    match error:
        case NoDatabase():
            return CliError(
                code="no_database",
                message=(
                    "DATABASE_URL is not set: point it at the custodian's own database, Compose's"
                    " custodian-db (localhost:5434 with compose.dev.yaml, as"
                    " apps/custodian/README.md says). A git worktree has none of its own: its"
                    " database gets the example Deliveries instead (pnpm dev ingests them when it"
                    " creates it; for one created before, run pnpm cw custodian ingest <date>"
                    " --root apps/custodian/fixtures/feed for each date folder there)"
                ),
            )
        case FactorFileMismatch():
            return CliError(code="pin_mismatch", message=str(error))
        case FactorFileDownloadFailed():
            return CliError(code="factor_file_unavailable", message=str(error), retryable=True)
        case FactorFileError():
            return CliError(code="factor_file_unavailable", message=str(error))
        case _:
            traceback.print_exception(error, file=sys.stderr)
            return CliError(code="UNKNOWN", message=f"{type(error).__name__}: {error}")


def _schema(command: _Described) -> dict[str, object]:
    """The command's options, its output, and what it prints instead when it fails."""
    return {
        "options": command.options.model_json_schema(mode="validation"),
        "output": command.output.model_json_schema(mode="serialization"),
        "error": _Error.model_json_schema(mode="serialization"),
    }


def _commands() -> list[_Described]:
    """Every command, in the order `--llms` lists them.

    Imported here, when `--llms` asks, not at the top: each of these modules imports this one, so
    importing them at the top would be a cycle.
    """
    from custodian.feed import COMMAND as feed_write
    from custodian.load import COMMAND as world_load
    from custodian.treasury_yields import COMMAND as yields_write
    from custodian.world_generator import COMMAND as world_generate

    return [world_generate, world_load, feed_write, yields_write]


def _manifest(output_format: Format) -> str | dict[str, object]:
    """Every command: as a Markdown table, as `cw --llms` prints, or, in JSON, with each one's
    options and output too."""
    commands = _commands()
    if output_format == "json":
        return {
            "version": "custodian.v1",
            "commands": [
                {"name": c.name, "description": c.description, **_schema(c)} for c in commands
            ],
        }
    lines = [
        "# pnpm --filter custodian",
        "",
        "The simulated custodian's commands, for agents and operators",
        "",
        "| Command | Description |",
        "|---------|-------------|",
        *(f"| `pnpm --filter custodian {c.name}` | {c.description} |" for c in commands),
        "",
        "Run `pnpm --filter custodian <command> --schema` for a command's options and output,"
        " or `--llms --json` for every command's.",
    ]
    return "\n".join(lines)


def _cta_block(cta: Sequence[Cta]) -> _CtaBlock | None:
    """The next steps in the shape cw prints them, or None when there are none."""
    if not cta:
        return None
    return _CtaBlock(
        description="Suggested command:" if len(cta) == 1 else "Suggested commands:",
        commands=[_CtaCommand(command=c.command, description=c.description) for c in cta],
    )


def _with_cta(base: dict[str, object], cta: Sequence[Cta]) -> dict[str, object]:
    """`base` with the next steps folded in, as cw folds them into a command's output."""
    block = _cta_block(cta)
    return base if block is None else {**base, "cta": block.model_dump(mode="json")}


def _print_error(error: CliError, output_format: Format) -> None:
    envelope = _Error(
        code=error.code,
        message=error.message,
        retryable=error.retryable,
        cta=_cta_block(error.cta),
    )
    _print(envelope.model_dump(mode="json", exclude_none=True), output_format)


def _print(value: str | dict[str, object], output_format: Format) -> None:
    if isinstance(value, str):
        print(value)
    elif output_format == "json":
        print(json.dumps(value, indent=2))
    else:
        print(toon_format.encode(value))
