import { parseSignInEmail } from "@repo/testing/mailpit";
import { expect, test } from "../fixtures";
import { recordCspViolations } from "../support/csp";
import { backdateSessions, seedOrganization, seedUser, uniqueEmail } from "../support/seed";
import {
  SIGN_IN_SUBJECT,
  confirmSignIn,
  invitationLink,
  nextEmail,
  requestSignInFromUi,
} from "../support/sign-in";

// Roles, permissions, invitation rules and fresh-session gating are owned by
// packages/auth/src/tenant.integration.test.ts, and the dialogs by member-actions.test.tsx. Here:
// the invitation round trip across two browsers, and one fresh-session prompt.

test("an owner invites a new address and the invitee joins from their own browser", async ({
  page,
  db,
  mailbox,
  signIn,
  openBrowser,
}, testInfo) => {
  const ownerEmail = uniqueEmail(testInfo, "owner");
  const inviteeEmail = uniqueEmail(testInfo, "invitee");
  const owner = await seedUser(db, { email: ownerEmail, name: "Olivia Owner" });
  await seedOrganization(db, { name: "Acme", members: [{ user: owner, role: "owner" }] });
  const ownerViolations = await recordCspViolations(page);
  await signIn(ownerEmail);

  // Browser A: the owner sends the invitation from the members page.
  await page.goto("/settings/members");
  const url = await invitationLink(mailbox, inviteeEmail, async () => {
    await page.getByRole("textbox", { name: "Email" }).fill(inviteeEmail);
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByText(`Invitation sent to ${inviteeEmail}.`)).toBeVisible();
  });
  const invitationPath = new URL(url).pathname;
  await expect(page.getByRole("table", { name: /Pending invitations/ })).toContainText(
    inviteeEmail,
  );

  // Browser B: the invitee has no account yet, so the link sends them to sign in first.
  const invitee = await openBrowser();
  const inviteeViolations = await recordCspViolations(invitee.page);
  await invitee.page.goto(url);
  await expect(invitee.page).toHaveURL(`/sign-in?next=${encodeURIComponent(invitationPath)}`);
  const link = await requestSignInFromUi(invitee.page, mailbox, inviteeEmail);
  await confirmSignIn(invitee.page, link);

  await expect(invitee.page).toHaveURL(invitationPath);
  await expect(invitee.page.getByRole("heading", { name: "Join Acme" })).toBeVisible();
  await expect(invitee.page.getByText("Olivia Owner invited you to join Acme")).toBeVisible();
  await invitee.page.getByRole("button", { name: "Accept invitation" }).click();

  // A new user has no name yet, so the app asks for one before letting them in.
  await expect(invitee.page).toHaveURL("/welcome");
  await invitee.page.getByRole("textbox", { name: "Name" }).fill("Ivy Invitee");
  await invitee.page.getByRole("button", { name: "Continue" }).click();
  await expect(invitee.page).toHaveURL("/");
  await expect(invitee.page.getByRole("heading", { name: "Welcome, Ivy Invitee" })).toBeVisible();
  await expect(invitee.page.getByText("You're a member of Acme.")).toBeVisible();

  // Browser A sees the new member, and the invitation is no longer pending.
  await page.reload();
  const newRow = page
    .getByRole("table", { name: /^Members/ })
    .getByRole("row")
    .filter({ hasText: inviteeEmail });
  await expect(newRow).toContainText("Ivy Invitee");
  await expect(newRow.getByRole("cell", { name: "Member", exact: true })).toBeVisible();
  await expect(page.getByText(/^No pending invitations/)).toBeVisible();

  expect(ownerViolations).toEqual([]);
  expect(inviteeViolations).toEqual([]);
});

test("a stale session asks for a fresh sign-in before changing a role", async ({
  page,
  db,
  mailbox,
  signIn,
  workerRedis,
}, testInfo) => {
  const ownerEmail = uniqueEmail(testInfo, "owner");
  const owner = await seedUser(db, { email: ownerEmail, name: "Olivia Owner" });
  const colleague = await seedUser(db, {
    email: uniqueEmail(testInfo, "colleague"),
    name: "Cy Member",
  });
  await seedOrganization(db, {
    name: "Acme",
    members: [
      { user: owner, role: "owner" },
      { user: colleague, role: "member" },
    ],
  });
  const violations = await recordCspViolations(page);
  await signIn(ownerEmail);
  // Only the owner has a session. Better Auth reads sessions from Redis before Postgres, so drop
  // the cached copy too.
  await backdateSessions(db);
  await workerRedis.reset();

  await page.goto("/settings/members");
  await page.getByRole("button", { name: "Actions for Cy Member" }).click();
  await page.getByRole("menuitemradio", { name: "Admin" }).click();

  const dialog = page.getByRole("dialog", { name: "Sign in again to continue" });
  await expect(dialog).toBeVisible();
  const message = await nextEmail(mailbox, ownerEmail, SIGN_IN_SUBJECT, async () => {
    await dialog.getByRole("button", { name: "Send sign-in link" }).click();
    await expect(page.getByRole("dialog", { name: "Check your email" })).toBeVisible();
  });
  // The link brings the owner back to this page.
  expect(parseSignInEmail(message.text).next).toBe("/settings/members");

  // Nothing changed: the optimistic role goes back once the action is refused.
  await page.getByRole("button", { name: "Done" }).click();
  const row = page
    .getByRole("table", { name: /^Members/ })
    .getByRole("row")
    .filter({ hasText: "Cy Member" });
  await expect(row.getByRole("cell", { name: "Member", exact: true })).toBeVisible();
  expect(violations).toEqual([]);
});
