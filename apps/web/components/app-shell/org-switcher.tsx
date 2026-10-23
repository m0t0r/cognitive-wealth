"use client";

import { UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { PublicMembership } from "@repo/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@repo/design-system/components/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@repo/design-system/components/sidebar";
import { Spinner } from "@repo/design-system/components/spinner";
import { useTransition } from "react";
import { toast } from "sonner";
import { switchWorkspace } from "@/app/(app)/actions";
import { tenantErrorMessage } from "@/lib/auth/messages";
import { ROLE_LABELS } from "@/lib/roles";

export function OrgSwitcher({ memberships }: { memberships: PublicMembership[] }) {
  const [pending, startTransition] = useTransition();
  const active = memberships.find((membership) => membership.isActive) ?? memberships[0];
  if (active === undefined) return null;

  function select(publicId: string) {
    const membership = memberships.find((item) => item.organization.publicId === publicId);
    if (membership === undefined || membership.isActive) return;
    startTransition(async () => {
      const result = await switchWorkspace({
        organizationPublicId: membership.organization.publicId,
      });
      if (result.ok) toast.success(`Switched to ${membership.organization.name}`);
      else toast.error(tenantErrorMessage(result.error));
    });
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton size="lg" />}
            disabled={pending}
            className="data-popup-open:bg-sidebar-accent"
          >
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
            >
              {active.organization.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="grid min-w-0 flex-1 text-left leading-tight">
              <span className="sr-only">Switch workspace. Current: </span>
              <span className="truncate font-medium">{active.organization.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {ROLE_LABELS[active.role]}
              </span>
            </span>
            {pending ? (
              <Spinner className="ms-auto" />
            ) : (
              <HugeiconsIcon
                icon={UnfoldMoreIcon}
                strokeWidth={2}
                className="ms-auto"
                aria-hidden
              />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-56" align="start">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={active.organization.publicId} onValueChange={select}>
                {memberships.map((membership) => (
                  <DropdownMenuRadioItem
                    key={membership.organization.publicId}
                    value={membership.organization.publicId}
                    closeOnClick
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{membership.organization.name}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {ROLE_LABELS[membership.role]}
                      </span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
