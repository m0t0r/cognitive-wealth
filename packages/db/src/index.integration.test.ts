import { ping } from "./index";
import { test } from "./testing";

describe("ping", () => {
  test("resolves against a reachable database", async ({ orm }) => {
    await expect(ping(orm)).resolves.toBeUndefined();
  });
});
