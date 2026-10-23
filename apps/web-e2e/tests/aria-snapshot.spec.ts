import { expect, test } from "../fixtures";
import { seedInvitation, seedOrganization, seedUser, uniqueEmail } from "../support/seed";

// Guards the accessibility tree (roles, names, structure) against regressions.
// Update intentionally with `pnpm --filter web-e2e e2e --update-snapshots`, then review the YAML.
test("home page accessibility tree", async ({ page }) => {
  await page.goto("/design-system");
  await expect(page.getByRole("main")).toMatchAriaSnapshot({ name: "home-main.aria.yml" });
});

test("sign-in page accessibility tree", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("main")).toMatchAriaSnapshot({ name: "sign-in-main.aria.yml" });
});

test("confirm page accessibility tree", async ({ page }) => {
  await page.goto("/sign-in/confirm#token=e2e-placeholder-token");
  await expect(page.getByRole("button", { name: "Continue to Cognitive Wealth" })).toBeVisible();
  await expect(page.getByRole("main")).toMatchAriaSnapshot({ name: "confirm-main.aria.yml" });
});

test("members page accessibility tree", async ({ page, db, signIn }, testInfo) => {
  // Fixed names and dates (emails are stable per test), so the tree is the same on every run.
  const email = uniqueEmail(testInfo, "owner");
  const owner = await seedUser(db, { email, name: "Olivia Owner" });
  const cy = await seedUser(db, { email: uniqueEmail(testInfo, "member"), name: "Cy Member" });
  const acme = await seedOrganization(db, {
    name: "Acme",
    members: [
      { user: owner, role: "owner", joinedAt: new Date("2026-01-05T12:00:00Z") },
      { user: cy, role: "member", joinedAt: new Date("2026-02-10T12:00:00Z") },
    ],
  });
  await seedInvitation(db, {
    organization: acme,
    email: uniqueEmail(testInfo, "invitee"),
    role: "admin",
    inviter: owner,
    expiresAt: new Date("2099-03-15T12:00:00Z"),
  });
  await signIn(email);

  await page.goto("/settings/members");
  await expect(page.getByRole("main")).toMatchAriaSnapshot({ name: "members-main.aria.yml" });
});
