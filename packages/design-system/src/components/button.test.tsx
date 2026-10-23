import { render, setup, screen } from "@repo/testing/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("has no accessibility violations", async () => {
    const { container } = render(
      <>
        <Button>Save</Button>
        <Button variant="outline" aria-label="Close" size="icon">
          <svg aria-hidden="true" />
        </Button>
      </>,
    );
    await expect(container).toHaveNoA11yViolations();
  });

  it("calls onClick when activated by mouse or keyboard", async () => {
    const onClick = vi.fn();
    const { user } = setup(<Button onClick={onClick}>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });

    await user.click(button);
    await user.keyboard("{Enter}");

    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("is not interactive when disabled", async () => {
    const onClick = vi.fn();
    const { user } = setup(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(onClick).not.toHaveBeenCalled();
  });

  // The disabled look keys off `aria-disabled` here: the native `disabled` attribute isn't set.
  it("stays focusable but inert when disabled with focusableWhenDisabled", async () => {
    const onClick = vi.fn();
    const { user } = setup(
      <Button disabled focusableWhenDisabled onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Save" });

    await user.tab();
    await user.keyboard("{Enter}");

    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toHaveAttribute("disabled");
    expect(onClick).not.toHaveBeenCalled();
  });
});
