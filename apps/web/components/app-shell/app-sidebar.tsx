import type { PublicMembership, PublicUser } from "@repo/auth";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@repo/design-system/components/sidebar";
import { AccountMenu } from "./account-menu";
import { NavMain } from "./nav-main";
import { OrgSwitcher } from "./org-switcher";

/** Receives DTOs only: the viewer's `internal` IDs never cross into these client components. */
export function AppSidebar({
  memberships,
  user,
}: {
  memberships: PublicMembership[];
  user: Pick<PublicUser, "name" | "email" | "image">;
}) {
  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader>
        <OrgSwitcher memberships={memberships} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain />
      </SidebarContent>
      <SidebarFooter>
        <AccountMenu user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
