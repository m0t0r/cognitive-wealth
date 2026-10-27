import json
from pathlib import Path
from typing import Literal

import pytest
from jsonschema import Draft202012Validator, validate
from jsonschema.exceptions import ValidationError as SchemaError
from pydantic import BaseModel, ValidationError

from custodian.load import main as world_load
from custodian.models import RegistrationType
from custodian.world import (
    INVALID_WORLDS_PATH,
    SCHEMA_PATH,
    WORLD_V0_PATH,
    read_world,
    world_json_schema,
)


class InvalidWorld(BaseModel):
    """One entry of world/invalid/cases.json, which the TypeScript seed's tests read too."""

    file: str
    field: str
    """The path of the bad field, which the error must name."""
    caught_by: Literal["schema", "rules"]
    """"schema" if world/schema.json rejects it; "rules" if only the cross-field rules do."""


def invalid_worlds() -> list[InvalidWorld]:
    cases = json.loads((INVALID_WORLDS_PATH / "cases.json").read_text())
    return [InvalidWorld.model_validate(case) for case in cases]


def test_world_v0_has_one_household_with_a_joint_account_and_an_ira() -> None:
    world = read_world(WORLD_V0_PATH)

    [household] = world.crm.households
    assert household.primary.key == "dana-reyes"
    assert household.co_client is not None
    assert household.co_client.key == "jordan-reyes"
    assert [account.registration_type for account in world.custodian.accounts] == [
        RegistrationType.JOINT,
        RegistrationType.TRADITIONAL_IRA,
    ]
    assert [(role.account_number, role.role) for role in household.primary.account_roles] == [
        ("CW-000001", "joint_owner"),
        ("CW-000002", "owner"),
    ]
    assert [(role.account_number, role.role) for role in household.co_client.account_roles] == [
        ("CW-000001", "joint_owner"),
        ("CW-000002", "beneficiary"),
    ]


# `ids=` names each case in pytest's output after its file, instead of "case0", "case1", ….
@pytest.mark.parametrize("case", invalid_worlds(), ids=lambda case: case.file)
def test_each_invalid_world_is_rejected_naming_the_bad_field(case: InvalidWorld) -> None:
    with pytest.raises(ValidationError) as caught:
        read_world(INVALID_WORLDS_PATH / case.file)

    assert case.field in str(caught.value)


@pytest.mark.parametrize("case", invalid_worlds(), ids=lambda case: case.file)
def test_the_json_schema_catches_exactly_the_shape_errors(case: InvalidWorld) -> None:
    # What the TypeScript seed gets from world/schema.json alone. The "rules" cases pass it, so
    # the seed has to check those rules itself, and its tests run these same files.
    schema = json.loads(SCHEMA_PATH.read_text())
    world = json.loads((INVALID_WORLDS_PATH / case.file).read_text())

    if case.caught_by == "schema":
        with pytest.raises(SchemaError):
            validate(world, schema, cls=Draft202012Validator)
    else:
        validate(world, schema, cls=Draft202012Validator)


def test_every_invalid_world_file_is_listed() -> None:
    files = {path.name for path in INVALID_WORLDS_PATH.glob("*.json")} - {"cases.json"}

    assert files == {case.file for case in invalid_worlds()}


def test_the_committed_json_schema_matches_the_models() -> None:
    # The TypeScript seed validates the world file against this file, so it must not drift.
    # Regenerate it with `pnpm --filter custodian world:schema`.
    assert json.loads(SCHEMA_PATH.read_text()) == world_json_schema()


def test_world_v0_passes_the_committed_json_schema() -> None:
    # What the TypeScript seed will do with the same two files.
    schema = json.loads(SCHEMA_PATH.read_text())

    validate(json.loads(WORLD_V0_PATH.read_text()), schema, cls=Draft202012Validator)


def test_world_load_names_the_bad_field_and_loads_nothing(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    world = json.loads(WORLD_V0_PATH.read_text())
    world["custodian"]["accounts"][1]["registration_type"] = "brokerage"
    path = tmp_path / "world.json"
    path.write_text(json.dumps(world))

    # It stops before connecting: the test environment has no DATABASE_URL to connect with.
    exit_code = world_load(["--world", str(path), "--json"])

    assert exit_code == 1
    error = json.loads(capsys.readouterr().out)
    assert error["code"] == "malformed_input"
    assert "custodian.accounts.1.registration_type" in error["message"]
