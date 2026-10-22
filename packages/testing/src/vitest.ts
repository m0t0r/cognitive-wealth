import react from "@vitejs/plugin-react";
import { defineConfig, type ViteUserConfig } from "vitest/config";

const INTEGRATION = "**/*.integration.test.{ts,tsx}";
const EXCLUDE = ["**/node_modules/**", "**/.next/**", "**/dist/**"];

/**
 * Shared Vitest config. Each package gets three projects:
 * - `unit`: `*.test.ts` in Node
 * - `ui`: `*.test.tsx` in jsdom, for React Testing Library + user-event
 * - `integration`: `*.integration.test.{ts,tsx}` in Node (PGlite). Opt a file into the DOM
 *   with a `// @vitest-environment jsdom` docblock.
 */
export function defineVitestConfig(overrides: ViteUserConfig = {}): ViteUserConfig {
  return defineConfig({
    plugins: [react()],
    resolve: { tsconfigPaths: true },
    ...overrides,
    test: {
      passWithNoTests: true,
      clearMocks: true,
      restoreMocks: true,
      unstubEnvs: true,
      unstubGlobals: true,
      coverage: {
        provider: "v8",
        // lcov for CI services (they merge per-package reports), json-summary for PR comments.
        reporter: ["text-summary", "html", "lcov", "json-summary"],
        include: ["**/*.{ts,tsx}"],
        exclude: [...EXCLUDE, "**/*.test.{ts,tsx}", "**/*.config.{ts,mts}", "**/*.d.ts"],
      },
      projects: [
        {
          extends: true,
          test: {
            name: "unit",
            environment: "node",
            include: ["**/*.test.ts"],
            exclude: [...EXCLUDE, INTEGRATION],
          },
        },
        {
          extends: true,
          test: {
            name: "ui",
            environment: "jsdom",
            include: ["**/*.test.tsx"],
            exclude: [...EXCLUDE, INTEGRATION],
          },
        },
        {
          extends: true,
          test: {
            name: "integration",
            environment: "node",
            include: [INTEGRATION],
            exclude: EXCLUDE,
            testTimeout: 15_000,
          },
        },
      ],
      ...overrides.test,
    },
  });
}
