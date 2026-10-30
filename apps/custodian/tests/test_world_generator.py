"""The world generator: what a generated world holds, and the `world:generate` command."""

import json
from collections import Counter
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, validate

from custodian.world import SCHEMA_PATH, WORLD_GENERATED_PATH, Person, WorldFile
from custodian.world_generator import (
    AGES_COUNT_FROM,
    DEFAULT_SEED,
    generate_world,
    main,
    world_text,
)

# Every property holds for any seed, not just the committed one.
SEEDS = [DEFAULT_SEED, 2, 3, 12345]


def age_on_reference_date(person: Person) -> int:
    born = person.born_on
    had_birthday = (AGES_COUNT_FROM.month, AGES_COUNT_FROM.day) >= (born.month, born.day)
    return AGES_COUNT_FROM.year - born.year - (0 if had_birthday else 1)


def adults(world: WorldFile) -> list[Person]:
    return [
        person
        for household in world.crm.households
        for person in (household.primary, household.co_client)
        if person is not None
    ]


def run(args: list[str], capsys: pytest.CaptureFixture[str]) -> tuple[int, dict[str, object]]:
    """Run world:generate with --json; returns its exit code and what it printed."""
    exit_code = main([*args, "--json"])
    return exit_code, json.loads(capsys.readouterr().out)


def test_the_same_seed_gives_the_same_bytes() -> None:
    assert world_text(generate_world(7)) == world_text(generate_world(7))


def test_a_different_seed_gives_a_different_world() -> None:
    assert world_text(generate_world(7)) != world_text(generate_world(8))


@pytest.mark.parametrize("seed", SEEDS)
def test_about_sixty_households_with_a_few_prospects_and_former_clients(seed: int) -> None:
    households = generate_world(seed).crm.households

    assert len(households) == 60
    statuses = Counter(household.relationship_status for household in households)
    assert 1 <= statuses["prospect"] <= 6
    assert 1 <= statuses["former_client"] <= 6
    assert statuses["client"] >= 48


@pytest.mark.parametrize("seed", SEEDS)
def test_some_households_have_a_co_client_and_some_have_dependents(seed: int) -> None:
    households = generate_world(seed).crm.households

    with_co_client = sum(household.co_client is not None for household in households)
    assert 0 < with_co_client < len(households)
    with_dependents = sum(len(household.dependents) > 0 for household in households)
    assert 0 < with_dependents < len(households)


@pytest.mark.parametrize("seed", SEEDS)
def test_every_primary_is_in_one_of_the_three_life_stages_and_all_three_appear(seed: int) -> None:
    ages = [age_on_reference_date(h.primary) for h in generate_world(seed).crm.households]

    young_high_earners = [age for age in ages if 28 <= age <= 44]
    pre_retirees = [age for age in ages if 45 <= age <= 64]
    # Everyone 73 or older on 31 August 2026 was born by 1953, and RMDs start at 73 for people
    # born in 1951 through 1958, and earlier for people born before that
    # (docs/learn/02-account-types.md).
    retirees = [age for age in ages if 73 <= age <= 90]
    assert young_high_earners
    assert pre_retirees
    assert retirees
    assert len(young_high_earners) + len(pre_retirees) + len(retirees) == len(ages)


@pytest.mark.parametrize("seed", SEEDS)
def test_every_primary_and_co_client_is_an_adult(seed: int) -> None:
    assert all(age_on_reference_date(person) >= 18 for person in adults(generate_world(seed)))


@pytest.mark.parametrize("seed", SEEDS)
def test_every_dependent_is_at_least_eighteen_years_younger_than_both_adults(seed: int) -> None:
    for household in generate_world(seed).crm.households:
        parents = [p for p in (household.primary, household.co_client) if p is not None]
        for dependent in household.dependents:
            for parent in parents:
                assert (dependent.born_on - parent.born_on).days >= 18 * 365


@pytest.mark.parametrize("seed", SEEDS)
def test_nobody_has_accounts_yet(seed: int) -> None:
    # Accounts and their roles come in #52.
    world = generate_world(seed)

    assert world.custodian.accounts == []
    assert all(
        person.account_roles == []
        for household in world.crm.households
        for _, person in household.people()
    )


@pytest.mark.parametrize("seed", SEEDS)
def test_the_world_belongs_to_the_seeded_firm(seed: int) -> None:
    # `cw db seed` refuses a world whose Firm isn't the one it seeded.
    assert generate_world(seed).crm.firm.name == "Larkspur Wealth Partners"


def test_no_two_households_share_a_name() -> None:
    names = [household.name for household in generate_world(DEFAULT_SEED).crm.households]

    assert len(set(names)) == len(names)


def test_a_person_and_their_household_share_a_number_in_their_keys() -> None:
    # Keys stay unique because of it; `WorldFile` refuses a repeated one.
    for household in generate_world(DEFAULT_SEED).crm.households:
        number = household.key.rsplit("-", 1)[1]
        for _, person in household.people():
            assert person.key.endswith(f"-{number}")


def test_the_committed_file_is_what_the_default_seed_gives() -> None:
    # Regenerate it with `pnpm --filter custodian world:generate`.
    assert WORLD_GENERATED_PATH.read_text() == world_text(generate_world(DEFAULT_SEED))


def test_the_committed_file_passes_the_json_schema() -> None:
    # What the TypeScript seed will do with the same two files.
    schema = json.loads(SCHEMA_PATH.read_text())

    validate(json.loads(WORLD_GENERATED_PATH.read_text()), schema, cls=Draft202012Validator)


def test_the_command_writes_the_file_and_says_what_it_made(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    out = tmp_path / "world.json"

    exit_code, printed = run(["--seed", "7", "--out", str(out)], capsys)

    world = generate_world(7)
    assert exit_code == 0
    assert out.read_text() == world_text(world)
    statuses = Counter(household.relationship_status for household in world.crm.households)
    assert printed["dryRun"] is False
    assert printed["seed"] == 7
    assert printed["households"] == 60
    assert printed["prospects"] == statuses["prospect"]
    assert printed["clients"] == statuses["client"]
    assert printed["formerClients"] == statuses["former_client"]
    assert printed["people"] == sum(len(list(h.people())) for h in world.crm.households)


def test_with_dry_run_it_writes_nothing(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    out = tmp_path / "world.json"

    exit_code, printed = run(["--out", str(out), "--dry-run"], capsys)

    assert exit_code == 0
    assert printed["dryRun"] is True
    assert printed["households"] == 60
    assert not out.exists()


def test_a_seed_that_isnt_a_whole_number_is_invalid_input(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code, printed = run(["--seed", "soon", "--out", str(tmp_path / "w.json")], capsys)

    assert (exit_code, printed["code"]) == (1, "invalid_input")


def test_a_folder_that_isnt_there_is_invalid_input(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code, printed = run(["--out", str(tmp_path / "nope" / "world.json")], capsys)

    assert (exit_code, printed["code"]) == (1, "invalid_input")
    assert "nope" in str(printed["message"])


def test_a_folder_given_as_the_file_is_invalid_input(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code, printed = run(["--out", str(tmp_path)], capsys)

    assert (exit_code, printed["code"]) == (1, "invalid_input")
