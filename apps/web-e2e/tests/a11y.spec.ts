import { expect, summarize, test } from "../fixtures";

const ROUTES = ["/"];

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    for (const route of ROUTES) {
      test(`${route} has no axe violations`, async ({ page, makeAxeBuilder }, testInfo) => {
        await page.goto(route);
        const results = await makeAxeBuilder().analyze();

        await testInfo.attach("axe-results", {
          body: JSON.stringify(results.violations, null, 2),
          contentType: "application/json",
        });
        expect(summarize(results.violations)).toEqual([]);
      });
    }
  });
}
