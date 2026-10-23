import type { Role } from "@repo/auth/access";
import { requestSignIn } from "@repo/auth/client";
import { screen, setup } from "@repo/testing/react";
import { toast } from "sonner";
import {
  cancelInvitationAction,
  changeRoleAction,
  removeMemberAction,
  resendInvitationAction,
} from "@/app/(app)/settings/members/actions";
import {
  INVITATIONS_HEADING_ID,
  InvitationActions,
  type InvitationRowData,
} from "./invitation-actions";
import { MEMBERS_HEADING_ID, MemberActions, type MemberRowData } from "./member-actions";
import { MembersFeedbackProvider } from "./members-feedback";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("@/app/(app)/settings/members/actions", () => ({
  changeRoleAction: vi.fn(),
  removeMemberAction: vi.fn(),
  cancelInvitationAction: vi.fn(),
  resendInvitationAction: vi.fn(),
}));
vi.mock("@repo/auth/client", () => ({ requestSignIn: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/members",
  useRouter: () => router,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ORG = "0192f0c4-0000-7000-8000-0000000000aa";

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
  vi.mocked(resendInvitationAction).mockResolvedValue({ ok: true });
  vi.mocked(requestSignIn).mockResolvedValue({ ok: true });
});

function Provider({ children }: { children: React.ReactNode }) {
  return (
    <MembersFeedbackProvider
      email="olivia@example.com"
      organizationPublicId={ORG}
      organizationName="Acme"
    >
      {children}
    </MembersFeedbackProvider>
  );
}

function renderRow(member: MemberRowData, viewerRole: Role) {
  return setup(
    <Provider>
      <MemberActions member={member} viewerRole={viewerRole} />
    </Provider>,
  );
}

// Open dialogs are scanned on their own: Base UI's focus guards and inert backdrop rely on browser
// focus behaviour happy-dom lacks (the Playwright scans cover the whole page).
async function openRemoveDialog(user: ReturnType<typeof setup>["user"], name = "Mia Member") {
  await user.click(screen.getByRole("button", { name: `Actions for ${name}` }));
  await user.click(await screen.findByRole("menuitem", { name: "Remove from workspace" }));
  return screen.findByRole("alertdialog", { name: `Remove ${name}?` });
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
    expect(removeMemberAction).toHaveBeenCalledExactlyOnceWith({
      organizationPublicId: ORG,
      memberPublicId: MIA.publicId,
    });
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
    expect(changeRoleAction).toHaveBeenCalledWith({
      organizationPublicId: ORG,
      memberPublicId: MIA.publicId,
      role: "admin",
    });
    expect(toast.success).toHaveBeenCalledWith("Mia Member is now an admin.");
  });

  it("confirms before making someone an owner, explaining what owners can do", async () => {
    const { user } = renderRow(MIA, "owner");
    await user.click(screen.getByRole("button", { name: "Actions for Mia Member" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Owner" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Make Mia Member an owner?" });
    expect(dialog).toHaveAccessibleDescription(
      "Mia Member will have full control of Acme, including removing other owners.",
    );
    expect(changeRoleAction).not.toHaveBeenCalled();
    await expect(dialog).toHaveNoA11yViolations();

    await user.click(screen.getByRole("button", { name: "Make owner" }));
    expect(changeRoleAction).toHaveBeenCalledExactlyOnceWith({
      organizationPublicId: ORG,
      memberPublicId: MIA.publicId,
      role: "owner",
    });
    expect(toast.success).toHaveBeenCalledWith("Mia Member is now an owner.");
  });

  it("confirms before changing an owner's role, and changes nothing when cancelled", async () => {
    const { user } = renderRow({ ...MIA, role: "owner" }, "owner");
    await user.click(screen.getByRole("button", { name: "Actions for Mia Member" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Admin" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Make Mia Member an admin?" });
    expect(dialog).toHaveAccessibleDescription(
      "Mia Member will no longer be an owner of Acme. Owners have full control, including removing other owners.",
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(changeRoleAction).not.toHaveBeenCalled();
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
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe("a refused action on a stale page", () => {
  it.for(["forbidden", "not_found", "tenant_changed"] as const)(
    "explains %s and reloads the page's data",
    async (error) => {
      vi.mocked(changeRoleAction).mockResolvedValue({ ok: false, error });
      const { user } = renderRow(MIA, "admin");
      await user.click(screen.getByRole("button", { name: "Actions for Mia Member" }));
      await user.click(await screen.findByRole("menuitemradio", { name: "Admin" }));

      await vi.waitFor(() => {
        expect(router.refresh).toHaveBeenCalledOnce();
      });
      expect(toast.error).toHaveBeenCalledOnce();
      expect(toast.success).not.toHaveBeenCalled();
    },
  );

  it("names the workspace another tab switched to", async () => {
    vi.mocked(removeMemberAction).mockResolvedValue({
      ok: false,
      error: "tenant_changed",
      workspace: "Globex",
    });
    const { user } = renderRow(MIA, "owner");
    await openRemoveDialog(user);
    await user.click(screen.getByRole("button", { name: "Remove member" }));

    expect(toast.error).toHaveBeenCalledWith(
      "You switched workspace in another tab. This page now shows Globex.",
    );
    expect(router.refresh).toHaveBeenCalledOnce();
  });
});

// The rows a table shows; re-rendering without one stands in for the refresh after an action.
function InvitationsTable({
  invitations,
  viewerRole = "admin",
}: {
  invitations: InvitationRowData[];
  viewerRole?: Role;
}) {
  return (
    <Provider>
      <h2 id={INVITATIONS_HEADING_ID} tabIndex={-1}>
        Pending invitations
      </h2>
      <table>
        <tbody>
          {invitations.map((invitation) => (
            <tr key={invitation.publicId}>
              <td>{invitation.email}</td>
              <td>
                <InvitationActions invitation={invitation} viewerRole={viewerRole} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Provider>
  );
}

function invitationTo(email: string, expired = false): InvitationRowData {
  const id = email.length.toString(16).padStart(12, "0");
  return { publicId: `0192f0c4-0000-7000-8000-${id}`, email, role: "member", expired };
}

const NEW = invitationTo("new@example.com");
const NEXT = invitationTo("next.person@example.com");

describe("InvitationActions", () => {
  it("confirms before cancelling an invitation", async () => {
    const { user, container } = setup(<InvitationsTable invitations={[NEW]} />);
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
      organizationPublicId: ORG,
      invitationPublicId: NEW.publicId,
    });
    expect(toast.success).toHaveBeenCalledWith("Invitation to new@example.com cancelled.");
  });

  it("moves focus to the next row's actions once a cancelled row is gone", async () => {
    const { user, rerender } = setup(<InvitationsTable invitations={[NEW, NEXT]} />);
    await user.click(screen.getByRole("button", { name: "Cancel invitation to new@example.com" }));
    await user.click(await screen.findByRole("button", { name: "Cancel invitation" }));
    rerender(<InvitationsTable invitations={[NEXT]} />);

    await vi.waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Cancel invitation to next.person@example.com" }),
      ).toHaveFocus();
    });
  });

  it("moves focus to the section heading once the last row is gone", async () => {
    const { user, rerender } = setup(<InvitationsTable invitations={[NEXT, NEW]} />);
    await user.click(screen.getByRole("button", { name: "Cancel invitation to new@example.com" }));
    await user.click(await screen.findByRole("button", { name: "Cancel invitation" }));
    rerender(<InvitationsTable invitations={[NEXT]} />);

    await vi.waitFor(() => {
      expect(screen.getByRole("heading", { name: "Pending invitations" })).toHaveFocus();
    });
  });

  it("offers to send an expired invitation again, to the same address and role", async () => {
    const expired = { ...invitationTo("late@example.com", true), role: "admin" as const };
    const { user, container, rerender } = setup(<InvitationsTable invitations={[expired, NEXT]} />);
    expect(screen.queryByRole("button", { name: /again$/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Send the invitation to next.person@example.com again",
      }),
    ).not.toBeInTheDocument();
    await expect(container).toHaveNoA11yViolations();

    await user.click(
      screen.getByRole("button", { name: "Send the invitation to late@example.com again" }),
    );
    expect(resendInvitationAction).toHaveBeenCalledExactlyOnceWith({
      organizationPublicId: ORG,
      email: "late@example.com",
      role: "admin",
    });
    expect(toast.success).toHaveBeenCalledWith("Invitation sent again to late@example.com.");
    // The new invitation replaces the expired one's row.
    rerender(<InvitationsTable invitations={[NEXT]} />);
    await vi.waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Cancel invitation to next.person@example.com" }),
      ).toHaveFocus();
    });
  });

  it("is hidden from members", () => {
    setup(
      <InvitationsTable
        invitations={[invitationTo("new@example.com", true)]}
        viewerRole="member"
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

// The members table, re-rendered without a row to stand in for the refresh after a removal.
function Members({ members }: { members: MemberRowData[] }) {
  return (
    <Provider>
      <h2 id={MEMBERS_HEADING_ID} tabIndex={-1}>
        Members
      </h2>
      <table>
        <tbody>
          {members.map((member) => (
            <tr key={member.publicId}>
              <td>
                <MemberActions member={member} viewerRole="owner" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Provider>
  );
}

describe("removing a member", () => {
  it("moves focus to the next row's actions, or the heading when none is left", async () => {
    const CY = { ...MIA, publicId: "0192f0c4-0000-7000-8000-0000000000c1", name: "Cy" };
    const { user, rerender } = setup(<Members members={[MIA, CY]} />);
    await openRemoveDialog(user);
    await user.click(screen.getByRole("button", { name: "Remove member" }));
    rerender(<Members members={[CY]} />);
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: "Actions for Cy" })).toHaveFocus();
    });

    await openRemoveDialog(user, "Cy");
    await user.click(screen.getByRole("button", { name: "Remove member" }));
    rerender(<Members members={[]} />);
    await vi.waitFor(() => {
      expect(screen.getByRole("heading", { name: "Members" })).toHaveFocus();
    });
  });
});
