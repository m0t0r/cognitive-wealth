import { registerHooks } from "node:module";

const RELATIVE = /^\.\.?\//;
const HAS_EXTENSION = /\.[cm]?[jt]sx?$/;

/**
 * Lets Node run modules written for the bundler, such as `src/schema/*`, whose relative imports
 * have no extension: a relative specifier that doesn't resolve is retried with `.ts`. Call it at
 * the top of a CLI entry, then load those modules with `await import()`, because static imports
 * resolve before any code in the entry runs.
 */
export function registerTsResolution() {
  registerHooks({
    // oxlint-disable-next-line max-params -- Node's `registerHooks` resolve hook `(specifier, context, nextResolve)`
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        const notFound =
          error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND";
        if (!notFound || !RELATIVE.test(specifier) || HAS_EXTENSION.test(specifier)) throw error;
        return nextResolve(`${specifier}.ts`, context);
      }
    },
  });
}
