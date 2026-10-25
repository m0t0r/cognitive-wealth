import { expect, test } from "../fixtures";
import { recordCspViolations } from "../support/csp";
import { seedOrganization, seedUser, uniqueEmail } from "../support/seed";
import {
  DEVICE_COOKIE,
  SESSION_COOKIE,
  confirmSignIn,
  requestSignInFromUi,
} from "../support/sign-in";

// The browser half of sign-in. Replay, expiry, sibling cleanup, eligibility and the throttle rules
// are owned by packages/auth/src/sign-in*.integration.test.ts; the step states by the UI tests in
// apps/web/components/auth/*.test.tsx. Here: one representative of each, through the real stack.

test("a signed-out visitor signs in by emailed link and returns to the page they asked for", async ({
  page,
  context,
  db,
  mailbox,
  baseURL,
}, testInfo) => {
  const email = uniqueEmail(testInfo, "ada");
  const ada = await seedUser(db, { email, name: "Ada Lovelace" });
  await seedOrganization(db, { name: "Acme", members: [{ user: ada, role: "owner" }] });
  const violations = await recordCspViolations(page);

  // proxy.ts sends the visitor to sign in, with the page and its query in `next`.
  await page.goto("/settings/members?x=1");
  await expect(page).toHaveURL("/sign-in?next=%2Fsettings%2Fmembers%3Fx%3D1");

  // The request goes through the real form and SMTP; the link carries `next` in its fragment.
  const link = await requestSignInFromUi({ page, mailbox, email });
  expect(link.next).toBe("/settings/members?x=1");

  // The confirm page takes the token out of the address bar before anything else can read it.
  await page.goto(link.url);
  const continueButton = page.getByRole("button", { name: "Continue to Cognitive Wealth" });
  await expect(continueButton).toBeVisible();
  await expect(page).toHaveURL(`${baseURL}/sign-in/confirm`);

  await continueButton.click();
  await expect(page).toHaveURL("/settings/members?x=1");
  await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible();

  // The cookies as Chromium stored them from the real Set-Cookie headers.
  const signedIn = await context.cookies();
  expect(signedIn.find((cookie) => cookie.name === SESSION_COOKIE)).toMatchObject({
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  });
  const device = signedIn.find((cookie) => cookie.name === DEVICE_COOKIE);
  expect(device).toMatchObject({
    path: "/api/auth",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  });

  // Signing out ends the session; the device cookie marks the browser, so it stays.
  await page.getByRole("button", { name: /Account:/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/sign-in");
  const signedOut = await context.cookies();
  expect(signedOut.map((cookie) => cookie.name)).not.toContain(SESSION_COOKIE);
  expect(signedOut.find((cookie) => cookie.name === DEVICE_COOKIE)).toEqual(device);

  // The same link again: it was spent, so it reads as used and offers a new one.
  await confirmSignIn(page, link);
  await expect(page.getByText("This sign-in link has expired or was already used.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Get a new sign-in link" })).toBeVisible();
  await expect(page).toHaveURL(`${baseURL}/sign-in/confirm`);

  expect(violations).toEqual([]);
});

test("the code from the same email signs in, and an off-site next lands on the home page", async ({
  page,
  db,
  mailbox,
}, testInfo) => {
  const email = uniqueEmail(testInfo, "ada");
  const ada = await seedUser(db, { email, name: "Ada Lovelace" });
  await seedOrganization(db, { name: "Acme", members: [{ user: ada, role: "member" }] });
  const violations = await recordCspViolations(page);

  await page.goto("/sign-in?next=//evil.example");
  const { code, next } = await requestSignInFromUi({ page, mailbox, email });
  expect(next).toBe("/");

  await page.getByRole("textbox", { name: "Sign-in code" }).click();
  await page.keyboard.type(code);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Welcome, Ada Lovelace" }),
  ).toBeVisible();
  expect(violations).toEqual([]);
});

test("a link scanner's top-level visit to verify is refused and the link still works", async ({
  page,
  context,
  db,
  mailbox,
}, testInfo) => {
  const email = uniqueEmail(testInfo, "ada");
  const ada = await seedUser(db, { email, name: "Ada Lovelace" });
  await seedOrganization(db, { name: "Acme", members: [{ user: ada, role: "member" }] });
  await page.goto("/sign-in");
  const link = await requestSignInFromUi({ page, mailbox, email });

  // What a scanner or a pasted link does: Chromium sends Sec-Fetch-Mode: navigate.
  const scan = await page.goto(
    `/api/auth/magic-link/verify?${new URLSearchParams({ token: link.token }).toString()}`,
  );
  expect(scan?.status()).toBe(403);
  expect(await scan?.json()).toEqual({ ok: false, error: "forbidden" });
  expect((await context.cookies()).map((cookie) => cookie.name)).not.toContain(SESSION_COOKIE);

  await confirmSignIn(page, link);
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Welcome, Ada Lovelace" }),
  ).toBeVisible();
});

test("repeated sign-in requests from one address get the rate-limited message", async ({
  page,
}, testInfo) => {
  // Nobody is seeded: the per-IP limit counts every request, eligible or not, and no email goes out.
  // A new address each time: the page itself stops asking for one address after 3 emails.
  const email = (request: number) => uniqueEmail(testInfo, `nobody-${request}`);
  const emailField = page.getByRole("textbox", { name: "Email" });
  const submit = page.getByRole("button", { name: "Continue" });
  await page.goto("/sign-in");

  const requestAndGoBack = async (request: number) => {
    await emailField.fill(email(request));
    await submit.click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await page.getByRole("button", { name: "Use a different email" }).click();
  };
  // `ROUTE_RATE_LIMITS` in @repo/auth: 5 sign-in requests a minute per client IP, counted in Redis.
  for (let request = 1; request <= 5; request++) {
    // Sequential on purpose: each request goes through the form in turn.
    // oxlint-disable-next-line no-await-in-loop
    await requestAndGoBack(request);
  }
  await emailField.fill(email(6));
  await submit.click();

  await expect(
    page.getByText("Too many sign-in attempts. Wait a minute, then try again."),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in to Cognitive Wealth" })).toBeVisible();
});
