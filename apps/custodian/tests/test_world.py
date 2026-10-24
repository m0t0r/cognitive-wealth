import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from custodian.models import RegistrationType
from custodian.world import SCHEMA_PATH, WORLD_V0_PATH, read_world, world_json_schema


def write_world_with(tmp_path: Path, change: dict[str, object]) -> Path:
    """A copy of world v0 with `change` merged into its first Household, written to a file."""
    world = json.loads(WORLD_V0_PATH.read_text())
    world["crm"]["households"][0] |= change
    path = tmp_path / "world.json"
    path.write_text(json.dumps(world))
    return path


def test_world_v0_has_one_household_with_a_joint_account_and_an_ira() -> None:
    world = read_world(WORLD_V0_PATH)

    [household] = world.crm.households
    assert [(person.key, person.role) for person in household.people] == [
        ("dana-reyes", "primary"),
        ("jordan-reyes", "co_client"),
    ]
    assert [account.registration_type for account in world.custodian.accounts] == [
        RegistrationType.JOINT,
        RegistrationType.TRADITIONAL_IRA,
    ]
    assert {(role.person, role.account_number, role.role) for role in household.account_roles} == {
        ("dana-reyes", "CW-000001", "joint_owner"),
        ("jordan-reyes", "CW-000001", "joint_owner"),
        ("dana-reyes", "CW-000002", "owner"),
        ("jordan-reyes", "CW-000002", "beneficiary"),
    }


def test_a_malformed_world_file_is_rejected_naming_the_bad_field(tmp_path: Path) -> None:
    world = json.loads(WORLD_V0_PATH.read_text())
    world["custodian"]["accounts"][1]["registration_type"] = "brokerage"
    path = tmp_path / "world.json"
    path.write_text(json.dumps(world))

    with pytest.raises(ValidationError, match=r"custodian\.accounts\.1\.registration_type"):
        read_world(path)


def test_an_unknown_field_is_rejected_rather_than_ignored(tmp_path: Path) -> None:
    path = write_world_with(tmp_path, {"advisor": "Sam"})

    with pytest.raises(ValidationError, match=r"crm\.households\.0\.advisor"):
        read_world(path)


def test_an_account_role_must_name_an_account_in_the_custodian_half(tmp_path: Path) -> None:
    roles = json.loads(WORLD_V0_PATH.read_text())["crm"]["households"][0]["account_roles"]
    roles[0]["account_number"] = "CW-999999"
    path = write_world_with(tmp_path, {"account_roles": roles})

    with pytest.raises(ValidationError, match=r"account_roles\.0\.account_number.*CW-999999"):
        read_world(path)


def test_an_account_role_must_name_a_person_in_its_household(tmp_path: Path) -> None:
    roles = json.loads(WORLD_V0_PATH.read_text())["crm"]["households"][0]["account_roles"]
    roles[0]["person"] = "alex-reyes"
    path = write_world_with(tmp_path, {"account_roles": roles})

    with pytest.raises(ValidationError, match=r"account_roles\.0\.person.*alex-reyes"):
        read_world(path)


def test_a_household_has_exactly_one_primary(tmp_path: Path) -> None:
    people = json.loads(WORLD_V0_PATH.read_text())["crm"]["households"][0]["people"]
    people[1]["role"] = "primary"
    path = write_world_with(tmp_path, {"people": people})

    with pytest.raises(ValidationError, match=r"crm\.households\.0\n.*people: .*one Primary"):
        read_world(path)


def test_the_committed_json_schema_matches_the_models() -> None:
    # The TypeScript seed validates the world file against this file, so it must not drift.
    # Regenerate it with `pnpm --filter custodian world:schema`.
    assert json.loads(SCHEMA_PATH.read_text()) == world_json_schema()
