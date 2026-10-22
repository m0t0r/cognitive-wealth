import { expect, summarize, test } from "../fixtures";

test("dialog is keyboard operable and returns focus to its trigger", async ({
  page,
  makeAxeBuilder,
}) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Open dialog" });

  await trigger.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Start a new chat?" });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  expect(summarize((await makeAxeBuilder().include("[role=dialog]").analyze()).violations)).toEqual(
    [],
  );

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
