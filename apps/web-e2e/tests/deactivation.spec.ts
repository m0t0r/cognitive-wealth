import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { expectNoViolationsInBothThemes } from "../support/axe";
import { runOrgStatus } from "../support/org-status";
import { seedInvitation, seedOrganization, seedUser, uniqueEmail } from "../support/seed";

// Who a Deactivated Firm blocks, its invitations and the copy are owned by
// packages/auth/src/deactivation.integration.test.ts and the UI tests of `NoWorkspaceCard` and
// `DeactivatedNotice`. Here: the real CLI against the worker's database while members are signed
// in, and what their browsers show next (ADR 0022).

const NOTICE_COOKIE = "cw.dismissed_notices";

/** Every URL the page's main frame loads from now on, to check none of them was sign-in. */
function recordNavigations(page: Page): string[] {
  const urls: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) urls.push(new URL(frame.url()).pathname);
  });
  return urls;
}

test("a member whose only Firm is deactivated is told on their next click, without being signed out, and gets it back on reactivation", async ({
  page,
  db,
  signIn,
  openBrowser,
  workerDatabase,
  makeAxeBuilder,
}, testInfo) => {
  const email = uniqueEmail(testInfo, "member");
  const owner = await seedUser(db, { email: uniqueEmail(testInfo, "owner"), name: "Olivia" });
  const mia = await seedUser(db, { email, name: "Mia Member" });
  const acme = await seedOrganization(db, {
    name: "Acme",
    members: [
      { user: owner, role: "owner" },
      { user: mia, role: "member" },
    ],
  });
  // Pending when Acme is deactivated, so it's canceled and never listed.
  await seedInvitation(db, { organization: acme, email, role: "admin", inviter: owner });
  const other = await openBrowser();
  await signIn(email);
  await other.signIn(email);

  await page.goto("/");
  await expect(page.getByText("You're a member of Acme.")).toBeVisible();
  const navigations = recordNavigations(page);

  await runOrgStatus({ databaseUrl: workerDatabase.appUrl, command: "deactivate", slug: "acme" });

  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Households" })
    .click();
  await expect(page).toHaveURL("/no-workspace");
  expect(navigations.filter((path) => path.startsWith("/sign-in"))).toEqual([]);
  await expect(page).toHaveTitle(/^No workspace · /);
  await expect(
    page.getByRole("heading", { level: 1, name: "Acme no longer uses Cognitive Wealth" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      `Its workspace is no longer available. To join another one, ask a workspace owner or admin to invite ${email}.`,
    ),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Your invitations" })).toHaveCount(0);
  await expectNoViolationsInBothThemes({ page, makeAxeBuilder });

  // The same user's other browser lands there too, and can still sign out.
  await other.page.goto("/");
  await expect(other.page).toHaveURL("/no-workspace");
  await other.page.getByRole("button", { name: "Sign out" }).click();
  await expect(other.page).toHaveURL(/\/sign-in/);

  await runOrgStatus({ databaseUrl: workerDatabase.appUrl, command: "reactivate", slug: "acme" });
  await page.reload();
  await expect(page).toHaveURL("/");
  await expect(page.getByText("You're a member of Acme.")).toBeVisible();
});

test("a member of two Firms is moved to the other, told why until they dismiss it, and not signed out", async ({
  page,
  context,
  db,
  signIn,
  openBrowser,
  workerDatabase,
  makeAxeBuilder,
}, testInfo) => {
  const email = uniqueEmail(testInfo, "owner");
  const olivia = await seedUser(db, { email, name: "Olivia Owner" });
  await seedOrganization(db, {
    name: "Globex",
    members: [{ user: olivia, role: "owner", joinedAt: new Date("2026-01-01") }],
  });
  // Joined last, so the session starts in Acme.
  await seedOrganization(db, {
    name: "Acme",
    members: [{ user: olivia, role: "owner", joinedAt: new Date("2026-02-01") }],
  });
  const other = await openBrowser();
  await signIn(email);
  await other.signIn(email);
  await page.goto("/");
  await expect(page.getByText("You're an owner of Acme.")).toBeVisible();
  const navigations = recordNavigations(page);

  await runOrgStatus({ databaseUrl: workerDatabase.appUrl, command: "deactivate", slug: "acme" });

  await page.reload();
  await expect(page.getByText("You're an owner of Globex.")).toBeVisible();
  expect(navigations.filter((path) => path.startsWith("/sign-in"))).toEqual([]);
  const notice = page.getByText(
    "Acme no longer uses Cognitive Wealth, so its workspace is no longer available. You're in Globex.",
  );
  await expect(notice).toBeVisible();
  expect(
    await page.evaluate(() => document.activeElement === document.body || !document.activeElement),
  ).toBe(true);
  await expectNoViolationsInBothThemes({ page, makeAxeBuilder });

  await page.getByRole("button", { name: /^Switch workspace/ }).click();
  const workspaces = page.getByRole("menuitemradio");
  await expect(workspaces).toHaveCount(1);
  await expect(workspaces).toContainText("Globex");
  await page.keyboard.press("Escape");

  await page.reload();
  await expect(notice).toBeVisible();
  await page.goto("/settings/members");
  await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible();
  await expect(notice).toBeVisible();

  // Reached and pressed with the keyboard.
  const dismissButton = page.getByRole("button", { name: "Dismiss notice" });
  await page.locator("body").focus();
  for (let tab = 0; tab < 40; tab++) {
    // oxlint-disable-next-line no-await-in-loop -- each Tab depends on where the last one went
    if (await dismissButton.evaluate((button) => button === document.activeElement)) break;
    // oxlint-disable-next-line no-await-in-loop
    await page.keyboard.press("Tab");
  }
  await expect(dismissButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(notice).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeFocused();

  const cookie = (await context.cookies()).find((c) => c.name === NOTICE_COOKIE);
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible();
  await expect(notice).toHaveCount(0);

  // A dismissal holds per browser.
  await other.page.goto("/");
  await expect(
    other.page.getByText(
      "Acme no longer uses Cognitive Wealth, so its workspace is no longer available. You're in Globex.",
    ),
  ).toBeVisible();
});

test("a Firm deactivated again shows its notice again", async ({
  page,
  db,
  signIn,
  workerDatabase,
}, testInfo) => {
  const email = uniqueEmail(testInfo, "owner");
  const olivia = await seedUser(db, { email, name: "Olivia Owner" });
  await seedOrganization(db, {
    name: "Globex",
    members: [{ user: olivia, role: "owner", joinedAt: new Date("2026-01-01") }],
  });
  await seedOrganization(db, {
    name: "Acme",
    members: [{ user: olivia, role: "owner", joinedAt: new Date("2026-02-01") }],
  });
  await signIn(email);
  const status = (command: "deactivate" | "reactivate") =>
    runOrgStatus({ databaseUrl: workerDatabase.appUrl, command, slug: "acme" });
  const notice = page.getByText(/^Acme no longer uses Cognitive Wealth/);

  await status("deactivate");
  await page.goto("/");
  await page.getByRole("button", { name: "Dismiss notice" }).click();
  await expect(notice).toHaveCount(0);

  await status("reactivate");
  await status("deactivate");
  await page.reload();
  await expect(notice).toBeVisible();
});
