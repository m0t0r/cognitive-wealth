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
"""

import json
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, model_validator

from custodian.models import RegistrationType

__all__ = [
    "SCHEMA_PATH",
    "WORLD_V0_PATH",
    "AccountRole",
    "CustodianAccount",
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
"""World v0, written by hand: one Household, until the generator (slices 21 to 23) exists."""
SCHEMA_PATH = _WORLD / "schema.json"


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


class Person(_Strict):
    key: str
    """Names the Person within the world file, such as "dana-reyes"."""
    first_name: str
    last_name: str
    born_on: date
    role: Literal["primary", "co_client", "dependent"]


class AccountRole(_Strict):
    """A dated link between a Person and an Account (GLOSSARY.md, "Account role")."""

    person: str
    """A `Person.key` in the same Household."""
    account_number: str
    """An Account in the custodian half."""
    role: Literal["owner", "joint_owner", "custodian", "beneficiary", "power_of_attorney"]
    starts_on: date


class Household(_Strict):
    """The People a Firm serves together, and the Accounts they are linked to."""

    key: str
    name: str
    relationship_status: Literal["prospect", "client", "former_client"]
    people: list[Person]
    account_roles: list[AccountRole]

    # Field types catch a bad value in one field. Rules across fields, such as "one Primary", go in
    # a validator that runs after the fields are parsed, and gets the whole model as `self`.
    @model_validator(mode="after")
    def _people_and_roles_fit_together(self) -> Self:
        if sum(person.role == "primary" for person in self.people) != 1:
            raise ValueError("people: a Household has exactly one Primary")
        keys = Counter(person.key for person in self.people)
        if repeated := [key for key, count in keys.items() if count > 1]:
            raise ValueError(f"people: each key is used once, but {repeated[0]!r} repeats")
        for index, role in enumerate(self.account_roles):
            if role.person not in keys:
                raise ValueError(
                    f"account_roles.{index}.person: {role.person!r} isn't a Person in this"
                    " Household"
                )
        return self


class CrmHalf(_Strict):
    firm: Firm
    households: list[Household]


class WorldFile(_Strict):
    version: Literal[0]
    """The format's version. A change that breaks old files bumps it."""
    custodian: CustodianHalf
    crm: CrmHalf

    # Only the whole file sees both halves, so the check that joins them lives here. Its message
    # spells out the field's path, since an error raised here is reported against the whole file.
    @model_validator(mode="after")
    def _account_roles_name_custodian_accounts(self) -> Self:
        numbers = Counter(account.account_number for account in self.custodian.accounts)
        if repeated := [number for number, count in numbers.items() if count > 1]:
            raise ValueError(f"custodian.accounts: account {repeated[0]!r} is listed twice")
        for h, household in enumerate(self.crm.households):
            for r, role in enumerate(household.account_roles):
                if role.account_number not in numbers:
                    raise ValueError(
                        f"crm.households.{h}.account_roles.{r}.account_number:"
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
