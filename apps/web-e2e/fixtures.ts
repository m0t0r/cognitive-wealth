import { AxeBuilder } from "@axe-core/playwright";
import { test as base, expect } from "@playwright/test";

// WCAG 2.2 A/AA plus axe best practices.
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

type Violation = Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"][number];

/** One line per failing node, so a failed `toEqual([])` reads as a to-do list. */
export function summarize(violations: Violation[]): string[] {
  return violations.flatMap((violation) =>
    violation.nodes.map(
      (node) =>
        `[${violation.impact}] ${violation.id} @ ${node.target.join(" ")}: ${node.failureSummary?.split("\n").at(-1)?.trim()}`,
    ),
  );
}

export const test = base.extend<{ makeAxeBuilder: () => AxeBuilder }>({
  // Named `provide`, not `use`: React's rules-of-hooks lint mistakes Playwright's `use` for a hook.
  makeAxeBuilder: async ({ page }, provide) => {
    await provide(() => new AxeBuilder({ page }).withTags(AXE_TAGS));
  },
});

export { expect };
