import { defineVitestConfig } from "@repo/testing/vitest";

export default defineVitestConfig({ test: { setupFiles: ["./src/testing/msw-setup.ts"] } });
