import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { ROUTES } from "../support/routes";

// What securityheaders.com grades; any one missing costs the A+.
const GRADED_HEADERS = [
  "content-security-policy",
  "strict-transport-security",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
];

declare global {
  interface Window {
    reportCspViolation?: (violation: string) => Promise<void>;
  }
}

/** Collects every CSP violation the page reports, from before its first script runs. */
async function recordViolations(page: Page): Promise<string[]> {
  const violations: string[] = [];
  await page.exposeFunction("reportCspViolation", (violation: string) => {
    violations.push(violation);
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      void window.reportCspViolation?.(
        `${event.effectiveDirective} blocked ${event.blockedURI || "inline"}`,
      );
    });
  });
  return violations;
}

for (const route of ROUTES) {
  test(`${route} sends every graded security header`, async ({ request }) => {
    const headers = (await request.get(route)).headers();

    for (const name of GRADED_HEADERS) expect(headers[name], name).toBeTruthy();
    expect(headers["content-security-policy"]).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
  });

  test(`${route} gets a fresh CSP nonce on every request`, async ({ request }) => {
    const fetchNonce = async () =>
      /'nonce-([^']+)'/.exec(
        (await request.get(route)).headers()["content-security-policy"] ?? "",
      )?.[1];

    const [first, second] = [await fetchNonce(), await fetchNonce()];
    expect(first).toBeTruthy();
    expect(first).not.toBe(second);
  });

  test(`${route} renders without CSP violations`, async ({ page }) => {
    const violations = await recordViolations(page);
    await page.goto(route);

    expect(violations).toEqual([]);
  });
}

test("interactive components stay within the CSP", async ({ page }) => {
  const violations = await recordViolations(page);
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
