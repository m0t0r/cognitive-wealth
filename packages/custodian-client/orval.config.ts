import { join } from "node:path";
import { defineConfig, type Options } from "orval";

/**
 * The custodian's contract (ADR 0011) as Orval generates it into `directory`: a `fetch` client
 * for its routes, and a Zod schema for every component, the Custodian feed's rows and Manifest
 * included, though no route returns them. `generated.test.ts` generates into a temporary
 * directory with the same options and compares, so src/generated/ can't drift.
 */
export function custodianClient(directory: string): Options {
  return {
    input: { target: join(import.meta.dirname, "../../apps/custodian/openapi.json") },
    output: {
      target: join(directory, "client.ts"),
      client: "fetch",
      schemas: { path: join(directory, "schemas"), type: "zod", mode: "single" },
      clean: true,
      // Every request URL starts with `custodianUrl()`, read when the request is made, so the
      // same code reaches the custodian wherever CUSTODIAN_URL says it runs.
      baseUrl: {
        runtime: "custodianUrl()",
        imports: [{ name: "custodianUrl", importPath: "../base-url.ts" }],
      },
      override: {
        // `z.strictObject`: a field the contract doesn't name is an error, as `extra="forbid"`
        // makes it in Python. Orval reads the component schemas' setting from `body`.
        zod: { strict: { body: true, response: true } },
        // Every response is parsed with its Zod schema, so nothing from the custodian is trusted.
        fetch: { runtimeValidation: true },
        // The wire stays snake_case, as Python and the feed's CSV headers name things. Each Zod
        // schema checks the snake_case keys, then renames them: `zod.input` (the `PositionRow`
        // type) is what arrives, `zod.output` (`PositionRowOutput`) is what our code uses.
        // Request bodies aren't renamed back: a function that sends one takes the snake_case
        // input type.
        namingConvention: { properties: "camelCase" },
      },
    },
  };
}

export default defineConfig({
  custodian: custodianClient(join(import.meta.dirname, "src/generated")),
});
