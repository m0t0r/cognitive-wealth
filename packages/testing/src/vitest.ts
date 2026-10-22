import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type ViteUserConfig } from "vitest/config";

const INTEGRATION = "**/*.integration.test.{ts,tsx}";
const EXCLUDE = ["**/node_modules/**", "**/.next/**", "**/dist/**"];

/**
 * Shared Vitest config. Each package gets three projects:
 * - `unit`: `*.test.ts` in Node
 * - `ui`: `*.test.tsx` in happy-dom, for React Testing Library + user-event
 * - `integration`: `*.integration.test.{ts,tsx}` in Node (PGlite). Opt a file into the DOM
 *   with a `// @vitest-environment happy-dom` docblock.
 */
export function defineVitestConfig(overrides: ViteUserConfig = {}): ViteUserConfig {
  return defineConfig({
    plugins: [react()],
    resolve: { tsconfigPaths: true },
    ...overrides,
    test: {
      // One module cache per package (Vitest's default is a single one at the workspace root).
      // Turbo runs packages in parallel, and a process clearing the shared cache after an install
      // fails the others with ENOTEMPTY. It stays under node_modules, so reinstalls still clear it.
      fsModuleCachePath: join(process.cwd(), "node_modules", ".vitest-cache"),
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
            environment: "happy-dom",
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
