// The world file (docs/product.md, "The synthetic world"), as the seed reads it. Its format is
// `apps/custodian/src/custodian/world.py`'s models; `world/schema.json` is generated from them, so
// this side checks the same file without Python. The schema checks each field on its own; the
// few rules that need the whole file at once are repeated here from `WorldFile`'s validator, with
// the same paths, and `world/invalid/` holds a file breaking each one for both sides' tests.
import { readFileSync } from "node:fs";
import type {
  AccountRoleKind,
  HouseholdRole,
  RegistrationType,
  RelationshipStatus,
} from "@repo/db/schema/households";
import { z } from "zod";

// The parsed file's types, written by hand from `world/schema.json`. `world.test.ts` checks that
// the schema's enums are the values the tables accept.

export interface WorldAccountRole {
  account_number: string;
  role: AccountRoleKind;
  starts_on: string;
}

export interface WorldPerson {
  key: string;
  first_name: string;
  last_name: string;
  born_on: string;
  joined_on: string;
  account_roles: WorldAccountRole[];
}

export interface WorldHousehold {
  key: string;
  name: string;
  relationship_status: RelationshipStatus;
  primary: WorldPerson;
  co_client: WorldPerson | null;
  dependents: WorldPerson[];
}

export interface World {
  version: 0;
  custodian: {
    accounts: {
      account_number: string;
      registration_type: RegistrationType;
      opened_on: string;
    }[];
  };
  crm: { firm: { name: string }; households: WorldHousehold[] };
}

/** A world file that breaks the schema or a cross-field rule. `field` is the bad field's path. */
export class InvalidWorldError extends Error {
  readonly field: string;

  constructor(field: string, problem: string) {
    super(`${field}: ${problem}`);
    this.name = "InvalidWorldError";
    this.field = field;
  }
}

// The committed schema as Zod, which fills in what it defaults (`co_client`, `dependents`,
// `account_roles`), so a parsed World always has them. `fromJSONSchema` can't know the output's
// type, so `z.custom` names it; it checks nothing, the schema already has.
// It's read rather than imported because a JSON import widens `"type": "string"` to `string`,
// which Zod's `JSONSchema` type rejects.
const schema: z.core.JSONSchema.JSONSchema = JSON.parse(
  readFileSync(new URL("../../../world/schema.json", import.meta.url), "utf8"),
);
const worldSchema = z.fromJSONSchema(schema).pipe(z.custom<World>());

/**
 * `json` as a World, or an `InvalidWorldError` naming the first bad field the way the custodian's
 * Pydantic models do (`custodian.accounts.1.registration_type`, counting from 0).
 */
export function parseWorld(json: unknown): World {
  const parsed = worldSchema.safeParse(json);
  if (!parsed.success) throw schemaError(parsed.error.issues[0]!);
  checkRules(parsed.data);
  return parsed.data;
}

function schemaError(issue: z.core.$ZodIssue): InvalidWorldError {
  const path = issue.path.map(String);
  // Zod reports an unknown field against the object that holds it.
  if (issue.code === "unrecognized_keys") {
    return new InvalidWorldError([...path, issue.keys[0]!].join("."), "isn't a known field");
  }
  return new InvalidWorldError(path.join("."), issue.message);
}

/** Each Person in `household` with the path of their field, such as "co_client" or "dependents.0". */
export function* householdPeople(
  household: WorldHousehold,
): Generator<[field: string, person: WorldPerson, role: HouseholdRole]> {
  yield ["primary", household.primary, "primary"];
  if (household.co_client) yield ["co_client", household.co_client, "co_client"];
  for (const [index, dependent] of household.dependents.entries()) {
    yield [`dependents.${index}`, dependent, "dependent"];
  }
}

// `WorldFile._keys_and_references_fit_together` in world.py, with the same paths and messages.
function checkRules(world: World) {
  const accountNumbers = new Set<string>();
  for (const [index, { account_number }] of world.custodian.accounts.entries()) {
    if (accountNumbers.has(account_number)) {
      throw new InvalidWorldError(
        `custodian.accounts.${index}.account_number`,
        `'${account_number}' is already an Account`,
      );
    }
    accountNumbers.add(account_number);
  }

  const householdKeys = new Set<string>();
  const personKeys = new Set<string>();
  for (const [householdIndex, household] of world.crm.households.entries()) {
    const where = `crm.households.${householdIndex}`;
    if (householdKeys.has(household.key)) {
      throw new InvalidWorldError(`${where}.key`, `'${household.key}' is already a Household`);
    }
    householdKeys.add(household.key);
    for (const [field, person] of householdPeople(household)) {
      if (personKeys.has(person.key)) {
        throw new InvalidWorldError(`${where}.${field}.key`, `'${person.key}' is already a Person`);
      }
      personKeys.add(person.key);
      for (const [roleIndex, role] of person.account_roles.entries()) {
        if (!accountNumbers.has(role.account_number)) {
          throw new InvalidWorldError(
            `${where}.${field}.account_roles.${roleIndex}.account_number`,
            `'${role.account_number}' isn't an Account in the custodian half`,
          );
        }
      }
    }
  }
}
