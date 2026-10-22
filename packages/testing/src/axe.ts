import axe, { type Result, type RunOptions } from "axe-core";
import { expect } from "vitest";

// happy-dom has no layout or computed colours, and a component rendered alone has no landmarks.
// Contrast is covered by the Playwright axe scans instead.
const DOM_RULES: RunOptions["rules"] = {
  "color-contrast": { enabled: false },
  region: { enabled: false },
};

function formatViolations(violations: Result[]): string {
  return violations
    .map((violation) => {
      const targets = violation.nodes.map((node) => `    ${node.target.join(" ")}`).join("\n");
      return `[${violation.impact ?? "unknown"}] ${violation.id}: ${violation.help}\n  ${violation.helpUrl}\n${targets}`;
    })
    .join("\n\n");
}

expect.extend({
  async toHaveNoA11yViolations(received: Element, options: RunOptions = {}) {
    const { violations } = await axe.run(received, {
      ...options,
      rules: { ...DOM_RULES, ...options.rules },
    });
    return {
      pass: violations.length === 0,
      message: () =>
        this.isNot
          ? "Expected accessibility violations, found none"
          : `Expected no accessibility violations, found ${violations.length}:\n\n${formatViolations(violations)}`,
    };
  },
});

declare module "vitest" {
  interface Matchers<R, T> {
    /** Runs axe-core (WCAG 2.2 AA and best practices) on the element. */
    toHaveNoA11yViolations(options?: RunOptions): Promise<void>;
  }
}
