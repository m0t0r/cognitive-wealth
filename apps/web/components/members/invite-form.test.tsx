import { screen, setup, within } from "@repo/testing/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { inviteMemberAction } from "@/app/(app)/settings/members/actions";
import { InviteForm } from "./invite-form";
import { MembersFeedbackProvider } from "./members-feedback";

vi.mock("@/app/(app)/settings/members/actions", () => ({ inviteMemberAction: vi.fn() }));
vi.mock("@repo/auth/client", () => ({ requestSignIn: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/settings/members" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.mocked(inviteMemberAction).mockResolvedValue({ ok: true });
});

function renderForm(viewerRole: "owner" | "admin") {
  return setup(
    <MembersFeedbackProvider email="olivia@example.com" organizationName="Acme">
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

  it("sends the email and chosen role, then clears the form", async () => {
    const { user } = renderForm("owner");
    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.click(screen.getByRole("combobox", { name: "Role" }));
    await user.click(await screen.findByRole("option", { name: "Admin" }));
    await user.click(screen.getByRole("button", { name: "Send invitation" }));

    const [formData] = vi.mocked(inviteMemberAction).mock.calls[0] ?? [];
    expect(formData?.get("email")).toBe("new@example.com");
    expect(formData?.get("role")).toBe("admin");
    expect(toast.success).toHaveBeenCalledWith("Invitation sent to new@example.com.");
    expect(screen.getByLabelText("Email")).toHaveValue("");
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
    expect(toast.success).not.toHaveBeenCalled();
    await expect(container).toHaveNoA11yViolations();
  });

  it("toasts other errors", async () => {
    vi.mocked(inviteMemberAction).mockResolvedValue({ ok: false, error: "rate_limited" });
    const { user } = renderForm("owner");
    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(toast.error).toHaveBeenCalledWith("Too many requests. Wait a while, then try again.");
  });
});
