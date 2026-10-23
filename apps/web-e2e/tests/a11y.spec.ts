import type { AxeBuilder } from "@axe-core/playwright";
import type { TestInfo } from "@playwright/test";
import { expect, summarize, test } from "../fixtures";
import { PUBLIC_ROUTES, SIGNED_IN_ROUTES } from "../support/routes";
import { uniqueEmail } from "../support/seed";

async function expectNoViolations(axe: AxeBuilder, testInfo: TestInfo) {
  const results = await axe.analyze();
  await testInfo.attach("axe-results", {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });
  expect(summarize(results.violations)).toEqual([]);
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    for (const route of PUBLIC_ROUTES) {
      test(`${route.name} has no axe violations`, async ({ page, makeAxeBuilder }, testInfo) => {
        await page.goto(route.url);
        if (route.ready) await expect(route.ready(page)).toBeVisible();
        await expectNoViolations(makeAxeBuilder(), testInfo);
      });
    }

    for (const route of SIGNED_IN_ROUTES) {
      test(`${route.name} (signed in) has no axe violations`, async ({
        page,
        db,
        signIn,
        makeAxeBuilder,
      }, testInfo) => {
        const email = uniqueEmail(testInfo, "viewer");
        const url = await route.setUp(db, email);
        await signIn(email);

        await page.goto(url);
        await expect(page).toHaveURL(url);
        if (route.ready) await expect(route.ready(page)).toBeVisible();
        await expectNoViolations(makeAxeBuilder(), testInfo);
      });
    }
  });
}
