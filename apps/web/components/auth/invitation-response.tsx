"use client";

import { Button } from "@repo/design-system/components/button";
import { FieldError } from "@repo/design-system/components/field";
import { Spinner } from "@repo/design-system/components/spinner";
import { useActionState, useState } from "react";
import { respondToInvitation } from "@/app/(auth)/invite/[publicId]/actions";
import { tenantErrorMessage } from "@/lib/auth/messages";

export function InvitationResponse({ invitationPublicId }: { invitationPublicId: string }) {
  const [state, action, pending] = useActionState(respondToInvitation, null);
  const [choice, setChoice] = useState<"accept" | "decline" | null>(null);
  const error = state === null || state.ok ? null : tenantErrorMessage(state.error);

  return (
    <form action={action} className="flex w-full flex-col gap-3">
      <input type="hidden" name="invitationPublicId" value={invitationPublicId} />
      <FieldError>{error}</FieldError>
      <Button
        type="submit"
        name="response"
        value="accept"
        size="lg"
        disabled={pending}
        onClick={() => setChoice("accept")}
      >
        {pending && choice === "accept" ? <Spinner data-icon="inline-start" /> : null}
        Accept invitation
      </Button>
      <Button
        type="submit"
        name="response"
        value="decline"
        variant="ghost"
        size="lg"
        disabled={pending}
        onClick={() => setChoice("decline")}
      >
        {pending && choice === "decline" ? <Spinner data-icon="inline-start" /> : null}
        Decline
      </Button>
    </form>
  );
}
