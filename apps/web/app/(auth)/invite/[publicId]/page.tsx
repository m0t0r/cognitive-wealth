import { getInvitation, type PublicInvitation } from "@repo/auth";
import { buttonVariants } from "@repo/design-system/components/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/card";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { InvitationResponse } from "@/components/auth/invitation-response";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { getAuth } from "@/lib/auth/server";
import { requireViewer } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Invitation" };

export default async function InvitationPage({ params }: PageProps<"/invite/[publicId]">) {
  const { publicId } = await params;
  const viewer = await requireViewer();
  const result = await getInvitation(getAuth(), {
    headers: await headers(),
    invitationPublicId: publicId,
  });
  const invitation = result.ok && isOpen(result.data) ? result.data : null;
  const hasWorkspace = viewer.tenant !== null;

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
        <CardFooter className="flex flex-col gap-3">
          <SignOutButton
            size="lg"
            className="w-full"
            redirectTo={`/sign-in?${new URLSearchParams({ next: `/invite/${publicId}` }).toString()}`}
          />
          {hasWorkspace ? (
            <Link
              href="/"
              className={buttonVariants({ variant: "ghost", size: "lg", className: "w-full" })}
            >
              Go to your workspace
            </Link>
          ) : null}
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
        <CardFooter>
          {/* Without a workspace, `/` leads to the page that lists any other invitations. */}
          <Link href="/" className={buttonVariants({ size: "lg", className: "w-full" })}>
            {hasWorkspace ? "Go to your workspace" : "See your invitations"}
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <InvitationResponse
      hasWorkspace={hasWorkspace}
      invitation={{
        publicId: invitation.publicId,
        organizationName: invitation.organization.name,
        inviterName: invitation.inviter.name,
        role: invitation.role,
        email: invitation.email,
      }}
    />
  );
}

/** Still waiting for an answer and not expired. */
function isOpen(invitation: PublicInvitation): boolean {
  return invitation.status === "pending" && invitation.expiresAt.getTime() > Date.now();
}
