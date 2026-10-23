import { deferred, screen, setup } from "@repo/testing/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { respondToInvitation } from "@/app/(auth)/invite/[publicId]/actions";
import type { FormState } from "@/lib/action-result";
import { InvitationResponse } from "./invitation-response";

vi.mock("@/app/(auth)/invite/[publicId]/actions", () => ({ respondToInvitation: vi.fn() }));

const INVITATION = "0192f0c4-0000-7000-8000-00000000000a";

beforeEach(() => {
  // The real action redirects on success; a failure is the only state the form ever shows.
  vi.mocked(respondToInvitation).mockResolvedValue(null);
});

/** The form fields the last call to the action received. */
function submitted() {
  const [, formData] = vi.mocked(respondToInvitation).mock.lastCall ?? [];
  return {
    invitationPublicId: formData?.get("invitationPublicId"),
    response: formData?.get("response"),
  };
}

describe("InvitationResponse", () => {
  it.for([
    ["Accept invitation", "accept"],
    ["Decline", "decline"],
  ] as const)("sends “%s” as response=%s for this invitation", async ([name, response]) => {
    const { user, container } = setup(<InvitationResponse invitationPublicId={INVITATION} />);
    await expect(container).toHaveNoA11yViolations();

    await user.click(screen.getByRole("button", { name }));

    expect(respondToInvitation).toHaveBeenCalledOnce();
    expect(submitted()).toEqual({ invitationPublicId: INVITATION, response });
  });

  it("disables both buttons and shows progress on the chosen one while it runs", async () => {
    const pending = deferred<FormState>();
    vi.mocked(respondToInvitation).mockReturnValue(pending.promise);
    const { user } = setup(<InvitationResponse invitationPublicId={INVITATION} />);

    await user.click(screen.getByRole("button", { name: "Decline" }));

    const decline = await screen.findByRole("button", { name: /Decline/ });
    expect(decline).toBeDisabled();
    expect(screen.getByRole("button", { name: "Accept invitation" })).toBeDisabled();
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(decline).toContainElement(screen.getByRole("status", { name: "Loading" }));

    pending.resolve({ ok: false, error: "unknown" });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeEnabled();
  });

  it("explains a refusal and lets the person try again", async () => {
    vi.mocked(respondToInvitation).mockResolvedValue({ ok: false, error: "wrong_recipient" });
    const { user, container } = setup(<InvitationResponse invitationPublicId={INVITATION} />);

    await user.click(screen.getByRole("button", { name: "Accept invitation" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This invitation was sent to a different email address.",
    );
    expect(screen.getByRole("button", { name: "Accept invitation" })).toBeEnabled();
    await expect(container).toHaveNoA11yViolations();
  });
});
