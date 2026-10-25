import { readFileSync } from "node:fs";
import { InvalidWorldError, parseWorld } from "./world";

const WORLD = new URL("../../../world/", import.meta.url);
const readJson = (path: string): unknown => JSON.parse(readFileSync(new URL(path, WORLD), "utf8"));

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

  it.each(cases)("rejects $file, naming $field ($caught_by)", ({ file, field }) => {
    const parse = () => parseWorld(readJson(`invalid/${file}`));

    expect(parse).toThrow(InvalidWorldError);
    expect(parse).toThrow(
      expect.objectContaining({
        field,
        message: expect.stringMatching(new RegExp(`^${field.replaceAll(".", "\\.")}: `)),
      }),
    );
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
            primary: { key: "sam", first_name: "Sam", last_name: "Solo", born_on: "1990-01-01" },
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
