import { randomUUID } from "node:crypto";
import { AxeBuilder } from "@axe-core/playwright";
import type { Database } from "@repo/db";
import { type Mailpit, createMailpit } from "@repo/testing/mailpit";
import { type Cookie, signIn } from "@repo/testing/sign-in";
import { type BrowserContext, type Page, test as base, expect } from "@playwright/test";
import { requiredEnv } from "./support/compose";
import { createWorkerDatabase } from "./support/database";
import { connectJanitor } from "./support/redis";
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

/** A browser of its own: a fresh context with its own `clientIp`, so its rate limits are its own. */
export interface OtherBrowser {
  context: BrowserContext;
  page: Page;
  clientIp: string;
  /** Like the `signIn` fixture, from this browser's `clientIp` into its `context`. */
  signIn: (email: string) => Promise<Cookie[]>;
}

/** The HTTP harness's sign-in, from `ip`, with the session cookies added to `context`. */
async function signInto(context: BrowserContext, appUrl: string, ip: string, email: string) {
  const { cookies } = await signIn({
    appUrl,
    email,
    mailpitUrl: requiredEnv("PLAYWRIGHT_MAILPIT_URL"),
    ip,
  });
  await context.addCookies(cookies);
  return cookies;
}

type TestFixtures = {
  makeAxeBuilder: () => AxeBuilder;
  /** Drizzle on this worker's database, emptied before every test. Seed and assert through it. */
  db: Database;
  /** Auto: deletes this worker's Redis keys (rate limits, cached sessions) before every test. */
  redisReset: void;
  /**
   * Auto: this test's client address, unique in the run. Every page and `request` call sends it
   * as `x-forwarded-for`, which the server trusts, so per-IP rate limits never cross tests.
   */
  clientIp: string;
  /**
   * Signs `email` in through the real flow (request, Mailpit, verify) from this test's
   * `clientIp`, and adds the session cookies to `context`. The user must be eligible: seed them
   * (or an invitation) through `db` first.
   */
  signIn: (email: string) => Promise<Cookie[]>;
  /**
   * Opens another browser (a second user, say) with its own context and `clientIp`, on this
   * worker's server. Closed after the test.
   */
  openBrowser: () => Promise<OtherBrowser>;
};

type WorkerFixtures = {
  workerDatabase: Awaited<ReturnType<typeof createWorkerDatabase>>;
  /** This worker's Redis namespace (`cw:e2e_w<index>_<rand>:`) and its janitor. */
  workerRedis: { prefix: string; reset: () => Promise<void> };
  app: AppServer;
  /** The run's Mailpit, shared by all workers: always filter by a recipient unique to the test. */
  mailbox: Mailpit;
  /** Hands out this worker's client addresses (see `clientIp`). */
  clientIps: { next: () => string };
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

  workerRedis: [
    // oxlint-disable-next-line no-empty-pattern
    async ({}, provide, workerInfo) => {
      const prefix = `cw:e2e_w${workerInfo.parallelIndex}_${randomUUID().slice(0, 8)}:`;
      const janitor = await connectJanitor(
        requiredEnv("PLAYWRIGHT_REDIS_URL"),
        requiredEnv("PLAYWRIGHT_REDIS_JANITOR_PASSWORD"),
        prefix,
      );
      await provide({ prefix, reset: janitor.reset });
      await janitor.reset();
      await janitor.close();
    },
    { scope: "worker" },
  ],

  app: [
    async ({ workerDatabase, workerRedis }, provide) => {
      const server = await startServer({
        databaseUrl: workerDatabase.appUrl,
        redisKeyPrefix: workerRedis.prefix,
      });
      await provide(server);
      await server.stop();
    },
    { scope: "worker", timeout: 60_000 },
  ],

  mailbox: [
    // oxlint-disable-next-line no-empty-pattern
    async ({}, provide) => {
      await provide(createMailpit(requiredEnv("PLAYWRIGHT_MAILPIT_URL")));
    },
    { scope: "worker" },
  ],

  clientIps: [
    // oxlint-disable-next-line no-empty-pattern
    async ({}, provide, workerInfo) => {
      // 10.<worker>.<hi>.<lo>: workerIndex is unique in the run (a restarted worker gets a new
      // one), and the counter lives in this fixture, not in module state.
      let count = 0;
      await provide({
        next: () => {
          count += 1;
          return `10.${workerInfo.workerIndex % 256}.${(count >> 8) % 256}.${count % 256}`;
        },
      });
    },
    { scope: "worker" },
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

  redisReset: [
    async ({ workerRedis }, provide) => {
      await workerRedis.reset();
      await provide();
    },
    { auto: true },
  ],

  clientIp: [
    async ({ clientIps }, provide) => {
      await provide(clientIps.next());
    },
    { auto: true },
  ],

  // Playwright's own option, extended: `context`, `page` and `request` all pick it up.
  extraHTTPHeaders: async ({ extraHTTPHeaders, clientIp }, provide) => {
    await provide({ ...extraHTTPHeaders, "x-forwarded-for": clientIp });
  },

  signIn: async ({ app, context, clientIp }, provide) => {
    await provide((email) => signInto(context, app.url, clientIp, email));
  },

  openBrowser: async ({ app, browser, clientIps, colorScheme }, provide) => {
    const contexts: BrowserContext[] = [];
    await provide(async () => {
      const clientIp = clientIps.next();
      const context = await browser.newContext({
        baseURL: app.url,
        colorScheme,
        extraHTTPHeaders: { "x-forwarded-for": clientIp },
      });
      contexts.push(context);
      return {
        context,
        page: await context.newPage(),
        clientIp,
        signIn: (email) => signInto(context, app.url, clientIp, email),
      };
    });
    await Promise.all(contexts.map((context) => context.close()));
  },

  // Named `provide`, not `use`: React's rules-of-hooks lint mistakes Playwright's `use` for a hook.
  makeAxeBuilder: async ({ page }, provide) => {
    await provide(() => new AxeBuilder({ page }).withTags(AXE_TAGS));
  },
});

export { expect };
