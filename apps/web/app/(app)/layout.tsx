import { Separator } from "@repo/design-system/components/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@repo/design-system/components/sidebar";
import { cookies } from "next/headers";
import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { requireAppViewer } from "@/lib/auth/viewer";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const [viewer, cookieStore] = await Promise.all([requireAppViewer(), cookies()]);
  // The sidebar remembers whether it was collapsed in this cookie (see SidebarProvider).
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

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
          <p className="truncate text-sm font-medium">{viewer.tenant.organization.name}</p>
        </header>
        <div className="flex flex-1 flex-col px-4 py-8 md:px-8">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
