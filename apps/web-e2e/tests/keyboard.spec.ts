import type { Locator } from "@playwright/test";
import { expect, summarize, test } from "../fixtures";
import { seedOrganization, seedUser, uniqueEmail } from "../support/seed";

/** Waits for `popup`'s open animation, so axe measures colours at full opacity. */
async function settled(popup: Locator): Promise<void> {
  await popup.evaluate((element) =>
    Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
  );
}

/** Whether the focused element is inside `container`. */
function holdsFocus(container: Locator): Promise<boolean> {
  return container.evaluate((element) => element.contains(document.activeElement));
}

test("dialog is keyboard operable and returns focus to its trigger", async ({
  page,
  makeAxeBuilder,
}) => {
  await page.goto("/design-system");
  const trigger = page.getByRole("button", { name: "Open dialog" });

  await trigger.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Start a new chat?" });
  await expect(dialog).toBeVisible();
  await expect.poll(() => holdsFocus(dialog)).toBe(true);
  expect(summarize((await makeAxeBuilder().include("[role=dialog]").analyze()).violations)).toEqual(
    [],
  );

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("each sign-in step moves focus to its new heading or field", async ({ page }, testInfo) => {
  await page.goto("/sign-in");
  const emailField = page.getByRole("textbox", { name: "Email" });

  await page.keyboard.press("Tab");
  await expect(emailField).toBeFocused();
  await page.keyboard.type(uniqueEmail(testInfo, "nobody"));
  await page.keyboard.press("Enter");

  // The "check your email" step replaces the form, so focus goes to its heading.
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("textbox", { name: "Sign-in code" })).toBeFocused();

  // Going back puts focus in the email field again, with the address kept.
  await page.getByRole("button", { name: "Use a different email" }).focus();
  await page.keyboard.press("Enter");
  await expect(emailField).toBeFocused();
  await expect(emailField).toHaveValue(uniqueEmail(testInfo, "nobody"));
});

test("the workspace switcher and a member's menu open, close and return focus", async ({
  page,
  db,
  signIn,
  makeAxeBuilder,
}, testInfo) => {
  const email = uniqueEmail(testInfo, "owner");
  const owner = await seedUser(db, { email, name: "Olivia Owner" });
  const cy = await seedUser(db, { email: uniqueEmail(testInfo, "member"), name: "Cy Member" });
  await seedOrganization(db, {
    name: "Globex",
    members: [{ user: owner, role: "owner", joinedAt: new Date("2026-01-01") }],
  });
  // Joined last, so the session starts here, where Cy is.
  await seedOrganization(db, {
    name: "Acme",
    members: [
      { user: owner, role: "owner", joinedAt: new Date("2026-02-01") },
      { user: cy, role: "member" },
    ],
  });
  await signIn(email);
  await page.goto("/settings/members");

  const expectMenuOpensAndCloses = async (trigger: Locator) => {
    await trigger.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu");
    await expect.poll(() => holdsFocus(menu)).toBe(true);
    await settled(menu);
    const { violations } = await makeAxeBuilder().include("[role=menu]").analyze();
    expect(summarize(violations)).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  };
  await expectMenuOpensAndCloses(page.getByRole("button", { name: /^Switch workspace/ }));
  await expectMenuOpensAndCloses(page.getByRole("button", { name: "Actions for Cy Member" }));
});

test("removing a member asks in an AlertDialog that traps focus and gives it back", async ({
  page,
  db,
  signIn,
  makeAxeBuilder,
}, testInfo) => {
  const email = uniqueEmail(testInfo, "owner");
  const owner = await seedUser(db, { email, name: "Olivia Owner" });
  const cy = await seedUser(db, { email: uniqueEmail(testInfo, "member"), name: "Cy Member" });
  await seedOrganization(db, {
    name: "Acme",
    members: [
      { user: owner, role: "owner" },
      { user: cy, role: "member" },
    ],
  });
  await signIn(email);
  await page.goto("/settings/members");

  const trigger = page.getByRole("button", { name: "Actions for Cy Member" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => holdsFocus(page.getByRole("menu"))).toBe(true);
  // "Remove from workspace" is the last item, after the role options.
  await page.keyboard.press("End");
  await expect(page.getByRole("menuitem", { name: "Remove from workspace" })).toBeFocused();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("alertdialog", { name: "Remove Cy Member?" });
  await expect(dialog).toBeVisible();
  await expect.poll(() => holdsFocus(dialog)).toBe(true);
  await settled(dialog);
  expect(
    summarize((await makeAxeBuilder().include("[role=alertdialog]").analyze()).violations),
  ).toEqual([]);

  // Focus starts on Cancel. Tab and Shift+Tab wrap around the two buttons (through Base UI's focus
  // guards, which hand focus straight back) and never leave the dialog.
  const cancel = dialog.getByRole("button", { name: "Cancel" });
  const remove = dialog.getByRole("button", { name: "Remove member" });
  await expect(cancel).toBeFocused();
  const steps = [
    ["Tab", remove],
    ["Tab", cancel],
    ["Shift+Tab", remove],
    ["Shift+Tab", cancel],
  ] as const;
  for (const [key, target] of steps) {
    // Sequential on purpose: each key press moves focus from where the last one left it.
    // oxlint-disable-next-line no-await-in-loop
    await page.keyboard.press(key);
    // oxlint-disable-next-line no-await-in-loop
    await expect(target, `focus after ${key}`).toBeFocused();
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  // Escape cancels: Cy is still a member.
  await expect(page.getByRole("table", { name: /^Members/ })).toContainText("Cy Member");
});
