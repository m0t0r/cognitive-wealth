import { invitation } from "@repo/db/schema";
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

  // Browser B: Cy's next navigation finds no workspace (Acme was their only one), and says why
  // (removal.spec.ts covers what that page tells them).
  await member.page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Members" })
    .click();
  await expect(member.page).toHaveURL("/no-workspace");
  await expect(
    member.page.getByRole("heading", { name: "You're no longer a member of Acme" }),
  ).toBeVisible();

  expect(ownerViolations).toEqual([]);
  expect(memberViolations).toEqual([]);
});

// The rule (a stale page's mutation is refused with `tenant_changed`, with no side effect) is
// owned by tenant.integration.test.ts. Here: two real tabs of one session, and the page catching up.
test("a tab left on one workspace can't act on the one another tab switched to", async ({
  page,
  context,
  db,
  signIn,
}, testInfo) => {
  const ownerEmail = uniqueEmail(testInfo, "owner");
  const owner = await seedUser(db, { email: ownerEmail, name: "Olivia Owner" });
  await seedOrganization(db, {
    name: "Globex",
    members: [{ user: owner, role: "owner", joinedAt: new Date("2026-01-01") }],
  });
  // Acme is the newest membership, so the session starts there.
  await seedOrganization(db, {
    name: "Acme",
    members: [{ user: owner, role: "owner", joinedAt: new Date("2026-02-01") }],
  });
  const violations = await recordCspViolations(page);
  await signIn(ownerEmail);

  // Tab A shows Acme's members.
  await page.goto("/settings/members");
  await expect(page.getByText("People who can use Acme.")).toBeVisible();

  // Tab B switches the session to Globex.
  const tabB = await context.newPage();
  await tabB.goto("/");
  await tabB.getByRole("button", { name: /^Switch workspace/ }).click();
  await tabB.getByRole("menuitemradio", { name: /^Globex/ }).click();
  await expect(tabB.getByText("You're an owner of Globex.")).toBeVisible();

  // Tab A invites someone: refused, explained, and the page now shows Globex.
  await page.getByRole("textbox", { name: "Email" }).fill(uniqueEmail(testInfo, "invitee"));
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(
    page.getByText("You switched workspace in another tab. This page now shows Globex."),
  ).toBeVisible();
  await expect(page.getByText("People who can use Globex.")).toBeVisible();
  expect(await db.$count(invitation)).toBe(0);
  expect(violations).toEqual([]);
});
