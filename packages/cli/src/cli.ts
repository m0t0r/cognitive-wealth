// `pnpm cw <group> <command>`: the entry Node runs directly (type stripping), so relative imports
// keep their `.ts` extension. Modules that import the schema are bundler-style and load after
// `registerTsResolution()`, which is why the app is imported only once it has run.
import { registerTsResolution } from "@repo/db/cli/ts-resolution";

registerTsResolution();
const { createCli, withoutSeparator } = await import("./app.ts");

await createCli().serve(withoutSeparator(process.argv.slice(2)));
