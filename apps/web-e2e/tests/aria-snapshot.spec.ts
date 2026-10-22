import { expect, test } from "../fixtures";

// Guards the accessibility tree (roles, names, structure) against regressions.
// Update intentionally with `pnpm --filter web-e2e e2e --update-snapshots`.
test("home page accessibility tree", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("main")).toMatchAriaSnapshot({ name: "home-main.aria.yml" });
});
