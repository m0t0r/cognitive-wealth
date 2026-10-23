import { listMyInvitations } from "@repo/auth";
import { buttonVariants } from "@repo/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@repo/design-system/components/item";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { getAuth } from "@/lib/auth/server";
import { requireViewer } from "@/lib/auth/viewer";
import { INVITED_YOU_AS } from "@/lib/roles";

export const metadata: Metadata = { title: "No workspace yet" };

export default async function NoWorkspacePage() {
  const viewer = await requireViewer();
  if (viewer.tenant !== null) redirect("/");
  // Only invitations to the viewer's own address that they can still accept.
  const invitations = await listMyInvitations(getAuth(), viewer);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="font-heading text-xl">You&apos;re not in a workspace yet</h1>
        </CardTitle>
        <CardDescription>
          {invitations.length > 0 ? (
            "Open an invitation to join its workspace."
          ) : (
            <>
              Cognitive Wealth is invite-only. Ask a workspace owner or admin to invite{" "}
              <span className="font-medium wrap-anywhere text-foreground">{viewer.user.email}</span>
              .
            </>
          )}
        </CardDescription>
      </CardHeader>
      {invitations.length > 0 ? (
        <CardContent>
          <ul aria-label="Your invitations" className="flex flex-col gap-2.5">
            {invitations.map((invitation) => (
              <Item key={invitation.publicId} render={<li />} variant="outline" size="sm">
                <ItemContent className="min-w-0">
                  <ItemTitle className="wrap-anywhere">{invitation.organization.name}</ItemTitle>
                  <ItemDescription className="wrap-anywhere">
                    {INVITED_YOU_AS[invitation.role](
                      invitation.inviter.name || "A workspace admin",
                    )}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Link
                    href={`/invite/${invitation.publicId}`}
                    aria-label={`View invitation to ${invitation.organization.name}`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    View invitation
                  </Link>
                </ItemActions>
              </Item>
            ))}
          </ul>
        </CardContent>
      ) : null}
      <CardFooter>
        <SignOutButton variant="outline" size="lg" className="w-full" />
      </CardFooter>
    </Card>
  );
}
