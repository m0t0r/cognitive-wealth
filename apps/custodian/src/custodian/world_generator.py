"""The world generator: a seed in, a world file out (docs/product.md, "The synthetic world").

So far it writes Households and their People, with ages from simple ranges. #52 adds Accounts, and
#53 replaces the ranges with distributions tuned to the Survey of Consumer Finances.

The file is committed, as `world/generated.json`, because Cognitive Wealth's TypeScript seed reads
it and can't run Python to make it. A test fails when the file and the generator disagree.

Three rules keep one seed giving one world, byte for byte:

- **No "now".** Ages count from `AGES_COUNT_FROM`, never today, or the world would change overnight.
- **Random numbers come from `sampling.py`**, whose helpers stay the same across Python versions.
- **Each Household has its own stream.** Drawing more numbers for one Household, as #52 will for
  Accounts, leaves everyone else alone. That matters: the seed refuses a Person who changes
  (`SeedConflict`), so People who shift by accident would stop a database reseeding. The day a
  Household's adults joined has a stream of its own too, so it moves nobody else's numbers.

How many Households have each life stage and Relationship status is fixed, and only who gets which
is random. Drawing each one separately could leave a seed with no Prospects at all.
"""

import json
import random
from collections import Counter
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Literal

from custodian.cli import CliError, Command, Cta, Done, Options, Output
from custodian.sampling import between, chance, pick, shuffled, stream
from custodian.world import (
    WORLD_GENERATED_PATH,
    CrmHalf,
    CustodianHalf,
    Firm,
    Household,
    Person,
    WorldFile,
)

__all__ = ["AGES_COUNT_FROM", "COMMAND", "DEFAULT_SEED", "generate_world", "main", "world_text"]

DEFAULT_SEED = 1
"""The seed behind the committed world file."""

AGES_COUNT_FROM = date(2026, 8, 31)
"""Everyone's age is counted on this day, the last day of the pinned market history (ADR 0019). It
stays fixed when the Pin moves, since changing it would change every Person."""


@dataclass(frozen=True)
class _LifeStage:
    """A stage of life a Household's Primary is in (docs/product.md). It decides their age and
    their Dependents, and isn't written to the file: `born_on` carries it."""

    household_count: int
    youngest: int
    oldest: int
    most_dependents: int


# The ranges #53 replaces. The gap between 64 and 73 is deliberate for now: docs/product.md names
# these three stages, and the third starts where RMDs do. Everyone 73 or older on AGES_COUNT_FROM
# was born by 1953, and RMDs start at 73 for people born in 1951 through 1958, and earlier for
# people born before that (26 U.S.C. 401(a)(9)(C)(v), docs/learn/02-account-types.md).
_LIFE_STAGES = (
    # Young high earners
    _LifeStage(household_count=18, youngest=28, oldest=44, most_dependents=3),
    # Pre-retirees
    _LifeStage(household_count=20, youngest=45, oldest=64, most_dependents=2),
    # Retirees taking RMDs
    _LifeStage(household_count=22, youngest=73, oldest=90, most_dependents=0),
)

type _RelationshipStatus = Literal["prospect", "client", "former_client"]

_STATUS_COUNTS: dict[_RelationshipStatus, int] = {"prospect": 4, "client": 52, "former_client": 4}
"""These add up to the life stages' Households; `generate_world`'s `zip` fails if they don't."""

_CO_CLIENT_CHANCE = 0.7
_CO_CLIENT_SHARES_LAST_NAME_CHANCE = 0.8
_CO_CLIENT_MOST_YEARS_APART = 6
_YOUNGEST_ADULT_AT_FIRST_CHILD = 20
_OLDEST_DEPENDENT = 22
"""Old enough to be a student a parent still supports: this slice's simple choice, not a rule."""
_JOINED_FEWEST_DAYS_BEFORE = 365
_JOINED_MOST_DAYS_BEFORE = 5 * 365
"""When a Household's adults joined it, counted back from `AGES_COUNT_FROM`. The earliest is the
start of the world's five years of history (docs/product.md). The latest leaves a year, because a
membership doesn't count before it starts: the overview would hide a Person from any As-of date
before they joined. A simple range, like the ages, not a finding about real Households."""

_FIRM = Firm(name="Larkspur Wealth Partners")
"""The Firm `cw db seed` makes, which refuses a world naming any other."""

# Made-up pairings from common names, with plain ASCII and one word each, so a name makes a clean
# key. There must be at least as many last names as Households, and no "Reyes": that's the
# hand-written Household in world/v0.json.
_LAST_NAMES = (
    "Abara", "Adeyemi", "Ahmed", "Alvarez", "Andersen", "Banerjee", "Barnes", "Becker", "Bennett",
    "Bianchi", "Brooks", "Castillo", "Chen", "Clarke", "Cohen", "Delgado", "Dubois", "Dunn",
    "Eriksson", "Farah", "Fischer", "Fontaine", "Fraser", "Garcia", "Goldberg", "Greene", "Gupta",
    "Haddad", "Hansen", "Hayes", "Herrera", "Horvat", "Ibrahim", "Ivanov", "Jensen", "Kapoor",
    "Kaur", "Keller", "Kim", "Kowalski", "Larsen", "Lee", "Lindqvist", "Lombardi", "Mbeki",
    "Mendoza", "Moreau", "Murphy", "Nakamura", "Nguyen", "Novak", "Oakes", "Osei", "Park",
    "Patel", "Petrov", "Quinn", "Rahman", "Rossi", "Sato", "Schmidt", "Shapiro", "Silva", "Singh",
    "Sullivan", "Tanaka", "Torres", "Tran", "Vargas", "Walsh", "Weber", "Yilmaz", "Zhang",
)  # fmt: skip

_FIRST_NAMES = (
    "Aaron", "Adele", "Aisha", "Alan", "Alice", "Amara", "Andre", "Anita", "Ben", "Bianca",
    "Carla", "Cedric", "Chloe", "Daniel", "Diana", "Elena", "Elias", "Emma", "Farid", "Felix",
    "Fiona", "Gabriel", "Grace", "Hannah", "Hassan", "Helen", "Hugo", "Imani", "Irene", "Isaac",
    "Jade", "James", "Julia", "Kai", "Karen", "Kenji", "Laila", "Leo", "Lucia", "Marcus", "Maria",
    "Maya", "Miles", "Nadia", "Naomi", "Nina", "Noah", "Omar", "Oscar", "Paul", "Priya", "Quincy",
    "Rachel", "Rafael", "Rosa", "Ruth", "Samir", "Sara", "Simon", "Sofia", "Tara", "Theo", "Tomas",
    "Uma", "Victor", "Vera", "Wei", "Wendy", "Yara", "Yusuf", "Zane", "Zoe",
)  # fmt: skip


def generate_world(seed: int) -> WorldFile:
    """The world `seed` gives, always the same one. `WorldFile` checks it as it's built, so a broken
    world raises here and is never written."""
    # One stream shares out the fixed numbers of each kind of Household, and gives each a surname
    # of its own, so the Households list never shows the same name twice.
    plan = stream(f"{seed}:plan")
    stages = shuffled(plan, [stage for stage in _LIFE_STAGES for _ in range(stage.household_count)])
    statuses: list[_RelationshipStatus] = shuffled(
        plan, [status for status, count in _STATUS_COUNTS.items() for _ in range(count)]
    )
    last_names = shuffled(plan, _LAST_NAMES)[: len(stages)]

    households = [
        _household(
            stream(f"{seed}:household:{number}"),
            number=number,
            stage=stage,
            status=status,
            last_name=last_name,
            # A stream of its own, not the Household's: one more draw there would change everyone
            # drawn after it, and the seed refuses a Person who changes.
            adults_joined_on=_adults_joined_on(stream(f"{seed}:household:{number}:joined")),
        )
        for number, (stage, status, last_name) in enumerate(
            zip(stages, statuses, last_names, strict=True), start=1
        )
    ]
    return WorldFile(
        version=0,
        custodian=CustodianHalf(accounts=[]),
        crm=CrmHalf(firm=_FIRM, households=households),
    )


def world_text(world: WorldFile) -> str:
    """The world file's bytes, as text. Fields stay in the models' order, so nothing depends on how
    a dict happened to be built."""
    return json.dumps(world.model_dump(mode="json"), indent=2) + "\n"


def _household(
    rng: random.Random,
    *,
    number: int,
    stage: _LifeStage,
    status: _RelationshipStatus,
    last_name: str,
    adults_joined_on: date,
) -> Household:
    """One Household. `number` goes in every key: surnames can repeat among Co-clients and first
    names among Households, and the world file refuses a repeated key."""
    suffix = f"{number:02d}"
    # Taken without putting back, so no two People in a Household share a first name.
    first_names = shuffled(rng, _FIRST_NAMES)

    def person(*, last: str, age: int) -> Person:
        first = first_names.pop()
        born_on = _born_on(rng, age=age)
        return Person(
            key=f"{first}-{last}-{suffix}".lower(),
            first_name=first,
            last_name=last,
            born_on=born_on,
            # Someone born after the Household's adults joined joins the day they're born.
            joined_on=max(adults_joined_on, born_on),
        )

    primary_age = between(rng, low=stage.youngest, high=stage.oldest)
    primary = person(last=last_name, age=primary_age)

    co_client = None
    younger_adult_age = primary_age
    if chance(rng, _CO_CLIENT_CHANCE):
        co_client_age = primary_age + between(
            rng, low=-_CO_CLIENT_MOST_YEARS_APART, high=_CO_CLIENT_MOST_YEARS_APART
        )
        younger_adult_age = min(primary_age, co_client_age)
        shares_last_name = chance(rng, _CO_CLIENT_SHARES_LAST_NAME_CHANCE)
        co_client = person(
            last=last_name if shares_last_name else pick(rng, _LAST_NAMES), age=co_client_age
        )

    oldest_dependent = min(_OLDEST_DEPENDENT, younger_adult_age - _YOUNGEST_ADULT_AT_FIRST_CHILD)
    dependents = [
        person(last=last_name, age=between(rng, low=0, high=oldest_dependent))
        for _ in range(between(rng, low=0, high=stage.most_dependents))
    ]

    return Household(
        key=f"{last_name.lower()}-{suffix}",
        name=f"The {last_name} Household",
        relationship_status=status,
        primary=primary,
        co_client=co_client,
        dependents=dependents,
    )


def _born_on(rng: random.Random, *, age: int) -> date:
    """A birthday that makes someone exactly `age` on `AGES_COUNT_FROM`: on the date itself `age`
    years back, or up to 364 days before that, since a year holds at least 365 days."""
    latest = AGES_COUNT_FROM.replace(year=AGES_COUNT_FROM.year - age)
    return latest - timedelta(days=between(rng, low=0, high=364))


def _adults_joined_on(rng: random.Random) -> date:
    """The day a Household's Primary and Co-client joined it, a fixed date like everything else
    here: counted from `AGES_COUNT_FROM`, never today."""
    days_before = between(rng, low=_JOINED_FEWEST_DAYS_BEFORE, high=_JOINED_MOST_DAYS_BEFORE)
    return AGES_COUNT_FROM - timedelta(days=days_before)


class WorldGenerateOptions(Options):
    seed: int = DEFAULT_SEED
    """The seed: the same one always writes the same bytes"""
    out: Path = WORLD_GENERATED_PATH
    """Where to write the world file"""
    dry_run: bool = False
    """Generate and check the world, writing nothing"""


class WorldGenerateOutput(Output):
    dry_run: bool
    seed: int
    out: Path
    """The world file (with --dry-run, where it would go)"""
    households: int
    prospects: int
    clients: int
    former_clients: int
    people: int


def _world_generate(options: WorldGenerateOptions) -> Done[WorldGenerateOutput]:
    world = generate_world(options.seed)
    if not options.dry_run:
        try:
            options.out.write_text(world_text(world))
        # OSError covers a folder that isn't there, a folder given as the file, and no permission.
        except OSError as error:
            raise CliError(
                code="invalid_input",
                message=f"Can't write the world file: {error}. Pick another --out",
            ) from None

    households = world.crm.households
    statuses = Counter(household.relationship_status for household in households)
    cta = (
        Cta(command="pnpm --filter custodian world:generate", description="Write it for real")
        if options.dry_run
        else Cta(
            command=f"pnpm cw db seed --world {options.out}",
            description="Load its Households and People into the local database",
        )
    )
    return Done(
        WorldGenerateOutput(
            dry_run=options.dry_run,
            seed=options.seed,
            out=options.out,
            households=len(households),
            prospects=statuses["prospect"],
            clients=statuses["client"],
            former_clients=statuses["former_client"],
            people=sum(len(list(household.people())) for household in households),
        ),
        cta=[cta],
    )


COMMAND = Command(
    name="world:generate",
    description=(
        "Write the generated world file from a seed: about 60 Households and their People, the same"
        " bytes for the same seed"
    ),
    options=WorldGenerateOptions,
    output=WorldGenerateOutput,
    run=_world_generate,
)

main = COMMAND.main


if __name__ == "__main__":
    raise SystemExit(main())
