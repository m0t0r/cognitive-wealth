import { join } from "node:path";

// Kept apart from `config.ts`: the app bundles that one, and bundlers don't provide `import.meta.dirname`.
export const migrationsFolder = join(import.meta.dirname, "../migrations");
