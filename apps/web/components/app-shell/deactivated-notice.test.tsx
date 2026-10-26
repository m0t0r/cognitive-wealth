import { screen, setup } from "@repo/testing/react";
import { dismissDeactivatedNotice } from "@/app/(app)/actions";
import { DeactivatedNotice } from "./deactivated-notice";

vi.mock("@/app/(app)/actions", () => ({ dismissDeactivatedNotice: vi.fn() }));

const ACME = {
  publicId: "0192f0c4-0000-7000-8000-000000000001",
  name: "Acme",
  deactivatedAt: new Date("2026-10-01T12:00:00.123Z"),
};
const GLOBEX = {
  publicId: "0192f0c4-0000-7000-8000-000000000002",
  name: "Globex",
  deactivatedAt: new Date("2026-10-02T08:30:00Z"),
};

beforeEach(() => {
  vi.mocked(dismissDeactivatedNotice).mockResolvedValue({ submitted: 1 });
});

/** The notice where the app layout puts it: in `main`, above the page and its `h1`. */
function renderNotice(firms: (typeof ACME)[]) {
  return setup(
    <main>
      <DeactivatedNotice firms={firms} workspace="Initech" />
      <h1>Home</h1>
    </main>,
  );
}

describe("DeactivatedNotice", () => {
  it("says one Firm no longer uses Cognitive Wealth, without taking focus", async () => {
    const { container } = renderNotice([ACME]);

    expect(
      screen.getByText(
        "Acme no longer uses Cognitive Wealth, so its workspace is no longer available. You're in Initech.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(document.body).toHaveFocus();
    await expect(container).toHaveNoA11yViolations();
  });

  it("names several Firms together", async () => {
    const { container } = renderNotice([ACME, GLOBEX]);

    expect(
      screen.getByText(
        "Acme and Globex no longer use Cognitive Wealth, so their workspaces are no longer available. You're in Initech.",
      ),
    ).toBeInTheDocument();
    await expect(container).toHaveNoA11yViolations();
  });

  it("dismisses every Firm it named and moves focus to the page's h1", async () => {
    const { user } = renderNotice([ACME, GLOBEX]);
    const dismissButton = screen.getByRole("button", { name: "Dismiss notice" });
    expect(dismissButton).toHaveTextContent("Dismiss");

    await user.click(dismissButton);

    const heading = screen.getByRole("heading", { level: 1, name: "Home" });
    await vi.waitFor(() => {
      expect(heading).toHaveFocus();
    });
    // Like the app's other focus-target headings: focusable by script only, with no ring.
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(heading).toHaveClass("outline-none");
    expect(dismissDeactivatedNotice).toHaveBeenCalledOnce();
    const form = vi.mocked(dismissDeactivatedNotice).mock.calls[0]![1];
    expect(form.getAll("firm")).toEqual([
      `${ACME.publicId}~${ACME.deactivatedAt.getTime()}`,
      `${GLOBEX.publicId}~${GLOBEX.deactivatedAt.getTime()}`,
    ]);
  });

  it("renders nothing without Firms to name", () => {
    renderNotice([]);
    expect(screen.queryByRole("button", { name: "Dismiss notice" })).not.toBeInTheDocument();
  });
});
