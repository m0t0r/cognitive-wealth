"use client";

import { MoreHorizontalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { can, isRole, type Role } from "@repo/auth/access";
import { Button } from "@repo/design-system/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/design-system/components/dropdown-menu";
import { startTransition, useOptimistic, useRef, useState } from "react";
import { changeRoleAction, removeMemberAction } from "@/app/(app)/settings/members/actions";
import { assignableRoles, ROLE_CHANGED, ROLE_LABELS } from "@/lib/roles";
import { ConfirmActionDialog } from "./confirm-action-dialog";
import { useMembersFeedback } from "./members-feedback";

/** The members table's heading; focus lands there once a removed member's row is gone. */
export const MEMBERS_HEADING_ID = "members-heading";

export interface MemberRowData {
  publicId: string;
  name: string;
  email: string;
  role: Role;
}

/**
 * Change role and remove, for one row. Hidden for owners when the viewer isn't one, since only
 * owners can act on owners; the server enforces every rule regardless.
 */
export function MemberActions({ member, viewerRole }: { member: MemberRowData; viewerRole: Role }) {
  const { organizationName, report } = useMembersFeedback();
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const removedRef = useRef(false);
  const [role, setOptimisticRole] = useOptimistic(member.role);
  const displayName = member.name || member.email;

  const protectedOwner = member.role === "owner" && viewerRole !== "owner";
  const canChangeRole = can(viewerRole, "member:update") && !protectedOwner;
  const canRemove = can(viewerRole, "member:delete") && !protectedOwner;

  if (!canChangeRole && !canRemove) return null;

  async function remove() {
    const result = await removeMemberAction({ memberPublicId: member.publicId });
    removedRef.current = report(result, `${displayName} was removed from ${organizationName}.`);
    // Close either way: a failure shows as a toast, or as the "sign in again" dialog.
    setConfirming(false);
  }

  function changeRole(value: unknown) {
    if (!isRole(value) || value === member.role) return;
    startTransition(async () => {
      setOptimisticRole(value);
      const result = await changeRoleAction({ memberPublicId: member.publicId, role: value });
      report(result, ROLE_CHANGED[value](displayName));
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={triggerRef}
          render={<Button variant="ghost" size="icon-sm" />}
          aria-label={`Actions for ${displayName}`}
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {canChangeRole ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Role</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={role} onValueChange={changeRole}>
                {assignableRoles(viewerRole).map((option) => (
                  <DropdownMenuRadioItem key={option} value={option} closeOnClick>
                    {ROLE_LABELS[option]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          ) : null}
          {canChangeRole && canRemove ? <DropdownMenuSeparator /> : null}
          {canRemove ? (
            <DropdownMenuGroup>
              <DropdownMenuItem variant="destructive" onClick={() => setConfirming(true)}>
                Remove from workspace
              </DropdownMenuItem>
            </DropdownMenuGroup>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmActionDialog
        open={confirming}
        onOpenChange={setConfirming}
        finalFocus={() =>
          removedRef.current ? document.getElementById(MEMBERS_HEADING_ID) : triggerRef.current
        }
        title={`Remove ${displayName}?`}
        description={`${displayName} will lose access to ${organizationName} right away. You can invite ${member.email} again later.`}
        cancelLabel="Cancel"
        confirmLabel="Remove member"
        onConfirm={remove}
      />
    </>
  );
}
