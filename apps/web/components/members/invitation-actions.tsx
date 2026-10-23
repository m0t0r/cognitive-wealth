"use client";

import { can, type Role } from "@repo/auth/access";
import { AlertDialogTrigger } from "@repo/design-system/components/alert-dialog";
import { Button } from "@repo/design-system/components/button";
import { Spinner } from "@repo/design-system/components/spinner";
import { useRef, useState, useTransition } from "react";
import {
  cancelInvitationAction,
  resendInvitationAction,
} from "@/app/(app)/settings/members/actions";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { captureRowFocus, useMembersFeedback } from "./members-feedback";

/** The pending invitations heading; focus lands there once the last invitation's row is gone. */
export const INVITATIONS_HEADING_ID = "invitations-heading";

export interface InvitationRowData {
  publicId: string;
  email: string;
  role: Role;
  /** Past its expiry: it can't be accepted, but can be sent again. */
  expired: boolean;
}

export function InvitationActions({
  invitation,
  viewerRole,
}: {
  invitation: InvitationRowData;
  viewerRole: Role;
}) {
  const { organizationPublicId, report, focusAfterRowRemoval } = useMembersFeedback();
  const [open, setOpen] = useState(false);
  const [resending, startResend] = useTransition();
  const cellRef = useRef<HTMLDivElement>(null);

  const canCancel = can(viewerRole, "invitation:cancel");
  const canResend = invitation.expired && can(viewerRole, "invitation:create");
  if (!canCancel && !canResend) return null;

  async function cancel() {
    const focus = captureRowFocus(cellRef.current, INVITATIONS_HEADING_ID);
    const result = await cancelInvitationAction({
      organizationPublicId,
      invitationPublicId: invitation.publicId,
    });
    if (report(result, `Invitation to ${invitation.email} cancelled.`)) {
      focusAfterRowRemoval(focus);
    }
    // Close either way: a failure shows as a toast, or as the "sign in again" dialog.
    setOpen(false);
  }

  function resend() {
    startResend(async () => {
      // The new invitation replaces this one, so this row goes away.
      const focus = captureRowFocus(cellRef.current, INVITATIONS_HEADING_ID);
      const result = await resendInvitationAction({
        organizationPublicId,
        email: invitation.email,
        role: invitation.role,
      });
      if (report(result, `Invitation sent again to ${invitation.email}.`)) {
        focusAfterRowRemoval(focus);
      }
    });
  }

  return (
    <div ref={cellRef} className="flex justify-end gap-1">
      {canResend ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={resending}
          focusableWhenDisabled
          aria-label={`Send the invitation to ${invitation.email} again`}
          onClick={resend}
        >
          {resending ? <Spinner data-icon="inline-start" /> : null}
          Resend
        </Button>
      ) : null}
      {canCancel ? (
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
      ) : null}
    </div>
  );
}
