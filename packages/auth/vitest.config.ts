import { defineVitestConfig } from "@repo/testing/vitest";

export default defineVitestConfig({ integrationGlobalSetup: "./src/postgres-setup.ts" });
