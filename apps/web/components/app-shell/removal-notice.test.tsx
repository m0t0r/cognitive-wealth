import { screen, setup } from "@repo/testing/react";
import { dismissRemovalNotice } from "@/app/(app)/actions";
import { RemovalNotice } from "./removal-notice";

vi.mock("@/app/(app)/actions", () => ({ dismissRemovalNotice: vi.fn() }));

beforeEach(() => {
  vi.mocked(dismissRemovalNotice).mockResolvedValue({ submitted: 1 });
});

/** The notice where the app layout puts it: in `main`, above the page and its `h1`. */
function renderNotice(firm: string | null) {
  return setup(
    <main>
      <RemovalNotice firm={firm} workspace="Globex" />
      <h1>Home</h1>
    </main>,
  );
}

describe("RemovalNotice", () => {
  it("says the viewer is no longer a member, as a status, without taking focus", async () => {
    const { container } = renderNotice("Acme");

    expect(screen.getByRole("status")).toHaveTextContent(
      "You're no longer a member of Acme. You're now in Globex.",
    );
    expect(screen.getByRole("button", { name: "Dismiss notice about Acme" })).toHaveTextContent(
      "Dismiss",
    );
    expect(document.body).toHaveFocus();
    await expect(container).toHaveNoA11yViolations();
  });

  it("dismisses it and moves focus to the page's h1", async () => {
    const { user } = renderNotice("Acme");

    await user.click(screen.getByRole("button", { name: "Dismiss notice about Acme" }));

    await vi.waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Home" })).toHaveFocus();
    });
    expect(dismissRemovalNotice).toHaveBeenCalledOnce();
  });

  it("keeps an empty status region without a Removal, so the notice is announced when it comes", () => {
    const { rerender } = renderNotice(null);
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    // The layout catching up after the request that moved the session (`RefreshStaleShell`).
    rerender(
      <main>
        <RemovalNotice firm="Acme" workspace="Globex" />
        <h1>Home</h1>
      </main>,
    );

    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("You're no longer a member of Acme. You're now in Globex.");
  });
});
