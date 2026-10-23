import { assertSeedTarget } from "./seed-data";

describe("assertSeedTarget", () => {
  it.for([
    "postgres://app@localhost:5432/cognitive_wealth",
    "postgres://app@LOCALHOST/cognitive_wealth",
    "postgresql://app@127.0.0.1:5432/cognitive_wealth",
    "postgres://app@[::1]:5432/cognitive_wealth",
    "postgres://app@db.localhost/cognitive_wealth",
    "postgres://app@localhost./cognitive_wealth",
  ])("allows %s", (url) => {
    expect(() => assertSeedTarget(url, "development")).not.toThrow();
    expect(() => assertSeedTarget(url, undefined)).not.toThrow();
  });

  it.for([
    "postgres://app@db.example.com/cognitive_wealth",
    "postgres://app@10.0.0.5:5432/cognitive_wealth",
    "postgres://app@127.0.0.2/cognitive_wealth",
    "postgres://app@localhost.example.com/cognitive_wealth",
    "postgres://app@localhost,db.example.com/cognitive_wealth",
    // URL reads the host after the last `@`, postgres.js after the first.
    "postgres://app@db.example.com,x@localhost/cognitive_wealth",
    "postgres://app@db.example.com%2Cx@localhost/cognitive_wealth",
    "postgres://app@[2001:db8::1]/cognitive_wealth",
  ])("refuses the non-local host in %s", (url) => {
    expect(() => assertSeedTarget(url, "development")).toThrow(/isn't local/);
  });

  // postgres.js decodes `%2C` to a comma and tries each host in the list.
  it("refuses an encoded host list that ends in .localhost", () => {
    expect(() =>
      assertSeedTarget("postgres://app@db.example.com%2C.localhost/cw", "development"),
    ).toThrow(/isn't local/);
  });

  it("refuses a missing or invalid DATABASE_URL", () => {
    expect(() => assertSeedTarget(undefined, "development")).toThrow(/DATABASE_URL is not set/);
    expect(() => assertSeedTarget("not a url", "development")).toThrow(/not a valid URL/);
  });

  it("refuses NODE_ENV=production even on localhost", () => {
    expect(() =>
      assertSeedTarget("postgres://app@localhost:5432/cognitive_wealth", "production"),
    ).toThrow(/NODE_ENV is production/);
  });
});
