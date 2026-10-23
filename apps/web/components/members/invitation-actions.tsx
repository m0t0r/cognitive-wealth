"use client";

import { can, type Role } from "@repo/auth/access";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@repo/design-system/components/alert-dialog";
import { Button } from "@repo/design-system/components/button";
import { Spinner } from "@repo/design-system/components/spinner";
import { startTransition, useActionState, useState } from "react";
import { cancelInvitationAction } from "@/app/(app)/settings/members/actions";
import type { FormState } from "@/lib/action-result";
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
  const [, cancel, cancelling] = useActionState(
    async (_previous: FormState): Promise<FormState> => {
      const result = await cancelInvitationAction({ invitationPublicId: invitation.publicId });
      report(result, `Invitation to ${invitation.email} cancelled.`);
      // Close either way: a failure shows as a toast, or as the "sign in again" dialog.
      setOpen(false);
      return result;
    },
    null,
  );

  if (!can(viewerRole, "invitation:cancel")) return null;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={<Button variant="ghost" size="sm" />}
        aria-label={`Cancel invitation to ${invitation.email}`}
      >
        Cancel
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel the invitation to {invitation.email}?</AlertDialogTitle>
          <AlertDialogDescription>
            The link in their invitation email will stop working. You can invite them again later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep invitation</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={cancelling}
            onClick={() => startTransition(() => cancel())}
          >
            {cancelling ? <Spinner data-icon="inline-start" /> : null}
            Cancel invitation
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
