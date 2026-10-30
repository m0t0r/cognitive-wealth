"""The world file: one synthetic world, read by two loaders (docs/product.md).

Its two halves never share a database. The custodian loads `custodian` (Accounts and their
numbers) into its own Postgres; Cognitive Wealth's seed loads `crm` (the Firm, Households, People
and Account roles) into its own. Account roles are the seam between them: each names an Account
by the custodian's account number.

Why one file and two loaders? Each side is the book of record for its own half (ADR 0009): the
custodian for Accounts and what happens in them, Cognitive Wealth for the relationship. A real
Custodian never writes into an advisor's CRM, so the simulated one doesn't either.

These models are the format. `world/schema.json`, generated from them by
`pnpm --filter custodian world:schema`, lets the TypeScript seed validate the same file without
Python, and a test fails when the two drift apart.

A JSON Schema checks each field on its own, so the format is shaped to make as many rules as it
can part of the shape: a Household has one `primary` field, so it can't have two Primaries, and
each Person holds their own Account roles, so a role can't name someone outside the Household.
The few rules left need the whole file at once (an Account role must name an Account in the
custodian half; keys and account numbers are unique), so only `WorldFile`'s validator checks
them. `world/invalid/` holds a file breaking each rule, which both loaders' tests must reject.
"""

import json
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, model_validator

from custodian.models import RegistrationType

__all__ = [
    "INVALID_WORLDS_PATH",
    "SCHEMA_PATH",
    "WORLD_GENERATED_PATH",
    "WORLD_V0_PATH",
    "AccountRole",
    "CrmHalf",
    "CustodianAccount",
    "CustodianHalf",
    "Firm",
    "Household",
    "Person",
    "WorldFile",
    "read_world",
    "world_json_schema",
]

# `__file__` is this file's path; `parents[4]` climbs src/custodian/, src/, apps/custodian/ and
# apps/ to the repo root.
_WORLD = Path(__file__).parents[4] / "world"
WORLD_V0_PATH = _WORLD / "v0.json"
"""World v0, written by hand: one Household. Everything reads it by default until #52 moves the
loaders to the generated world."""
WORLD_GENERATED_PATH = _WORLD / "generated.json"
"""The generated world, which `pnpm --filter custodian world:generate` writes. Households and
People so far: the Accounts come in #52, and nothing loads this file by default until then."""
SCHEMA_PATH = _WORLD / "schema.json"
INVALID_WORLDS_PATH = _WORLD / "invalid"
"""World files that each break one rule, listed in `cases.json` with the field to name."""


class _Strict(BaseModel):
    # A misspelt or unknown field is an error, not silently dropped, and a read world can't change.
    model_config = ConfigDict(extra="forbid", frozen=True)


# The custodian's half


class CustodianAccount(_Strict):
    account_number: str
    registration_type: RegistrationType
    opened_on: date


class CustodianHalf(_Strict):
    accounts: list[CustodianAccount]


# The CRM half


class Firm(_Strict):
    name: str


class AccountRole(_Strict):
    """A dated link between the Person who holds it and an Account (GLOSSARY.md, "Account role")."""

    account_number: str
    """An Account in the custodian half."""
    role: Literal["owner", "joint_owner", "custodian", "beneficiary", "power_of_attorney"]
    starts_on: date


class Person(_Strict):
    key: str
    """Names the Person across the whole world file, such as "dana-reyes"."""
    first_name: str
    last_name: str
    born_on: date
    account_roles: list[AccountRole] = []
    """How this Person is linked to Accounts. Pydantic copies a default list for each instance,
    so, unlike a plain Python default argument, it is never shared."""


class Household(_Strict):
    """The People a Firm serves together. Who leads is part of the shape (GLOSSARY.md):

    exactly one Primary, at most one Co-client, and any number of Dependents.
    """

    key: str
    name: str
    relationship_status: Literal["prospect", "client", "former_client"]
    primary: Person
    co_client: Person | None = None
    dependents: list[Person] = []

    def people(self) -> Iterator[tuple[str, Person]]:
        """Each Person with the path of their field, such as "co_client" or "dependents.0"."""
        yield "primary", self.primary
        if self.co_client is not None:
            yield "co_client", self.co_client
        for index, dependent in enumerate(self.dependents):
            yield f"dependents.{index}", dependent


class CrmHalf(_Strict):
    firm: Firm
    households: list[Household]


class WorldFile(_Strict):
    version: Literal[0]
    """The format's version. A change that breaks old files bumps it."""
    custodian: CustodianHalf
    crm: CrmHalf

    # Field types catch a bad value in one field. The rules below need the whole file at once, so
    # they run in a validator after every field is parsed, with the whole model as `self`. An
    # error raised here is reported against the whole file, so each message starts with the bad
    # field's path, as Pydantic writes it for a field error.
    @model_validator(mode="after")
    def _keys_and_references_fit_together(self) -> Self:
        account_numbers: set[str] = set()
        for index, account in enumerate(self.custodian.accounts):
            if account.account_number in account_numbers:
                raise ValueError(
                    f"custodian.accounts.{index}.account_number: {account.account_number!r} is"
                    " already an Account"
                )
            account_numbers.add(account.account_number)

        household_keys: set[str] = set()
        person_keys: set[str] = set()
        for household_index, household in enumerate(self.crm.households):
            where = f"crm.households.{household_index}"
            if household.key in household_keys:
                raise ValueError(f"{where}.key: {household.key!r} is already a Household")
            household_keys.add(household.key)
            for field, person in household.people():
                if person.key in person_keys:
                    raise ValueError(f"{where}.{field}.key: {person.key!r} is already a Person")
                person_keys.add(person.key)
                for role_index, role in enumerate(person.account_roles):
                    if role.account_number not in account_numbers:
                        raise ValueError(
                            f"{where}.{field}.account_roles.{role_index}.account_number:"
                            f" {role.account_number!r} isn't an Account in the custodian half"
                        )
        return self


def read_world(path: Path) -> WorldFile:
    """The world file at `path`, or a `ValidationError` naming each bad field.

    Pydantic names a field by its path, such as `custodian.accounts.1.registration_type`: the
    `registration_type` of the second Account (paths count from 0).
    """
    return WorldFile.model_validate_json(path.read_text())


def world_json_schema() -> dict[str, object]:
    """The JSON Schema that `world/schema.json` holds, generated from the models."""
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        **WorldFile.model_json_schema(),
    }


if __name__ == "__main__":
    # `pnpm --filter custodian world:schema`: rewrite world/schema.json from the models.
    SCHEMA_PATH.write_text(json.dumps(world_json_schema(), indent=2) + "\n")
