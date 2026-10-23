import { invitation, member, organization, session, user } from "@repo/db/schema";
import { expect, test } from "../fixtures";
import { captureResponseBodies, findInternalIds } from "../support/internal-ids";
import { seedInvitation, seedOrganization, seedUser, uniqueEmail } from "../support/seed";
import { confirmSignIn, requestSignInFromUi } from "../support/sign-in";

// The DTO mappers and the auth handler's response stripping are owned by unit and integration
// tests (dto.test.ts, auth.integration.test.ts "handler responses carry no IDs…"). Here: whatever
// Chromium actually receives over a whole journey, whichever layer produced it.

test("no internal ID reaches the browser through sign-in, home, members and a switch", async ({
  page,
  db,
  mailbox,
}, testInfo) => {
  const email = uniqueEmail(testInfo, "owner");
  const owner = await seedUser(db, { email, name: "Olivia Owner" });
  const colleague = await seedUser(db, {
    email: uniqueEmail(testInfo, "colleague"),
    name: "Cy Member",
  });
  const acme = await seedOrganization(db, {
    name: "Acme",
    members: [
      { user: owner, role: "owner", joinedAt: new Date("2026-02-01") },
      { user: colleague, role: "member" },
    ],
  });
  const globex = await seedOrganization(db, {
    name: "Globex",
    members: [{ user: owner, role: "owner", joinedAt: new Date("2026-01-01") }],
  });
  await seedInvitation(db, {
    organization: acme,
    email: uniqueEmail(testInfo, "invitee"),
    role: "member",
    inviter: owner,
  });
  const responses = await captureResponseBodies(page);

  // Sign in by link through the UI, so the auth endpoints' JSON is captured too.
  await page.goto("/sign-in");
  await confirmSignIn(page, await requestSignInFromUi(page, mailbox, email));
  await expect(page.getByText("You're an owner of Acme.")).toBeVisible();

  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Members" })
    .click();
  await expect(page.getByRole("table", { name: /^Members/ })).toContainText("Cy Member");

  await page.getByRole("button", { name: /^Switch workspace/ }).click();
  await page.getByRole("menuitemradio", { name: /^Globex/ }).click();
  await expect(page.getByText("Switched to Globex")).toBeVisible();
  await expect(page.getByRole("table", { name: /^Members/ })).not.toContainText("Cy Member");

  // Every internal ID that exists now, read after the journey so the session's is included.
  const idRows = await Promise.all([
    db.select({ id: user.id }).from(user),
    db.select({ id: organization.id }).from(organization),
    db.select({ id: member.id }).from(member),
    db.select({ id: invitation.id }).from(invitation),
    db.select({ id: session.id }).from(session),
  ]);
  const ids = new Set(idRows.flat().map((row) => row.id));
  // The matcher itself: it finds a planted ID and ignores public ones.
  expect(findInternalIds(`{"id":${owner.id},"organizationId":"7"}`, ids)).toHaveLength(2);
  expect(findInternalIds(`{"id":"${owner.publicId}","id":"sign-in-email"}`, ids)).toEqual([]);

  const bodies = await responses.collect();
  // The journey produced each kind of payload: pages, RSC navigations and actions, auth JSON.
  const types = new Set(bodies.map((body) => body.contentType.split(";")[0]));
  expect(types).toEqual(new Set(["text/html", "text/x-component", "application/json"]));
  // …and the payloads do carry the journey's data, by publicId.
  expect(bodies.some((body) => body.body.includes(globex.publicId))).toBe(true);

  const leaks = bodies.flatMap(({ url, body }) =>
    findInternalIds(body, ids).map((match) => `${url}: ${match}`),
  );
  expect(leaks).toEqual([]);
});
