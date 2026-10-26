// The HTTP mocks every test in the package runs under (`vitest.config.ts`'s `setupFiles`), as in
// `@repo/cve-scan`: a request no handler answers fails the test, so no test reaches the Anthropic
// API. GitHub goes through the `gh` CLI, out of MSW's reach; tests use `memory-github.ts` for it.
import { setupServer } from "msw/node";

export const server = setupServer();

beforeAll(() =>
  server.listen({
    // Not the "error" strategy: it still lets a path MSW takes for a static asset (`*.txt`,
    // `*.json`, …) through to the network. A callback that throws fails every unmatched request.
    async onUnhandledFrame({ frame }) {
      throw new Error(await frame.getUnhandledMessage());
    },
  }),
);
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
