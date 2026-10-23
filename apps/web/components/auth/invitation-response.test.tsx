import { deferred, screen, setup } from "@repo/testing/react";
import {
  acceptInvitationAction,
  declineInvitationAction,
} from "@/app/(auth)/invite/[publicId]/actions";
import type { FormState } from "@/lib/action-result";
import { type InvitationDetails, InvitationResponse } from "./invitation-response";

vi.mock("@/app/(auth)/invite/[publicId]/actions", () => ({
  acceptInvitationAction: vi.fn(),
  declineInvitationAction: vi.fn(),
}));

const INVITATION: InvitationDetails = {
  publicId: "0192f0c4-0000-7000-8000-00000000000a",
  organizationName: "Acme",
  inviterName: "Olivia Owner",
  role: "admin",
  email: "ivy@example.com",
};

beforeEach(() => {
  // The real accept action redirects on success; a failure is the only state the form shows.
  vi.mocked(acceptInvitationAction).mockResolvedValue(null);
  vi.mocked(declineInvitationAction).mockResolvedValue({ ok: true });
});

function renderResponse(hasWorkspace = false) {
  return setup(<InvitationResponse invitation={INVITATION} hasWorkspace={hasWorkspace} />);
}

describe("InvitationResponse", () => {
  it("shows who invited whom, and accepts this invitation", async () => {
    const { user, container } = renderResponse();
    expect(screen.getByRole("heading", { name: "Join Acme" })).toBeInTheDocument();
    expect(
      screen.getByText("Olivia Owner invited you to join Acme on Cognitive Wealth."),
    ).toBeVisible();
    await expect(container).toHaveNoA11yViolations();

    await user.click(screen.getByRole("button", { name: "Accept invitation" }));

    expect(acceptInvitationAction).toHaveBeenCalledOnce();
    const [, formData] = vi.mocked(acceptInvitationAction).mock.lastCall ?? [];
    expect(formData?.get("invitationPublicId")).toBe(INVITATION.publicId);
  });

  it("disables both buttons and shows progress while accepting", async () => {
    const pending = deferred<FormState>();
    vi.mocked(acceptInvitationAction).mockReturnValue(pending.promise);
    const { user } = renderResponse();

    await user.click(screen.getByRole("button", { name: "Accept invitation" }));

    const accept = await screen.findByRole("button", { name: /Accept invitation/ });
    expect(accept).toHaveAttribute("aria-disabled", "true");
    expect(accept).toContainElement(screen.getByRole("status", { name: "Loading" }));
    expect(screen.getByRole("button", { name: "Decline" })).toBeDisabled();

    pending.resolve({ ok: false, error: "wrong_recipient" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This invitation was sent to a different email address.",
    );
    expect(screen.getByRole("button", { name: "Accept invitation" })).toBeEnabled();
  });

  it("confirms before declining, and declines nothing when kept", async () => {
    const { user } = renderResponse();
    await user.click(screen.getByRole("button", { name: "Decline" }));

    const dialog = await screen.findByRole("alertdialog", {
      name: "Decline the invitation to Acme?",
    });
    expect(dialog).toHaveAccessibleDescription(
      "You won't join Acme. To join later, you'll need a new invitation.",
    );
    await expect(dialog).toHaveNoA11yViolations();
    await user.click(screen.getByRole("button", { name: "Keep invitation" }));

    expect(declineInvitationAction).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Join Acme" })).toBeInTheDocument();
  });

  it.for([
    [false, "Continue"],
    [true, "Go to your workspace"],
  ] as const)(
    "after declining (has a workspace: %s), says so and offers “%s”",
    async ([hasWorkspace, next]) => {
      const { user, container } = renderResponse(hasWorkspace);
      await user.click(screen.getByRole("button", { name: "Decline" }));
      await user.click(await screen.findByRole("button", { name: "Decline invitation" }));

      expect(declineInvitationAction).toHaveBeenCalledExactlyOnceWith({
        invitationPublicId: INVITATION.publicId,
      });
      const heading = await screen.findByRole("heading", { name: "Invitation declined" });
      await vi.waitFor(() => {
        expect(heading).toHaveFocus();
      });
      expect(
        screen.getByText(
          "You won't join Acme. If you change your mind, ask Olivia Owner to invite you again.",
        ),
      ).toBeVisible();
      // Not a page that says to open the invitation link they just declined.
      expect(screen.getByRole("link", { name: next })).toHaveAttribute("href", "/");
      await expect(container).toHaveNoA11yViolations();
    },
  );

  it("shows the error of the answer tried last, not an older one", async () => {
    vi.mocked(acceptInvitationAction).mockResolvedValue({ ok: false, error: "rate_limited" });
    vi.mocked(declineInvitationAction).mockResolvedValue({ ok: false, error: "not_found" });
    const { user } = renderResponse();
    await user.click(screen.getByRole("button", { name: "Accept invitation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You've reached the hourly limit for this.",
    );

    await user.click(screen.getByRole("button", { name: "Decline" }));
    await user.click(await screen.findByRole("button", { name: "Decline invitation" }));

    await vi.waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "That person or invitation is no longer here.",
      );
    });
  });

  it("explains a failed decline and keeps the invitation open", async () => {
    vi.mocked(declineInvitationAction).mockResolvedValue({ ok: false, error: "unknown" });
    const { user } = renderResponse();
    await user.click(screen.getByRole("button", { name: "Decline" }));
    await user.click(await screen.findByRole("button", { name: "Decline invitation" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to finish that. Try again.");
    expect(screen.getByRole("heading", { name: "Join Acme" })).toBeInTheDocument();
  });
});
