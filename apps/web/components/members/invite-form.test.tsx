import { deferred, screen, setup, within } from "@repo/testing/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { inviteMemberAction } from "@/app/(app)/settings/members/actions";
import type { ActionResult } from "@/lib/action-result";
import { InviteForm } from "./invite-form";
import { MembersFeedbackProvider } from "./members-feedback";

vi.mock("@/app/(app)/settings/members/actions", () => ({ inviteMemberAction: vi.fn() }));
vi.mock("@repo/auth/client", () => ({ requestSignIn: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/members",
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ORG = "0192f0c4-0000-7000-8000-0000000000aa";

beforeEach(() => {
  vi.mocked(inviteMemberAction).mockResolvedValue({ ok: true });
});

function renderForm(viewerRole: "owner" | "admin") {
  return setup(
    <MembersFeedbackProvider
      email="olivia@example.com"
      organizationPublicId={ORG}
      organizationName="Acme"
    >
      <InviteForm viewerRole={viewerRole} />
    </MembersFeedbackProvider>,
  );
}

// Open popups are scanned on their own: Base UI's focus guards and inert backdrop rely on
// browser focus behaviour happy-dom lacks (the Playwright scans cover the whole page).
async function roleOptions(user: ReturnType<typeof setup>["user"]) {
  await user.click(screen.getByRole("combobox", { name: "Role" }));
  const listbox = await screen.findByRole("listbox");
  await expect(listbox).toHaveNoA11yViolations();
  return within(listbox)
    .getAllByRole("option")
    .map((option) => option.textContent);
}

describe("InviteForm", () => {
  it("lets owners invite owners, admins and members", async () => {
    const { user, container } = renderForm("owner");
    await expect(container).toHaveNoA11yViolations();
    expect(await roleOptions(user)).toEqual(["Owner", "Admin", "Member"]);
  });

  it("doesn't offer the owner role to admins", async () => {
    const { user, container } = renderForm("admin");
    await expect(container).toHaveNoA11yViolations();
    expect(await roleOptions(user)).toEqual(["Admin", "Member"]);
  });

  it("sends the email and chosen role for the workspace shown, then clears the form", async () => {
    const { user } = renderForm("owner");
    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.click(screen.getByRole("combobox", { name: "Role" }));
    await user.click(await screen.findByRole("option", { name: "Admin" }));
    await user.click(screen.getByRole("button", { name: "Send invitation" }));

    const [formData] = vi.mocked(inviteMemberAction).mock.calls[0] ?? [];
    expect(formData?.get("email")).toBe("new@example.com");
    expect(formData?.get("role")).toBe("admin");
    expect(formData?.get("organizationPublicId")).toBe(ORG);
    expect(toast.success).toHaveBeenCalledWith("Invitation sent to new@example.com.");
    expect(screen.getByLabelText("Email")).toHaveValue("");
    // Ready for the next person, rather than lost when the button was briefly disabled.
    expect(screen.getByLabelText("Email")).toHaveFocus();
    expect(screen.getByRole("combobox", { name: "Role" })).toHaveTextContent("Member");
  });

  it("explains an existing member next to the email field and keeps the input", async () => {
    vi.mocked(inviteMemberAction).mockResolvedValue({ ok: false, error: "already_member" });
    const { user, container } = renderForm("admin");
    await user.type(screen.getByLabelText("Email"), "mia@example.com");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));

    const field = screen.getByLabelText("Email");
    expect(field).toHaveAccessibleDescription("This person is already a member of this workspace.");
    expect(field).toHaveValue("mia@example.com");
    expect(field).toHaveFocus();
    expect(toast.success).not.toHaveBeenCalled();
    await expect(container).toHaveNoA11yViolations();
  });

  it("keeps focus on the button while sending", async () => {
    const pending = deferred<ActionResult>();
    vi.mocked(inviteMemberAction).mockReturnValue(pending.promise);
    const { user } = renderForm("owner");
    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));

    const button = await screen.findByRole("button", { name: /Send invitation/ });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveFocus();
    pending.resolve({ ok: true });
    await vi.waitFor(() => {
      expect(screen.getByLabelText("Email")).toHaveFocus();
    });
  });

  it("clears the form when another tab switched workspace, so a retry can't land there", async () => {
    vi.mocked(inviteMemberAction).mockResolvedValue({
      ok: false,
      error: "tenant_changed",
      workspace: "Globex",
    });
    const { user } = renderForm("owner");
    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.click(screen.getByRole("combobox", { name: "Role" }));
    await user.click(await screen.findByRole("option", { name: "Admin" }));
    await user.click(screen.getByRole("button", { name: "Send invitation" }));

    expect(toast.error).toHaveBeenCalledWith(
      "You switched workspace in another tab. This page now shows Globex.",
    );
    expect(screen.getByLabelText("Email")).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Role" })).toHaveTextContent("Member");
    expect(screen.getByLabelText("Email")).toHaveFocus();
  });

  it("toasts other errors", async () => {
    vi.mocked(inviteMemberAction).mockResolvedValue({ ok: false, error: "rate_limited" });
    const { user } = renderForm("owner");
    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(toast.error).toHaveBeenCalledWith("Too many requests. Wait a while, then try again.");
  });
});
