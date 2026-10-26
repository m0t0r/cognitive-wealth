import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { takeKeyFile } from "./api-key.ts";

describe("takeKeyFile", () => {
  it("reads the key, deletes the file and drops the variable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "api-key-"));
    try {
      const path = join(dir, "key");
      await writeFile(path, "sk-ant-test\n");
      const env: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY_FILE: path };

      expect(await takeKeyFile(env)).toBe("sk-ant-test");
      await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
      expect(env).toEqual({});
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is undefined without ANTHROPIC_API_KEY_FILE", async () => {
    expect(await takeKeyFile({})).toBeUndefined();
  });
});
