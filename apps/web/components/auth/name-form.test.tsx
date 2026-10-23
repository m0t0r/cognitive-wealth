import { deferred, screen, setup } from "@repo/testing/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveName } from "@/app/(auth)/welcome/actions";
import type { FormState } from "@/lib/action-result";
import { NameForm } from "./name-form";

vi.mock("@/app/(auth)/welcome/actions", () => ({ saveName: vi.fn() }));

beforeEach(() => {
  // The real action redirects on success; a failure is the only state the form ever shows.
  vi.mocked(saveName).mockResolvedValue(null);
});

function submitted() {
  const [, formData] = vi.mocked(saveName).mock.lastCall ?? [];
  return { name: formData?.get("name"), next: formData?.get("next") };
}

describe("NameForm", () => {
  it("sends the name and where to go next", async () => {
    const { user, container } = setup(<NameForm next="/invite/abc" />);
    const name = screen.getByLabelText("Name");
    expect(name).toBeRequired();
    expect(name).toHaveAttribute("autocomplete", "name");
    expect(name).toHaveAttribute("maxlength", "100");
    await expect(container).toHaveNoA11yViolations();

    await user.type(name, "Ada Lovelace");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(saveName).toHaveBeenCalledOnce();
    expect(submitted()).toEqual({ name: "Ada Lovelace", next: "/invite/abc" });
  });

  it("sends an empty next without a destination", async () => {
    const { user } = setup(<NameForm next={null} />);
    await user.type(screen.getByLabelText("Name"), "Ada");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(submitted()).toEqual({ name: "Ada", next: "" });
  });

  it("disables the button and shows progress while saving", async () => {
    const pending = deferred<FormState>();
    vi.mocked(saveName).mockReturnValue(pending.promise);
    const { user } = setup(<NameForm next={null} />);
    await user.type(screen.getByLabelText("Name"), "Ada");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("button", { name: /Continue/ })).toBeDisabled();
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();

    pending.resolve({ ok: false, error: "unknown" });
    expect(await screen.findByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("ties an invalid name's message to the field", async () => {
    vi.mocked(saveName).mockResolvedValue({ ok: false, error: "invalid_input" });
    const { user, container } = setup(<NameForm next={null} />);
    await user.type(screen.getByLabelText("Name"), "   ");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    const field = await screen.findByRole("textbox", { description: /Enter your name/ });
    expect(field).toHaveAccessibleDescription("Enter your name, up to 100 characters.");
    expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(container).toHaveNoA11yViolations();
  });

  it("shows other errors in the same place", async () => {
    vi.mocked(saveName).mockResolvedValue({ ok: false, error: "reauth_required" });
    const { user } = setup(<NameForm next={null} />);
    await user.type(screen.getByLabelText("Name"), "Ada");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in again to continue.");
    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription("Sign in again to continue.");
  });
});
