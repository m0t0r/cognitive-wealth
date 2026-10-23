"use client";

import { MoreHorizontalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { isRole, type Role } from "@repo/auth/access";
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
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import {
  assignableRoles,
  MAKE_ROLE_LABEL,
  MAKE_ROLE_TITLE,
  memberActionsFor,
  ROLE_CHANGED,
  ROLE_LABELS,
} from "@/lib/roles";
import { captureRowFocus, useMembersFeedback } from "./members-feedback";

/** The members table's heading; focus lands there once the last row's member is removed. */
export const MEMBERS_HEADING_ID = "members-heading";

export interface MemberRowData {
  publicId: string;
  name: string;
  email: string;
  role: Role;
}

/**
 * Change role and remove, for one row. Hidden for owners when the viewer isn't one, since only
 * owners can act on owners; the server enforces every rule regardless. Making someone an owner,
 * or changing an owner's role, is confirmed first: owners have full control.
 */
export function MemberActions({ member, viewerRole }: { member: MemberRowData; viewerRole: Role }) {
  const { organizationPublicId, organizationName, report, focusAfterRowRemoval } =
    useMembersFeedback();
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  // The role awaiting confirmation; kept while the dialog animates closed so its copy stays put.
  const [roleChange, setRoleChange] = useState<{ open: boolean; role: Role }>({
    open: false,
    role: member.role,
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [role, setOptimisticRole] = useOptimistic(member.role);
  const displayName = member.name || member.email;

  const allowed = memberActionsFor(viewerRole, member.role);
  if (!allowed.changeRole && !allowed.remove) return null;

  async function remove() {
    const focus = captureRowFocus(triggerRef.current, MEMBERS_HEADING_ID);
    const result = await removeMemberAction({
      organizationPublicId,
      memberPublicId: member.publicId,
    });
    if (report(result, `${displayName} was removed from ${organizationName}.`)) {
      focusAfterRowRemoval(focus);
    }
    // Close either way: a failure shows as a toast, or as the "sign in again" dialog.
    setConfirmingRemoval(false);
  }

  /** Runs inside a transition: the optimistic role shows until the page refreshes. */
  async function applyRole(value: Role) {
    setOptimisticRole(value);
    const result = await changeRoleAction({
      organizationPublicId,
      memberPublicId: member.publicId,
      role: value,
    });
    report(result, ROLE_CHANGED[value](displayName));
  }

  function chooseRole(value: unknown) {
    if (!isRole(value) || value === member.role) return;
    if (value === "owner" || member.role === "owner") {
      setRoleChange({ open: true, role: value });
      return;
    }
    startTransition(() => applyRole(value));
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
          {allowed.changeRole ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Role</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={role} onValueChange={chooseRole}>
                {assignableRoles(viewerRole).map((option) => (
                  <DropdownMenuRadioItem key={option} value={option} closeOnClick>
                    {ROLE_LABELS[option]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          ) : null}
          {allowed.changeRole && allowed.remove ? <DropdownMenuSeparator /> : null}
          {allowed.remove ? (
            <DropdownMenuGroup>
              <DropdownMenuItem variant="destructive" onClick={() => setConfirmingRemoval(true)}>
                Remove from workspace
              </DropdownMenuItem>
            </DropdownMenuGroup>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmActionDialog
        open={roleChange.open}
        onOpenChange={(open) => setRoleChange((current) => ({ ...current, open }))}
        finalFocus={triggerRef}
        title={MAKE_ROLE_TITLE[roleChange.role](displayName)}
        description={
          roleChange.role === "owner"
            ? `${displayName} will have full control of ${organizationName}, including removing other owners.`
            : `${displayName} will no longer be an owner of ${organizationName}. Owners have full control, including removing other owners.`
        }
        cancelLabel="Cancel"
        confirmLabel={MAKE_ROLE_LABEL[roleChange.role]}
        confirmVariant="default"
        onConfirm={async () => {
          await applyRole(roleChange.role);
          setRoleChange((current) => ({ ...current, open: false }));
        }}
      />
      <ConfirmActionDialog
        open={confirmingRemoval}
        onOpenChange={setConfirmingRemoval}
        finalFocus={triggerRef}
        title={`Remove ${displayName}?`}
        description={`${displayName} will lose access to ${organizationName} right away. You can invite ${member.email} again later.`}
        cancelLabel="Cancel"
        confirmLabel="Remove member"
        onConfirm={remove}
      />
    </>
  );
}
