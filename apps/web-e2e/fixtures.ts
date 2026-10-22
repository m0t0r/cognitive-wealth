import { randomUUID } from "node:crypto";
import { AxeBuilder } from "@axe-core/playwright";
import type { Database } from "@repo/db";
import { test as base, expect } from "@playwright/test";
import { createWorkerDatabase } from "./support/database";
import { type AppServer, startServer } from "./support/server";

// WCAG 2.2 A/AA plus axe best practices.
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

type Violation = Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"][number];

/** One line per failing node, so a failed `toEqual([])` reads as a to-do list. */
export function summarize(violations: Violation[]): string[] {
  return violations.flatMap((violation) =>
    violation.nodes.map(
      (node) =>
        `[${violation.impact}] ${violation.id} @ ${node.target.join(" ")}: ${node.failureSummary?.split("\n").at(-1)?.trim()}`,
    ),
  );
}

type TestFixtures = {
  makeAxeBuilder: () => AxeBuilder;
  /** Drizzle on this worker's database, emptied before every test. Seed and assert through it. */
  db: Database;
};

type WorkerFixtures = {
  workerDatabase: Awaited<ReturnType<typeof createWorkerDatabase>>;
  app: AppServer;
};

/**
 * Every worker gets its own copy of the migrated database and its own server on it, so tests in
 * different workers never share state; within a worker, `db` empties the tables before each test.
 */
export const test = base.extend<TestFixtures, WorkerFixtures>({
  workerDatabase: [
    // Playwright requires a destructuring pattern as the fixture's first argument.
    // oxlint-disable-next-line no-empty-pattern
    async ({}, provide, workerInfo) => {
      const database = await createWorkerDatabase(
        `e2e_w${workerInfo.parallelIndex}_${randomUUID().slice(0, 8)}`,
      );
      await provide(database);
      await database.dispose();
    },
    { scope: "worker" },
  ],

  app: [
    async ({ workerDatabase }, provide) => {
      const server = await startServer(workerDatabase.appUrl);
      await provide(server);
      await server.stop();
    },
    { scope: "worker", timeout: 60_000 },
  ],

  baseURL: async ({ app }, provide) => {
    await provide(app.url);
  },

  db: [
    async ({ workerDatabase }, provide) => {
      await workerDatabase.truncateAll();
      await provide(workerDatabase.db);
    },
    // Auto: the reset runs before every test, even ones that never touch `db`.
    { auto: true },
  ],

  // Named `provide`, not `use`: React's rules-of-hooks lint mistakes Playwright's `use` for a hook.
  makeAxeBuilder: async ({ page }, provide) => {
    await provide(() => new AxeBuilder({ page }).withTags(AXE_TAGS));
  },
});

export { expect };
