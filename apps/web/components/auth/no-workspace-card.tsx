import type { PublicInvitation } from "@repo/auth";
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
import Link from "next/link";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { deactivatedCopy, firmNames } from "@/lib/deactivated-firms";
import { INVITED_YOU_AS } from "@/lib/roles";

type NoWorkspaceCardProps = {
  email: string;
  /**
   * The viewer's Deactivated Firms, when those are all the Firms they have (ADR 0022): the card
   * says they no longer use Cognitive Wealth instead of "not in a workspace yet".
   */
  deactivatedFirms: { name: string }[];
  /** Invitations to the viewer's own address that they can still accept. */
  invitations: PublicInvitation[];
};

/** `/no-workspace`: why the viewer has no workspace, their invitations, and a way out. */
export function NoWorkspaceCard({ email, deactivatedFirms, invitations }: NoWorkspaceCardProps) {
  const copy = deactivatedFirms.length > 0 ? deactivatedCopy(deactivatedFirms) : null;
  const address = <span className="font-medium wrap-anywhere text-foreground">{email}</span>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="font-heading text-xl wrap-anywhere">
            {copy ? copy.heading(firmNames(deactivatedFirms)) : "You're not in a workspace yet"}
          </h1>
        </CardTitle>
        <CardDescription>
          {copy === null ? (
            invitations.length > 0 ? (
              "Open an invitation to join its workspace."
            ) : (
              <>
                Cognitive Wealth is invite-only. Ask a workspace owner or admin to invite {address}.
              </>
            )
          ) : invitations.length > 0 ? (
            `${copy.gone} Open an invitation to join another one.`
          ) : (
            <>
              {copy.gone} To join another one, ask a workspace owner or admin to invite {address}.
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
