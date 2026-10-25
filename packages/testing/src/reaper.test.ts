import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reaperImage } from "./reaper";

const RYUK = "testcontainers/ryuk:0.14.0@sha256:aaaa";

function dockerfile(contents: string) {
  const file = join(mkdtempSync(join(tmpdir(), "reaper-")), "Dockerfile");
  writeFileSync(file, contents);
  return file;
}

describe("reaperImage", () => {
  it("reads the image from the pin file's FROM line, past its comments", () => {
    const file = dockerfile(`# Never built.\n# FROM in a comment: ignored\nFROM ${RYUK}\n`);

    expect(reaperImage({ file })).toBe(RYUK);
  });

  it("refuses an image pinned by tag alone", () => {
    const file = dockerfile("FROM testcontainers/ryuk:0.14.0\n");

    expect(() => reaperImage({ file })).toThrow("must pin testcontainers/ryuk by tag@digest");
  });

  it("refuses a file with no FROM line", () => {
    const file = dockerfile("# empty\n");

    expect(() => reaperImage({ file })).toThrow("must pin testcontainers/ryuk by tag@digest");
  });

  it("reads the repo's pin by default", () => {
    expect(reaperImage()).toMatch(/^testcontainers\/ryuk:[^@\s]+@sha256:[0-9a-f]{64}$/);
  });
});
