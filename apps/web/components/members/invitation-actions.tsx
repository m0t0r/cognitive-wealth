"use client";

import { can, type Role } from "@repo/auth/access";
import { AlertDialogTrigger } from "@repo/design-system/components/alert-dialog";
import { Button } from "@repo/design-system/components/button";
import { useState } from "react";
import { cancelInvitationAction } from "@/app/(app)/settings/members/actions";
import { ConfirmActionDialog } from "./confirm-action-dialog";
import { useMembersFeedback } from "./members-feedback";

export function InvitationActions({
  invitation,
  viewerRole,
}: {
  invitation: { publicId: string; email: string };
  viewerRole: Role;
}) {
  const { report } = useMembersFeedback();
  const [open, setOpen] = useState(false);

  if (!can(viewerRole, "invitation:cancel")) return null;

  async function cancel() {
    const result = await cancelInvitationAction({ invitationPublicId: invitation.publicId });
    report(result, `Invitation to ${invitation.email} cancelled.`);
    // Close either way: a failure shows as a toast, or as the "sign in again" dialog.
    setOpen(false);
  }

  return (
    <ConfirmActionDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <AlertDialogTrigger
          render={<Button variant="ghost" size="sm" />}
          aria-label={`Cancel invitation to ${invitation.email}`}
        >
          Cancel
        </AlertDialogTrigger>
      }
      title={`Cancel the invitation to ${invitation.email}?`}
      description="The link in their invitation email will stop working. You can invite them again later."
      cancelLabel="Keep invitation"
      confirmLabel="Cancel invitation"
      onConfirm={cancel}
    />
  );
}
