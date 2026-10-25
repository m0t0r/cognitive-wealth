"""A package script's arguments, with or without pnpm's `--` in front (#104)."""

from custodian.cli import script_args


def test_a_leading_double_dash_is_dropped() -> None:
    assert script_args(["--", "--date", "2026-03-06"]) == ["--date", "2026-03-06"]


def test_arguments_without_one_are_kept_as_they_are() -> None:
    assert script_args(["--date", "2026-03-06"]) == ["--date", "2026-03-06"]


def test_only_a_leading_one_is_dropped() -> None:
    assert script_args(["--world", "w.json", "--", "x"]) == ["--world", "w.json", "--", "x"]
