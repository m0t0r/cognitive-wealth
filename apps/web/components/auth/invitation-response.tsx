"use client";

import type { Role } from "@repo/auth/access";
import { AlertDialogTrigger } from "@repo/design-system/components/alert-dialog";
import { Badge } from "@repo/design-system/components/badge";
import { Button, buttonVariants } from "@repo/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/card";
import { FieldError } from "@repo/design-system/components/field";
import { Spinner } from "@repo/design-system/components/spinner";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  acceptInvitationAction,
  declineInvitationAction,
} from "@/app/(auth)/invite/[publicId]/actions";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import type { ActionResult } from "@/lib/action-result";
import { tenantErrorMessage } from "@/lib/auth/messages";
import { ROLE_LABELS } from "@/lib/roles";

export interface InvitationDetails {
  publicId: string;
  organizationName: string;
  inviterName: string;
  role: Role;
  email: string;
}

/**
 * An open invitation, answered here. Accepting opens the app in the new workspace. Declining is
 * confirmed first, then the card says it's done and where to go next, rather than sending the
 * person somewhere that tells them to use the invitation they just declined.
 */
export function InvitationResponse({
  invitation,
  hasWorkspace,
}: {
  invitation: InvitationDetails;
  /** Whether the viewer already belongs to a workspace (where to send them after declining). */
  hasWorkspace: boolean;
}) {
  const [acceptState, accept, accepting] = useActionState(acceptInvitationAction, null);
  const [declineResult, setDeclineResult] = useState<ActionResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const declinedHeadingRef = useRef<HTMLHeadingElement>(null);
  const declined = declineResult?.ok === true;
  const organization = invitation.organizationName;
  const inviter = invitation.inviterName || "A workspace admin";

  // The card's content is replaced; take keyboard and screen reader users to its new heading.
  useEffect(() => {
    if (declined) declinedHeadingRef.current?.focus();
  }, [declined]);

  async function decline() {
    setDeclineResult(await declineInvitationAction({ invitationPublicId: invitation.publicId }));
    setConfirming(false);
  }

  if (declined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1
              ref={declinedHeadingRef}
              tabIndex={-1}
              className="font-heading text-xl outline-none"
            >
              Invitation declined
            </h1>
          </CardTitle>
          <CardDescription className="wrap-anywhere">
            You won&apos;t join {organization}. If you change your mind, ask {inviter} to invite you
            again.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Link href="/" className={buttonVariants({ size: "lg", className: "w-full" })}>
            {hasWorkspace ? "Go to your workspace" : "Continue"}
          </Link>
        </CardFooter>
      </Card>
    );
  }

  const failure =
    acceptState?.ok === false ? acceptState : declineResult?.ok === false ? declineResult : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="font-heading text-xl wrap-anywhere">Join {organization}</h1>
        </CardTitle>
        <CardDescription className="wrap-anywhere">
          {inviter} invited you to join {organization} on Cognitive Wealth.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-6 gap-y-3 text-sm">
          <dt className="text-muted-foreground">Your role</dt>
          <dd>
            <Badge variant="secondary">{ROLE_LABELS[invitation.role]}</Badge>
          </dd>
          <dt className="text-muted-foreground">Sent to</dt>
          <dd className="wrap-anywhere">{invitation.email}</dd>
        </dl>
      </CardContent>
      <CardFooter>
        <form action={accept} className="flex w-full flex-col gap-3">
          <input type="hidden" name="invitationPublicId" value={invitation.publicId} />
          <FieldError>{failure === null ? null : tenantErrorMessage(failure.error)}</FieldError>
          <Button type="submit" size="lg" disabled={accepting} focusableWhenDisabled>
            {accepting ? <Spinner data-icon="inline-start" /> : null}
            Accept invitation
          </Button>
          <ConfirmActionDialog
            open={confirming}
            onOpenChange={setConfirming}
            trigger={
              <AlertDialogTrigger
                render={<Button type="button" variant="ghost" size="lg" disabled={accepting} />}
              >
                Decline
              </AlertDialogTrigger>
            }
            title={`Decline the invitation to ${organization}?`}
            description={`You won't join ${organization}. To join later, you'll need a new invitation.`}
            cancelLabel="Keep invitation"
            confirmLabel="Decline invitation"
            onConfirm={decline}
          />
        </form>
      </CardFooter>
    </Card>
  );
}
