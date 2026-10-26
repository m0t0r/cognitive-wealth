import type { Page } from "@playwright/test";
import { expect, summarize, test, type OtherBrowser } from "../fixtures";
import { seedOrganization, seedUser, uniqueEmail } from "../support/seed";

// When the notice is stored, what clears it and whose session it touches are owned by
// packages/auth/src/removal-notice.integration.test.ts, and its copy by the UI tests of
// `RemovalNotice` and `NoWorkspaceCard`. Here: an owner removes the member through the real app in
// another browser, and what the member's browser shows next (ADR 0023).

/** The owner removes `name` from the workspace they're in, as the members page does it. */
async function removeThroughTheApp({ owner, name }: { owner: OtherBrowser; name: string }) {
  await owner.page.goto("/settings/members");
  await owner.page.getByRole("button", { name: `Actions for ${name}` }).click();
  await owner.page.getByRole("menuitem", { name: "Remove from workspace" }).click();
  await owner.page
    .getByRole("alertdialog", { name: `Remove ${name}?` })
    .getByRole("button", { name: "Remove member" })
    .click();
  await expect(owner.page.getByText(`${name} was removed from Acme.`)).toBeVisible();
}

/** Scans the page in light and dark. */
async function expectNoViolationsInBothThemes({
  page,
  makeAxeBuilder,
}: {
  page: Page;
  makeAxeBuilder: () => import("@axe-core/playwright").AxeBuilder;
}) {
  for (const colorScheme of ["light", "dark"] as const) {
    // oxlint-disable-next-line no-await-in-loop -- one page, one theme at a time
    await page.emulateMedia({ colorScheme });
    // oxlint-disable-next-line no-await-in-loop
    const results = await makeAxeBuilder().analyze();
    expect(summarize(results.violations), colorScheme).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

const mainNavLink = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Main" }).getByRole("link", { name });

test("a two-Firm member is told on their next click, until they dismiss it", async ({
  page,
  db,
  signIn,
  openBrowser,
  makeAxeBuilder,
}, testInfo) => {
  const email = uniqueEmail(testInfo, "member");
  const ownerEmail = uniqueEmail(testInfo, "owner");
  const olivia = await seedUser(db, { email: ownerEmail, name: "Olivia Owner" });
  const mo = await seedUser(db, { email, name: "Mo Member" });
  await seedOrganization(db, {
    name: "Globex",
    members: [
      { user: olivia, role: "owner", joinedAt: new Date("2026-01-01") },
      { user: mo, role: "member", joinedAt: new Date("2026-01-01") },
    ],
  });
  // Joined last, so both sessions start in Acme.
  await seedOrganization(db, {
    name: "Acme",
    members: [
      { user: olivia, role: "owner", joinedAt: new Date("2026-01-01") },
      { user: mo, role: "member", joinedAt: new Date("2026-02-01") },
    ],
  });
  await signIn(email);
  await page.goto("/");
  await expect(page.getByText("You're a member of Acme.")).toBeVisible();

  const owner = await openBrowser();
  await owner.signIn(ownerEmail);
  await removeThroughTheApp({ owner, name: "Mo Member" });

  await mainNavLink(page, "Households").click();
  const notice = page.getByRole("status").filter({
    hasText: "You're no longer a member of Acme. You're now in Globex.",
  });
  await expect(notice).toBeVisible();
  await expect(page.getByRole("button", { name: /^Switch workspace/ })).toContainText("Globex");
  // Focus stays where the click left it, outside the notice.
  await expect(mainNavLink(page, "Households")).toBeFocused();
  await expectNoViolationsInBothThemes({ page, makeAxeBuilder });

  await mainNavLink(page, "Members").click();
  await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible();
  await expect(notice).toBeVisible();

  await page.getByRole("button", { name: "Dismiss notice about Acme" }).click();
  await expect(notice).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeFocused();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible();
  await expect(page.getByText("You're no longer a member of Acme.")).toHaveCount(0);
});

test("a single-Firm member lands on the explanation, still signed in", async ({
  page,
  db,
  signIn,
  openBrowser,
  makeAxeBuilder,
}, testInfo) => {
  const email = uniqueEmail(testInfo, "member");
  const ownerEmail = uniqueEmail(testInfo, "owner");
  const olivia = await seedUser(db, { email: ownerEmail, name: "Olivia Owner" });
  const mia = await seedUser(db, { email, name: "Mia Member" });
  await seedOrganization(db, {
    name: "Acme",
    members: [
      { user: olivia, role: "owner" },
      { user: mia, role: "member" },
    ],
  });
  await signIn(email);
  await page.goto("/");
  await expect(page.getByText("You're a member of Acme.")).toBeVisible();

  const owner = await openBrowser();
  await owner.signIn(ownerEmail);
  await removeThroughTheApp({ owner, name: "Mia Member" });

  await mainNavLink(page, "Households").click();
  await expect(page).toHaveURL("/no-workspace");
  for (const _ of [1, 2]) {
    // oxlint-disable-next-line no-await-in-loop -- the landing, then a reload
    await expect(page).toHaveTitle(/^No workspace · /);
    // oxlint-disable-next-line no-await-in-loop
    await expect(
      page.getByRole("heading", { level: 1, name: "You're no longer a member of Acme" }),
    ).toBeVisible();
    // oxlint-disable-next-line no-await-in-loop
    await expect(
      page.getByText(
        `To join another workspace, ask a workspace owner or admin to invite ${email}.`,
      ),
    ).toBeVisible();
    // oxlint-disable-next-line no-await-in-loop
    await page.reload();
  }
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expectNoViolationsInBothThemes({ page, makeAxeBuilder });
});
