import type { Database } from "@repo/db";
import { member as memberTable, organization } from "@repo/db/schema";
import { eq } from "drizzle-orm";
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

// Deactivated by hand, at a fixed time; deactivation.spec.ts runs the real CLI.
const deactivate = (db: Database, organizationId: number) =>
  db
    .update(organization)
    .set({ deactivatedAt: new Date("2026-10-01T12:00:00Z") })
    .where(eq(organization.id, organizationId));

test("no-workspace page of a Deactivated Firm's member", async ({ page, db, signIn }, testInfo) => {
  const email = uniqueEmail(testInfo, "member");
  const member = await seedUser(db, { email, name: "Mia Member" });
  const acme = await seedOrganization(db, {
    name: "Acme",
    members: [{ user: member, role: "member" }],
  });
  await deactivate(db, acme.id);
  await signIn(email);

  await page.goto("/no-workspace");
  await expect(page.getByRole("main")).toMatchAriaSnapshot({
    name: "no-workspace-deactivated-main.aria.yml",
  });
});

test("app page with the Deactivated Firm notice", async ({ page, db, signIn }, testInfo) => {
  const email = uniqueEmail(testInfo, "owner");
  const owner = await seedUser(db, { email, name: "Olivia Owner" });
  await seedOrganization(db, {
    name: "Globex",
    members: [{ user: owner, role: "owner", joinedAt: new Date("2026-01-01T12:00:00Z") }],
  });
  const acme = await seedOrganization(db, {
    name: "Acme",
    members: [{ user: owner, role: "owner", joinedAt: new Date("2026-02-01T12:00:00Z") }],
  });
  await deactivate(db, acme.id);
  await signIn(email);

  await page.goto("/");
  await expect(page.getByRole("main")).toMatchAriaSnapshot({
    name: "deactivated-notice-main.aria.yml",
  });
});

// Removed by hand, after sign-in, so the member's next page moves the session (ADR 0023);
// removal.spec.ts removes them through the app.
const removeMembership = (db: Database, memberId: number) =>
  db.delete(memberTable).where(eq(memberTable.id, memberId));

test("no-workspace page of a removed member", async ({ page, db, signIn }, testInfo) => {
  const email = uniqueEmail(testInfo, "member");
  const mia = await seedUser(db, { email, name: "Mia Member" });
  const acme = await seedOrganization(db, {
    name: "Acme",
    members: [{ user: mia, role: "member" }],
  });
  await signIn(email);
  await removeMembership(db, acme.members[0]!.id);

  await page.goto("/no-workspace");
  await expect(page.getByRole("main")).toMatchAriaSnapshot({
    name: "no-workspace-removed-main.aria.yml",
  });
});

test("app page with the Removal notice", async ({ page, db, signIn }, testInfo) => {
  const email = uniqueEmail(testInfo, "member");
  const mo = await seedUser(db, { email, name: "Mo Member" });
  await seedOrganization(db, {
    name: "Globex",
    members: [{ user: mo, role: "member", joinedAt: new Date("2026-01-01T12:00:00Z") }],
  });
  const acme = await seedOrganization(db, {
    name: "Acme",
    members: [{ user: mo, role: "member", joinedAt: new Date("2026-02-01T12:00:00Z") }],
  });
  await signIn(email);
  await removeMembership(db, acme.members[0]!.id);

  await page.goto("/");
  await expect(page.getByRole("main")).toMatchAriaSnapshot({
    name: "removal-notice-main.aria.yml",
  });
});

test("no-workspace page of a User with no workspace", async ({ page, db, signIn }, testInfo) => {
  const email = uniqueEmail(testInfo, "invitee");
  await seedUser(db, { email, name: "Ida Invitee" });
  await signIn(email);

  await page.goto("/no-workspace");
  await expect(page.getByRole("main")).toMatchAriaSnapshot({
    name: "no-workspace-main.aria.yml",
  });
});
