import { readFileSync } from "node:fs";
import {
  ACCOUNT_ROLES,
  REGISTRATION_TYPES,
  RELATIONSHIP_STATUSES,
} from "@repo/db/schema/households";
import { z } from "zod";
import { InvalidWorldError, parseWorld } from "./world";

const WORLD = new URL("../../../world/", import.meta.url);
const readJson = (path: string): unknown => JSON.parse(readFileSync(new URL(path, WORLD), "utf8"));

type Enum = { enum: string[] };
const schema: {
  $defs: {
    RegistrationType: Enum;
    Household: { properties: { relationship_status: Enum } };
    AccountRole: { properties: { role: Enum } };
  };
} = JSON.parse(readFileSync(new URL("schema.json", WORLD), "utf8"));
// The committed schema on its own, without the cross-field rules `parseWorld` adds.
const schemaOnly = z.fromJSONSchema(schema);
const schemaAlone = (json: unknown) => schemaOnly.safeParse(json).success;

// Each file breaks one rule (world/invalid/cases.json); the custodian's tests read the same list.
const cases: { file: string; field: string; caught_by: "schema" | "rules" }[] = JSON.parse(
  readFileSync(new URL("invalid/cases.json", WORLD), "utf8"),
);

describe("parseWorld", () => {
  it("accepts world v0", () => {
    const world = parseWorld(readJson("v0.json"));

    expect(world.crm.firm.name).toBe("Larkspur Wealth Partners");
    expect(world.crm.households.map((h) => h.primary.key)).toEqual(["dana-reyes"]);
  });

  it.each(cases)("rejects $file, naming $field ($caught_by)", ({ file, field, caught_by }) => {
    // The committed schema on its own lets exactly the "rules" cases through.
    expect(schemaAlone(readJson(`invalid/${file}`))).toBe(caught_by === "rules");

    const parse = () => parseWorld(readJson(`invalid/${file}`));

    expect(parse).toThrow(InvalidWorldError);
    expect(parse).toThrow(
      expect.objectContaining({
        field,
        message: expect.stringMatching(new RegExp(`^${field.replaceAll(".", "\\.")}: `)),
      }),
    );
  });

  it("allows the values the tables accept, and no others", () => {
    const { $defs } = schema;

    // From the Custodian's contract, whose enum order differs (Zod lists '529' first).
    expect(new Set($defs.RegistrationType.enum)).toEqual(new Set(REGISTRATION_TYPES));
    expect($defs.Household.properties.relationship_status.enum).toEqual([...RELATIONSHIP_STATUSES]);
    expect($defs.AccountRole.properties.role.enum).toEqual([...ACCOUNT_ROLES]);
  });

  it("fills in the defaults the schema gives", () => {
    const world = parseWorld({
      version: 0,
      custodian: { accounts: [] },
      crm: {
        firm: { name: "Larkspur Wealth Partners" },
        households: [
          {
            key: "solo",
            name: "Solo",
            relationship_status: "prospect",
            primary: {
              key: "sam",
              first_name: "Sam",
              last_name: "Solo",
              born_on: "1990-01-01",
              joined_on: "2026-01-02",
            },
          },
        ],
      },
    });

    expect(world.crm.households[0]).toMatchObject({
      co_client: null,
      dependents: [],
      primary: { account_roles: [] },
    });
  });

  it("rejects a date that isn't one", () => {
    const world = parseWorld(readJson("v0.json"));
    world.crm.households[0]!.primary.born_on = "1978-02-30";

    expect(() => parseWorld(world)).toThrow(
      expect.objectContaining({ field: "crm.households.0.primary.born_on" }),
    );
  });
});
