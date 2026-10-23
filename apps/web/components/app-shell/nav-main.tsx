"use client";

import { Home01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@repo/design-system/components/sidebar";
import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS = [
  { label: "Workspace", items: [{ href: "/", label: "Home", icon: Home01Icon }] },
  {
    label: "Settings",
    items: [{ href: "/settings/members", label: "Members", icon: UserGroupIcon }],
  },
] as const;

export function NavMain() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  return (
    <nav aria-label="Main">
      {SECTIONS.map((section) => (
        <SidebarGroup key={section.label}>
          <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {section.items.map((item) => {
                const active =
                  item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={active}
                      render={
                        <Link
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          onClick={() => setOpenMobile(false)}
                        />
                      }
                    >
                      <HugeiconsIcon icon={item.icon} strokeWidth={2} aria-hidden />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </nav>
  );
}
