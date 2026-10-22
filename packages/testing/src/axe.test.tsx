import { describe, expect, it } from "vitest";
import { render } from "./react";

describe("toHaveNoA11yViolations", () => {
  it("passes for accessible markup", async () => {
    const { container } = render(<button type="button">Save</button>);
    await expect(container).toHaveNoA11yViolations();
  });

  it("fails for a control without an accessible name", async () => {
    const { container } = render(<button type="button" />);
    await expect(container).not.toHaveNoA11yViolations();
  });
});
