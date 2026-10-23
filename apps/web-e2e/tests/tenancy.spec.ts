import { expect, test } from "../fixtures";
import { recordCspViolations } from "../support/csp";
import { seedOrganization, seedUser, uniqueEmail } from "../support/seed";

// Tenant scoping, the active-org lifecycle and who may remove whom are owned by
// packages/auth/src/tenant.integration.test.ts. Here: the switcher and a removal, as two browsers
// see them.

test("an owner switches workspaces, removes a member, and the member loses access", async ({
  page,
  db,
  signIn,
  openBrowser,
}, testInfo) => {
  const ownerEmail = uniqueEmail(testInfo, "owner");
  const memberEmail = uniqueEmail(testInfo, "member");
  const owner = await seedUser(db, { email: ownerEmail, name: "Olivia Owner" });
  const cy = await seedUser(db, { email: memberEmail, name: "Cy Member" });
  await seedOrganization(db, {
    name: "Acme",
    members: [
      { user: owner, role: "owner", joinedAt: new Date("2026-01-01") },
      { user: cy, role: "member" },
    ],
  });
  // The owner joined Globex last, so their session starts there.
  await seedOrganization(db, {
    name: "Globex",
    members: [{ user: owner, role: "owner", joinedAt: new Date("2026-02-01") }],
  });

  // Browser B: Cy is signed in and working in Acme.
  const member = await openBrowser();
  const memberViolations = await recordCspViolations(member.page);
  await member.signIn(memberEmail);
  await member.page.goto("/");
  await expect(member.page.getByText("You're a member of Acme.")).toBeVisible();

  // Browser A: the owner starts in Globex and switches to Acme.
  const ownerViolations = await recordCspViolations(page);
  await signIn(ownerEmail);
  await page.goto("/");
  await expect(page.getByText("You're an owner of Globex.")).toBeVisible();
  await page.getByRole("button", { name: /^Switch workspace/ }).click();
  await page.getByRole("menuitemradio", { name: /^Acme/ }).click();
  await expect(page.getByText("Switched to Acme")).toBeVisible();
  await expect(page.getByText("You're an owner of Acme.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Switch workspace/ })).toContainText("Acme");

  // …and removes Cy, confirming in the AlertDialog.
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Members" })
    .click();
  await page.getByRole("button", { name: "Actions for Cy Member" }).click();
  await page.getByRole("menuitem", { name: "Remove from workspace" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Remove Cy Member?" });
  await confirm.getByRole("button", { name: "Remove member" }).click();
  await expect(page.getByText("Cy Member was removed from Acme.")).toBeVisible();
  await expect(page.getByRole("table", { name: /^Members/ })).not.toContainText("Cy Member");

  // Browser B: Cy's next navigation finds no workspace (Acme was their only one).
  await member.page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Members" })
    .click();
  await expect(member.page).toHaveURL("/no-workspace");
  await expect(
    member.page.getByRole("heading", { name: "You're not in a workspace yet" }),
  ).toBeVisible();

  expect(ownerViolations).toEqual([]);
  expect(memberViolations).toEqual([]);
});
