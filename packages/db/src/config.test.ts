import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectionUrl } from "./config.ts";

describe("connectionUrl", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "db-config-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const secret = (password: string) => {
    const file = join(dir, "db_app_password");
    writeFileSync(file, `${password}\n`);
    return file;
  };

  it("is undefined without DATABASE_URL", () => {
    expect(connectionUrl({})).toBeUndefined();
  });

  it("is DATABASE_URL as it is without a password file", () => {
    expect(connectionUrl({ DATABASE_URL: "postgres://app@localhost:5432/cognitive_wealth" })).toBe(
      "postgres://app@localhost:5432/cognitive_wealth",
    );
  });

  it("puts the password file's contents into the URL, escaped", () => {
    const url = connectionUrl({
      DATABASE_URL: "postgres://app@localhost:5432/cognitive_wealth",
      DATABASE_PASSWORD_FILE: secret("p@ss:w/rd"),
    });

    expect(url).toBe("postgres://app:p%40ss%3Aw%2Frd@localhost:5432/cognitive_wealth");
    expect(decodeURIComponent(new URL(url!).password)).toBe("p@ss:w/rd");
  });

  it("prefers the password file to a password already in the URL", () => {
    expect(
      connectionUrl({
        DATABASE_URL: "postgres://app:old@localhost:5432/cognitive_wealth",
        DATABASE_PASSWORD_FILE: secret("new"),
      }),
    ).toBe("postgres://app:new@localhost:5432/cognitive_wealth");
  });
});
