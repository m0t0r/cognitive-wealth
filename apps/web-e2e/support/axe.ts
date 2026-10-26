import type { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, summarize } from "../fixtures";

type ExpectNoViolationsInBothThemesArgs = {
  page: Page;
  makeAxeBuilder: () => AxeBuilder;
};

/** Scans the page in light and dark, then leaves it in light. */
export async function expectNoViolationsInBothThemes({
  page,
  makeAxeBuilder,
}: ExpectNoViolationsInBothThemesArgs): Promise<void> {
  for (const colorScheme of ["light", "dark"] as const) {
    // oxlint-disable-next-line no-await-in-loop -- one page, one theme at a time
    await page.emulateMedia({ colorScheme });
    // oxlint-disable-next-line no-await-in-loop
    const results = await makeAxeBuilder().analyze();
    expect(summarize(results.violations), colorScheme).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: "light" });
}
