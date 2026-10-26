// `pnpm cw <group> <command>`: the entry Node runs directly (type stripping), so relative imports
// keep their `.ts` extension. Modules that import the schema are bundler-style and load after
// `registerTsResolution()`, which is why the app is imported only once it has run. Every package
// is imported dynamically, so a missing one (an uninstalled checkout) still fails as JSON with
// `--json` (`startupFailure`), not only as Node's error on stderr.
import { startupFailure } from "./startup.ts";

const argv = process.argv.slice(2);
let app: typeof import("./app.ts");
try {
  const { registerTsResolution } = await import("@repo/db/cli/ts-resolution");
  registerTsResolution();
  app = await import("./app.ts");
} catch (error) {
  const printed = startupFailure({ error, argv });
  if (printed === undefined) throw error;
  console.log(printed);
  process.exit(1);
}

await app.createCli().serve(app.withoutSeparator(argv));
