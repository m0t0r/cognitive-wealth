import { expect, test } from "../fixtures";

test("home page renders the design system preview", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Cognitive Wealth");
  await expect(page.getByRole("heading", { level: 1, name: "Design system" })).toBeVisible();
});
