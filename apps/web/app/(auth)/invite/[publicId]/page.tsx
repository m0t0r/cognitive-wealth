import { getInvitation, type PublicInvitation } from "@repo/auth";
import { Badge } from "@repo/design-system/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/card";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { InvitationResponse } from "@/components/auth/invitation-response";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { ROLE_LABELS } from "@/lib/roles";
import { getAuth } from "@/lib/auth/server";
import { requireViewer } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Invitation" };

export default async function InvitationPage({ params }: PageProps<"/invite/[publicId]">) {
  const { publicId } = await params;
  const viewer = await requireViewer();
  const result = await getInvitation(getAuth(), await headers(), { invitationPublicId: publicId });
  const invitation = result.ok && isOpen(result.data) ? result.data : null;

  if (!result.ok && result.error === "wrong_recipient") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="font-heading text-xl">This invitation is for someone else</h1>
          </CardTitle>
          <CardDescription>
            This invitation was sent to a different email address. You&apos;re signed in as{" "}
            <span className="font-medium wrap-anywhere text-foreground">{viewer.user.email}</span>.
            Sign out, then open the invitation link again and sign in with the address it was sent
            to.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <SignOutButton
            size="lg"
            className="w-full"
            redirectTo={`/sign-in?${new URLSearchParams({ next: `/invite/${publicId}` }).toString()}`}
          />
        </CardFooter>
      </Card>
    );
  }

  if (invitation === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="font-heading text-xl">This invitation can&apos;t be used</h1>
          </CardTitle>
          <CardDescription>
            It may have expired, been cancelled or already been answered. Ask the person who invited
            you to send a new invitation.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="font-heading text-xl">Join {invitation.organization.name}</h1>
        </CardTitle>
        <CardDescription>
          {invitation.inviter.name || "A workspace admin"} invited you to join{" "}
          {invitation.organization.name} on Cognitive Wealth.
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
        <InvitationResponse invitationPublicId={invitation.publicId} />
      </CardFooter>
    </Card>
  );
}

/** Still waiting for an answer and not expired. */
function isOpen(invitation: PublicInvitation): boolean {
  return invitation.status === "pending" && invitation.expiresAt.getTime() > Date.now();
}
