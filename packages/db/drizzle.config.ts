import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  // One file per table family; drizzle-kit reads every file in the folder.
  schema: "./src/schema",
  out: "./migrations",
  strict: true,
  verbose: true,
  // Only `drizzle-kit studio` connects; `generate` works offline. Migrations run via `src/migrate.ts`.
  ...(url && { dbCredentials: { url } }),
});
