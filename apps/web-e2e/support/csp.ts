import type { Page } from "@playwright/test";

declare global {
  interface Window {
    reportCspViolation?: (violation: string) => Promise<void>;
  }
}

/**
 * Collects every CSP violation `page` reports, from before its first script runs, across every
 * navigation from here on. Assert `toEqual([])` at the end of a journey.
 */
export async function recordCspViolations(page: Page): Promise<string[]> {
  const violations: string[] = [];
  await page.exposeFunction("reportCspViolation", (violation: string) => {
    violations.push(`${page.url()}: ${violation}`);
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
