import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { recordCspViolations } from "../support/csp";
import { PUBLIC_ROUTES, type Route, SIGNED_IN_ROUTES } from "../support/routes";
import { uniqueEmail } from "../support/seed";

// What securityheaders.com grades; any one missing costs the A+.
const GRADED_HEADERS = [
  "content-security-policy",
  "strict-transport-security",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
];

function cspNonce(headers: Record<string, string>): string | undefined {
  return /'nonce-([^']+)'/.exec(headers["content-security-policy"] ?? "")?.[1];
}

/** `url` sends every graded header, and a new CSP nonce on each request. */
async function expectGradedHeaders(request: APIRequestContext, url: string) {
  const fetchHeaders = async () => {
    const response = await request.get(url, { maxRedirects: 0 });
    expect(response.status(), `${url} should render, not redirect`).toBe(200);
    return response.headers();
  };
  const [first, second] = [await fetchHeaders(), await fetchHeaders()];

  for (const name of GRADED_HEADERS) expect(first[name], name).toBeTruthy();
  expect(first["content-security-policy"]).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
  expect(cspNonce(first)).toBeTruthy();
  expect(cspNonce(first)).not.toBe(cspNonce(second));
}

async function expectRendersWithinCsp({
  page,
  route,
  url,
}: {
  page: Page;
  route: Route;
  url: string;
}) {
  const violations = await recordCspViolations(page);
  await page.goto(url);
  if (route.ready) await expect(route.ready(page)).toBeVisible();
  expect(violations).toEqual([]);
}

for (const route of PUBLIC_ROUTES) {
  test(`${route.name} sends every graded security header and a fresh CSP nonce`, async ({
    request,
  }) => {
    await expectGradedHeaders(request, route.url);
  });

  test(`${route.name} renders without CSP violations`, async ({ page }) => {
    await expectRendersWithinCsp({ page, route, url: route.url });
  });
}

for (const route of SIGNED_IN_ROUTES) {
  // One test per route: each needs its own seed and sign-in.
  test(`${route.name} (signed in) sends the graded headers and renders within the CSP`, async ({
    page,
    db,
    signIn,
  }, testInfo) => {
    const email = uniqueEmail(testInfo, "viewer");
    const url = await route.setUp(db, email);
    await signIn(email);

    // `page.request` shares the page's cookies, so it gets the signed-in page.
    await expectGradedHeaders(page.request, url);
    await expectRendersWithinCsp({ page, route, url });
    await expect(page).toHaveURL(url);
  });
}

test("interactive components stay within the CSP", async ({ page }) => {
  const violations = await recordCspViolations(page);
  await page.goto("/design-system");

  // Toasts inject sonner's stylesheet; the theme toggle re-runs next-themes.
  await page.getByRole("button", { name: "Show toast" }).click();
  await expect(page.getByText("Your changes are stored.")).toBeVisible();
  await page.keyboard.press("d");
  await page.getByRole("button", { name: "Open dialog" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  expect(violations).toEqual([]);
});

test("API routes forbid loading and framing", async ({ request }) => {
  const headers = (await request.get("/api/health")).headers();
  expect(headers["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
});
