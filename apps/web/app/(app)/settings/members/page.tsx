import { listInvitations, listMembers } from "@repo/auth";
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
import type { Metadata } from "next";
import { headers } from "next/headers";
import { InvitationActions } from "@/components/members/invitation-actions";
import { InviteForm } from "@/components/members/invite-form";
import { MEMBERS_HEADING_ID, MemberActions } from "@/components/members/member-actions";
import { MembersFeedbackProvider } from "@/components/members/members-feedback";
import { getAuth } from "@/lib/auth/server";
import { requireAppViewer } from "@/lib/auth/viewer";
import { formatDate } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/roles";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage() {
  const viewer = await requireAppViewer();
  const requestHeaders = await headers();
  const [members, invitations] = await Promise.all([
    listMembers(getAuth(), requestHeaders),
    listInvitations(getAuth(), requestHeaders),
  ]);
  if (!members.ok) throw new Error(`Unable to list members: ${members.error}`);
  if (!invitations.ok) throw new Error(`Unable to list invitations: ${invitations.error}`);

  const { tenant } = viewer;
  const organizationName = tenant.organization.name;

  return (
    <MembersFeedbackProvider email={viewer.user.email} organizationName={organizationName}>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
        <header className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Members</h1>
          <p className="text-muted-foreground">People who can use {organizationName}.</p>
        </header>

        {can(tenant.role, "invitation:create") ? (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Invite someone</h2>
              </CardTitle>
              <CardDescription>
                They&apos;ll get an email with a link to join. Invitations expire after 7 days.
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
            Members <span className="text-muted-foreground">{members.data.length}</span>
          </h2>
          <Card className="py-2">
            <Table aria-labelledby={MEMBERS_HEADING_ID}>
              <TableHeader>
                <TableRow>
                  <TableHead className="ps-4 sm:ps-6">Name</TableHead>
                  <TableHead className="sm:w-28">Role</TableHead>
                  <TableHead className="hidden w-36 sm:table-cell">Joined</TableHead>
                  <TableHead className="pe-4 sm:w-24 sm:pe-6">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.data.map((member) => {
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
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        <time dateTime={member.createdAt.toISOString()}>
                          {formatDate(member.createdAt)}
                        </time>
                      </TableCell>
                      <TableCell className="pe-4 text-end sm:pe-6">
                        {isViewer ? null : (
                          <MemberActions
                            viewerRole={tenant.role}
                            member={{
                              publicId: member.publicId,
                              name: member.user.name,
                              email: member.user.email,
                              role: member.role,
                            }}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </section>

        <section aria-labelledby="invitations-heading" className="flex flex-col gap-4">
          <h2 id="invitations-heading" className="font-heading text-lg font-medium">
            Pending invitations{" "}
            <span className="text-muted-foreground">{invitations.data.length}</span>
          </h2>
          {invitations.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No pending invitations. New invitations show up here until they&apos;re accepted.
            </p>
          ) : (
            <Card className="py-2">
              <Table aria-labelledby="invitations-heading">
                <TableHeader>
                  <TableRow>
                    <TableHead className="ps-4 sm:ps-6">Email</TableHead>
                    <TableHead className="sm:w-28">Role</TableHead>
                    <TableHead className="hidden w-36 sm:table-cell">Expires</TableHead>
                    <TableHead className="pe-4 sm:w-24 sm:pe-6">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitations.data.map((invitation) => (
                    <TableRow key={invitation.publicId}>
                      <TableCell className="ps-4 sm:ps-6 whitespace-normal wrap-anywhere">
                        {invitation.email}
                      </TableCell>
                      <TableCell>{ROLE_LABELS[invitation.role]}</TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        <time dateTime={invitation.expiresAt.toISOString()}>
                          {formatDate(invitation.expiresAt)}
                        </time>
                      </TableCell>
                      <TableCell className="pe-4 text-end sm:pe-6">
                        <InvitationActions
                          viewerRole={tenant.role}
                          invitation={{ publicId: invitation.publicId, email: invitation.email }}
                        />
                      </TableCell>
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
