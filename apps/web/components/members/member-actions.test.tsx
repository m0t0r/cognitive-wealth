import type { Role } from "@repo/auth/access";
import { requestSignIn } from "@repo/auth/client";
import { screen, setup } from "@repo/testing/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelInvitationAction,
  changeRoleAction,
  removeMemberAction,
} from "@/app/(app)/settings/members/actions";
import { InvitationActions } from "./invitation-actions";
import { MemberActions, type MemberRowData } from "./member-actions";
import { MembersFeedbackProvider } from "./members-feedback";

vi.mock("@/app/(app)/settings/members/actions", () => ({
  changeRoleAction: vi.fn(),
  removeMemberAction: vi.fn(),
  cancelInvitationAction: vi.fn(),
}));
vi.mock("@repo/auth/client", () => ({ requestSignIn: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/settings/members" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const MIA: MemberRowData = {
  publicId: "0192f0c4-0000-7000-8000-000000000001",
  name: "Mia Member",
  email: "mia@example.com",
  role: "member",
};

beforeEach(() => {
  vi.mocked(changeRoleAction).mockResolvedValue({ ok: true });
  vi.mocked(removeMemberAction).mockResolvedValue({ ok: true });
  vi.mocked(cancelInvitationAction).mockResolvedValue({ ok: true });
  vi.mocked(requestSignIn).mockResolvedValue({ ok: true });
});

function renderRow(member: MemberRowData, viewerRole: Role) {
  return setup(
    <MembersFeedbackProvider email="olivia@example.com" organizationName="Acme">
      <MemberActions member={member} viewerRole={viewerRole} />
    </MembersFeedbackProvider>,
  );
}

// Open dialogs are scanned on their own: Base UI's focus guards and inert backdrop rely on browser
// focus behaviour happy-dom lacks (the Playwright scans cover the whole page).
async function openRemoveDialog(user: ReturnType<typeof setup>["user"]) {
  await user.click(screen.getByRole("button", { name: "Actions for Mia Member" }));
  await user.click(await screen.findByRole("menuitem", { name: "Remove from workspace" }));
  return screen.findByRole("alertdialog", { name: "Remove Mia Member?" });
}

describe("MemberActions", () => {
  it("confirms a removal in a dialog that names the person", async () => {
    const { user, container } = renderRow(MIA, "owner");
    await expect(container).toHaveNoA11yViolations();
    const dialog = await openRemoveDialog(user);

    expect(dialog).toHaveAccessibleDescription(
      "Mia Member will lose access to Acme right away. You can invite mia@example.com again later.",
    );
    expect(removeMemberAction).not.toHaveBeenCalled();
    await expect(dialog).toHaveNoA11yViolations();

    await user.click(screen.getByRole("button", { name: "Remove member" }));
    expect(removeMemberAction).toHaveBeenCalledExactlyOnceWith({ memberPublicId: MIA.publicId });
    expect(toast.success).toHaveBeenCalledWith("Mia Member was removed from Acme.");
  });

  it("removes nobody when the dialog is cancelled", async () => {
    const { user } = renderRow(MIA, "admin");
    await openRemoveDialog(user);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(removeMemberAction).not.toHaveBeenCalled();
  });

  it("changes the role from the menu, offering owner only to owners", async () => {
    const { user } = renderRow(MIA, "admin");
    await user.click(screen.getByRole("button", { name: "Actions for Mia Member" }));
    const roles = await screen.findAllByRole("menuitemradio");
    expect(roles.map((role) => role.textContent)).toEqual(["Admin", "Member"]);
    expect(screen.getByRole("menuitemradio", { name: "Member" })).toBeChecked();

    await user.click(screen.getByRole("menuitemradio", { name: "Admin" }));
    expect(changeRoleAction).toHaveBeenCalledWith({ memberPublicId: MIA.publicId, role: "admin" });
    expect(toast.success).toHaveBeenCalledWith("Mia Member is now an admin.");
  });

  it("shows no actions on an owner's row to an admin", () => {
    renderRow({ ...MIA, role: "owner" }, "admin");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("asks for a fresh sign-in when the session is too old", async () => {
    vi.mocked(removeMemberAction).mockResolvedValue({ ok: false, error: "reauth_required" });
    const { user } = renderRow(MIA, "owner");
    await openRemoveDialog(user);
    await user.click(screen.getByRole("button", { name: "Remove member" }));

    const reauth = await screen.findByRole("dialog", { name: "Sign in again to continue" });
    expect(reauth).toBeVisible();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await expect(reauth).toHaveNoA11yViolations();

    await user.click(screen.getByRole("button", { name: "Send sign-in link" }));
    expect(requestSignIn).toHaveBeenCalledWith("olivia@example.com", "/settings/members");
    expect(await screen.findByRole("dialog", { name: "Check your email" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Done" })).toHaveFocus();
  });
});

describe("InvitationActions", () => {
  const invitation = { publicId: "0192f0c4-0000-7000-8000-000000000002", email: "new@example.com" };

  it("confirms before cancelling an invitation", async () => {
    const { user, container } = setup(
      <MembersFeedbackProvider email="olivia@example.com" organizationName="Acme">
        <InvitationActions invitation={invitation} viewerRole="admin" />
      </MembersFeedbackProvider>,
    );
    await expect(container).toHaveNoA11yViolations();
    await user.click(screen.getByRole("button", { name: "Cancel invitation to new@example.com" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Cancel the invitation to new@example.com?",
    });
    expect(dialog).toBeVisible();
    expect(cancelInvitationAction).not.toHaveBeenCalled();
    await expect(dialog).toHaveNoA11yViolations();

    await user.click(screen.getByRole("button", { name: "Cancel invitation" }));
    expect(cancelInvitationAction).toHaveBeenCalledWith({
      invitationPublicId: invitation.publicId,
    });
    expect(toast.success).toHaveBeenCalledWith("Invitation to new@example.com cancelled.");
  });

  it("is hidden from members", () => {
    setup(
      <MembersFeedbackProvider email="mia@example.com" organizationName="Acme">
        <InvitationActions invitation={invitation} viewerRole="member" />
      </MembersFeedbackProvider>,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
