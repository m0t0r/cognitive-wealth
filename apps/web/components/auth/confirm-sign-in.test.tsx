import { verifyMagicLink } from "@repo/auth/client";
import { screen, setup } from "@repo/testing/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmSignIn } from "./confirm-sign-in";

// Keep the real sanitizer: the page must never navigate off-site, whatever `#next` says.
vi.mock("@repo/auth/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/auth/client")>()),
  verifyMagicLink: vi.fn(),
}));

function arriveAt(url: string) {
  window.history.replaceState(null, "", url);
}

const assign = vi.fn<(url: string | URL) => void>();

beforeEach(() => {
  vi.mocked(verifyMagicLink).mockResolvedValue({ ok: true });
  vi.spyOn(window.location, "assign").mockImplementation(assign);
});

afterEach(() => {
  arriveAt("/");
});

describe("ConfirmSignIn", () => {
  it("reads the token from the fragment and clears it from the address bar", async () => {
    arriveAt("/sign-in/confirm#token=t0k3n&next=%2Fsettings%2Fmembers");
    const { container } = setup(<ConfirmSignIn />);

    expect(
      await screen.findByRole("button", { name: "Continue to Cognitive Wealth" }),
    ).toBeEnabled();
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/sign-in/confirm");
    await expect(container).toHaveNoA11yViolations();
  });

  it("spends the token only when the button is clicked, then goes to next", async () => {
    arriveAt("/sign-in/confirm#token=t0k3n&next=%2Fsettings%2Fmembers");
    const { user } = setup(<ConfirmSignIn />);
    const button = await screen.findByRole("button", { name: "Continue to Cognitive Wealth" });
    expect(verifyMagicLink).not.toHaveBeenCalled();

    await user.click(button);

    expect(verifyMagicLink).toHaveBeenCalledExactlyOnceWith("t0k3n");
    expect(assign).toHaveBeenCalledWith("/settings/members");
  });

  it("goes home when next points off-site", async () => {
    arriveAt("/sign-in/confirm#token=t0k3n&next=%2F%2Fevil.example");
    const { user } = setup(<ConfirmSignIn />);
    await user.click(await screen.findByRole("button", { name: "Continue to Cognitive Wealth" }));
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("offers a new link, keeping next, when the link has expired or was used", async () => {
    vi.mocked(verifyMagicLink).mockResolvedValue({ ok: false, error: "invalid_or_expired" });
    arriveAt("/sign-in/confirm#token=old&next=%2Finvite%2Fabc");
    const { user, container } = setup(<ConfirmSignIn />);
    await user.click(await screen.findByRole("button", { name: "Continue to Cognitive Wealth" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This sign-in link has expired or was already used.",
    );
    expect(screen.getByRole("link", { name: "Get a new sign-in link" })).toHaveAttribute(
      "href",
      "/sign-in?next=%2Finvite%2Fabc",
    );
    expect(assign).not.toHaveBeenCalled();
    await expect(container).toHaveNoA11yViolations();
  });

  it("lets people retry after a rate limit", async () => {
    vi.mocked(verifyMagicLink).mockResolvedValueOnce({ ok: false, error: "rate_limited" });
    arriveAt("/sign-in/confirm#token=t0k3n");
    const { user } = setup(<ConfirmSignIn />);
    await user.click(await screen.findByRole("button", { name: "Continue to Cognitive Wealth" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wait a minute");

    await user.click(screen.getByRole("button", { name: "Continue to Cognitive Wealth" }));
    expect(verifyMagicLink).toHaveBeenCalledTimes(2);
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("explains what to do when there's no token", async () => {
    arriveAt("/sign-in/confirm");
    const { container } = setup(<ConfirmSignIn />);

    expect(
      await screen.findByRole("heading", { name: "Open the link from your email" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "/sign-in");
    expect(verifyMagicLink).not.toHaveBeenCalled();
    await expect(container).toHaveNoA11yViolations();
  });
});
