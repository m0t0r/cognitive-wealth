import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeImage } from "./compose";

const POSTGRES = "postgres:18.6-alpine@sha256:aaaa";

function composeFile(contents: string) {
  const file = join(mkdtempSync(join(tmpdir(), "compose-")), "compose.yaml");
  writeFileSync(file, contents);
  return file;
}

describe("composeImage", () => {
  it("returns the pinned image for a repository", () => {
    const file = composeFile(`services:\n  db:\n    image: ${POSTGRES}\n`);

    expect(composeImage("postgres", { file })).toBe(POSTGRES);
  });

  it("doesn't match a repository whose name only ends the same way", () => {
    const file = composeFile(
      `services:\n  mail:\n    image: axllent/mailpit:v1@sha256:bbbb\n  db:\n    image: ${POSTGRES}\n`,
    );

    expect(() => composeImage("mailpit", { file })).toThrow("compose.yaml has no mailpit image");
    expect(composeImage("axllent/mailpit", { file })).toBe("axllent/mailpit:v1@sha256:bbbb");
  });

  it("returns the image once when several services pin it alike", () => {
    const file = composeFile(
      `services:\n  db:\n    image: ${POSTGRES}\n  custodian-db:\n    image: ${POSTGRES}\n`,
    );

    expect(composeImage("postgres", { file })).toBe(POSTGRES);
  });

  it("refuses services that pin the same repository differently", () => {
    const file = composeFile(
      `services:\n  db:\n    image: ${POSTGRES}\n  custodian-db:\n    image: postgres:18.7-alpine@sha256:cccc\n`,
    );

    expect(() => composeImage("postgres", { file })).toThrow(
      "compose.yaml pins postgres differently",
    );
  });

  it("reads the repo's compose.yaml by default", () => {
    expect(composeImage("postgres")).toMatch(/^postgres:[^@\s]+@sha256:[0-9a-f]{64}$/);
  });
});
