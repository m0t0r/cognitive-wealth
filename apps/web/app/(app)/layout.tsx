import { Separator } from "@repo/design-system/components/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@repo/design-system/components/sidebar";
import { cookies } from "next/headers";
import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { DeactivatedNotice } from "@/components/app-shell/deactivated-notice";
import { requireAppViewer } from "@/lib/auth/viewer";
import { DISMISSED_NOTICES_COOKIE, parseDismissals, undismissed } from "@/lib/dismissed-notices";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const [viewer, cookieStore] = await Promise.all([requireAppViewer(), cookies()]);
  // The sidebar remembers whether it was collapsed in this cookie (see SidebarProvider).
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";
  // Worked out on every request from the viewer's Firms, never only on the one that moved them off
  // a Deactivated Firm, which may be a Server Action or a prefetch (ADR 0022, point 10).
  const notice = undismissed({
    firms: viewer.deactivatedFirms,
    dismissals: parseDismissals(cookieStore.get(DISMISSED_NOTICES_COOKIE)?.value),
  });

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar
        memberships={viewer.memberships}
        user={{ name: viewer.user.name, email: viewer.user.email, image: viewer.user.image }}
      />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ms-1.5" />
          <Separator
            orientation="vertical"
            className="data-vertical:h-4 data-vertical:self-center"
          />
          {/* One line; `title` shows a long name in full on hover (the text itself is whole). */}
          <p
            className="min-w-0 truncate text-sm font-medium"
            title={viewer.tenant.organization.name}
          >
            {viewer.tenant.organization.name}
          </p>
        </header>
        <DeactivatedNotice firms={notice} workspace={viewer.tenant.organization.name} />
        <div className="flex flex-1 flex-col px-4 py-8 md:px-8">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
