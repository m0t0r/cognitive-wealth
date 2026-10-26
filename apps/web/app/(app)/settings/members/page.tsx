import {
  INVITATION_EXPIRES_IN,
  listInvitations,
  listMembers,
  type PublicInvitation,
} from "@repo/auth";
import { can } from "@repo/auth/access";
import { Badge } from "@repo/design-system/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/table";
import { cn } from "@repo/design-system/lib/utils";
import type { Metadata } from "next";
import { AppShellSync } from "@/components/app-shell/app-shell-sync";
import { LocalDate } from "@/components/local-date";
import { INVITATIONS_HEADING_ID, InvitationActions } from "@/components/members/invitation-actions";
import { InviteForm } from "@/components/members/invite-form";
import { MEMBERS_HEADING_ID, MemberActions } from "@/components/members/member-actions";
import { MembersFeedbackProvider } from "@/components/members/members-feedback";
import { getAuth } from "@/lib/auth/server";
import { requireAppViewer } from "@/lib/auth/viewer";
import { memberActionsFor, ROLE_LABELS } from "@/lib/roles";

export const metadata: Metadata = { title: "Members" };

const expiryDays = Math.round(INVITATION_EXPIRES_IN / (24 * 60 * 60));
const INVITATION_EXPIRY = expiryDays === 1 ? "1 day" : `${expiryDays} days`;

export default async function MembersPage() {
  const viewer = await requireAppViewer();
  const [members, invitations] = await Promise.all([
    listMembers(getAuth(), viewer),
    listInvitations(getAuth(), viewer),
  ]);

  const { tenant } = viewer;
  const organizationName = tenant.organization.name;
  // Only render an Actions column when at least one row in it has something to offer.
  const canActOn = (member: (typeof members)[number]) => {
    if (member.publicId === tenant.memberPublicId) return false;
    const allowed = memberActionsFor(tenant.role, member.role);
    return allowed.changeRole || allowed.remove;
  };
  const showMemberActions = members.some(canActOn);
  const rows = markExpired(invitations);
  const showInvitationActions =
    can(tenant.role, "invitation:cancel") ||
    (can(tenant.role, "invitation:create") && rows.some((row) => row.expired));

  return (
    <MembersFeedbackProvider
      email={viewer.user.email}
      organizationPublicId={tenant.organization.publicId}
      organizationName={organizationName}
    >
      <AppShellSync />
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
        <header className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Members</h1>
          <p className="wrap-anywhere text-muted-foreground">
            People who can use {organizationName}.
          </p>
        </header>

        {can(tenant.role, "invitation:create") ? (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Invite someone</h2>
              </CardTitle>
              <CardDescription>
                They&apos;ll get an email with a link to join. Invitations expire after{" "}
                {INVITATION_EXPIRY}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <InviteForm viewerRole={tenant.role} />
            </CardContent>
          </Card>
        ) : null}

        <section aria-labelledby={MEMBERS_HEADING_ID} className="flex flex-col gap-4">
          <h2
            id={MEMBERS_HEADING_ID}
            tabIndex={-1}
            className="font-heading text-lg font-medium outline-none"
          >
            Members <span className="text-muted-foreground">{members.length}</span>
          </h2>
          <Card className="py-2">
            <Table aria-labelledby={MEMBERS_HEADING_ID}>
              <TableHeader>
                <TableRow>
                  <TableHead className="ps-4 sm:ps-6">Name</TableHead>
                  <TableHead className="sm:w-28">Role</TableHead>
                  <TableHead
                    className={cn("hidden w-36 sm:table-cell", !showMemberActions && "pe-6")}
                  >
                    Joined
                  </TableHead>
                  {showMemberActions ? (
                    <TableHead className="pe-4 sm:w-24 sm:pe-6">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => {
                  const isViewer = member.publicId === tenant.memberPublicId;
                  return (
                    <TableRow key={member.publicId}>
                      <TableCell className="ps-4 sm:ps-6 whitespace-normal">
                        <div className="flex flex-col">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                            <span className="wrap-anywhere">
                              {member.user.name || member.user.email}
                            </span>
                            {isViewer ? <Badge variant="outline">You</Badge> : null}
                          </span>
                          <span className="wrap-anywhere text-muted-foreground">
                            {member.user.email}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{ROLE_LABELS[member.role]}</TableCell>
                      <TableCell
                        className={cn(
                          "hidden text-muted-foreground sm:table-cell",
                          !showMemberActions && "pe-6",
                        )}
                      >
                        <LocalDate date={member.createdAt.toISOString()} />
                      </TableCell>
                      {showMemberActions ? (
                        <TableCell className="pe-4 text-end sm:pe-6">
                          {canActOn(member) ? (
                            <MemberActions
                              viewerRole={tenant.role}
                              member={{
                                publicId: member.publicId,
                                name: member.user.name,
                                email: member.user.email,
                                role: member.role,
                              }}
                            />
                          ) : null}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </section>

        <section aria-labelledby={INVITATIONS_HEADING_ID} className="flex flex-col gap-4">
          <h2
            id={INVITATIONS_HEADING_ID}
            tabIndex={-1}
            className="font-heading text-lg font-medium outline-none"
          >
            Pending invitations <span className="text-muted-foreground">{invitations.length}</span>
          </h2>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No pending invitations. New invitations show up here until they&apos;re accepted.
            </p>
          ) : (
            <Card className="py-2">
              <Table aria-labelledby={INVITATIONS_HEADING_ID}>
                <TableHeader>
                  <TableRow>
                    <TableHead className="ps-4 sm:ps-6">Email</TableHead>
                    <TableHead className="sm:w-28">Role</TableHead>
                    <TableHead
                      className={cn("hidden w-36 sm:table-cell", !showInvitationActions && "pe-6")}
                    >
                      Expires
                    </TableHead>
                    {showInvitationActions ? (
                      <TableHead className="pe-4 sm:pe-6">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((invitation) => (
                    <TableRow key={invitation.publicId}>
                      <TableCell className="ps-4 sm:ps-6 whitespace-normal">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="wrap-anywhere">{invitation.email}</span>
                          {invitation.expired ? <Badge variant="outline">Expired</Badge> : null}
                        </span>
                      </TableCell>
                      <TableCell>{ROLE_LABELS[invitation.role]}</TableCell>
                      <TableCell
                        className={cn(
                          "hidden text-muted-foreground sm:table-cell",
                          !showInvitationActions && "pe-6",
                        )}
                      >
                        <LocalDate date={invitation.expiresAt.toISOString()} />
                      </TableCell>
                      {showInvitationActions ? (
                        <TableCell className="pe-4 text-end sm:pe-6">
                          <InvitationActions
                            viewerRole={tenant.role}
                            invitation={{
                              publicId: invitation.publicId,
                              email: invitation.email,
                              role: invitation.role,
                              expired: invitation.expired,
                            }}
                          />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </section>
      </div>
    </MembersFeedbackProvider>
  );
}

/** Each invitation with whether it has expired, as of this request. */
function markExpired(invitations: PublicInvitation[]) {
  const now = Date.now();
  return invitations.map((invitation) => ({
    ...invitation,
    expired: invitation.expiresAt.getTime() <= now,
  }));
}
