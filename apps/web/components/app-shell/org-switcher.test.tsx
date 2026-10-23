import type { PublicMembership } from "@repo/auth";
import { SidebarProvider } from "@repo/design-system/components/sidebar";
import { deferred, screen, setup } from "@repo/testing/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { switchWorkspace } from "@/app/(app)/actions";
import type { ActionResult } from "@/lib/action-result";
import { OrgSwitcher } from "./org-switcher";

vi.mock("@/app/(app)/actions", () => ({ switchWorkspace: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function membership(name: string, role: PublicMembership["role"], isActive: boolean) {
  const publicId = `0192f0c4-0000-7000-8000-${String(name.length).padStart(12, "0")}`;
  return {
    organization: { publicId, name, slug: name.toLowerCase(), logo: null },
    role,
    isActive,
  } satisfies PublicMembership;
}

const ACME = membership("Acme", "owner", true);
const GLOBEX = membership("Globex", "member", false);

beforeEach(() => {
  vi.mocked(switchWorkspace).mockResolvedValue({ ok: true });
});

function renderSwitcher(memberships: PublicMembership[]) {
  return setup(
    <SidebarProvider>
      <OrgSwitcher memberships={memberships} />
    </SidebarProvider>,
  );
}

// Open menus are checked by role only: Base UI's focus guards rely on browser focus behaviour
// happy-dom lacks (the Playwright scans cover the open menu).
async function openMenu(user: ReturnType<typeof setup>["user"]) {
  await user.click(screen.getByRole("button", { name: /^Switch workspace/ }));
  return screen.findByRole("menu");
}

describe("OrgSwitcher", () => {
  it("names the current workspace and role on its button", async () => {
    const { container } = renderSwitcher([ACME, GLOBEX]);
    const trigger = screen.getByRole("button", { name: /^Switch workspace/ });
    expect(trigger).toHaveAccessibleName(
      expect.stringContaining("Switch workspace. Current: Acme"),
    );
    expect(trigger).toHaveTextContent("Owner");
    await expect(container).toHaveNoA11yViolations();
  });

  it("lists every workspace with the current one checked", async () => {
    const { user } = renderSwitcher([ACME, GLOBEX]);
    await openMenu(user);

    const items = await screen.findAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual(["AcmeOwner", "GlobexMember"]);
    expect(screen.getByRole("menuitemradio", { name: /^Acme/ })).toBeChecked();
    expect(screen.getByRole("menuitemradio", { name: /^Globex/ })).not.toBeChecked();
  });

  it("switches to another workspace and confirms it", async () => {
    const { user } = renderSwitcher([ACME, GLOBEX]);
    await openMenu(user);
    await user.click(await screen.findByRole("menuitemradio", { name: /^Globex/ }));

    expect(switchWorkspace).toHaveBeenCalledExactlyOnceWith({
      organizationPublicId: GLOBEX.organization.publicId,
    });
    await vi.waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Switched to Globex");
    });
  });

  it("does nothing when the current workspace is picked again", async () => {
    const { user } = renderSwitcher([ACME, GLOBEX]);
    await openMenu(user);
    await user.click(await screen.findByRole("menuitemradio", { name: /^Acme/ }));

    expect(switchWorkspace).not.toHaveBeenCalled();
  });

  it("disables the button while switching", async () => {
    const pending = deferred<ActionResult>();
    vi.mocked(switchWorkspace).mockReturnValue(pending.promise);
    const { user } = renderSwitcher([ACME, GLOBEX]);
    await openMenu(user);
    await user.click(await screen.findByRole("menuitemradio", { name: /^Globex/ }));

    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: /^Switch workspace/ })).toBeDisabled();
    });
    pending.resolve({ ok: true });
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: /^Switch workspace/ })).toBeEnabled();
    });
  });

  it("explains a refused switch", async () => {
    vi.mocked(switchWorkspace).mockResolvedValue({ ok: false, error: "not_found" });
    const { user } = renderSwitcher([ACME, GLOBEX]);
    await openMenu(user);
    await user.click(await screen.findByRole("menuitemradio", { name: /^Globex/ }));

    await vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "That person or invitation is no longer here. Reload the page to see the latest.",
      );
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("falls back to the first membership when none is active", () => {
    renderSwitcher([{ ...GLOBEX }, { ...ACME, isActive: false }]);
    expect(screen.getByRole("button", { name: /^Switch workspace/ })).toHaveAccessibleName(
      expect.stringContaining("Current: Globex"),
    );
  });

  it("renders nothing without memberships", () => {
    renderSwitcher([]);
    expect(screen.queryByRole("button", { name: /^Switch workspace/ })).not.toBeInTheDocument();
  });
});
