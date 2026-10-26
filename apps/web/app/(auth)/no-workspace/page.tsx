import { listMyInvitations } from "@repo/auth";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NoWorkspaceCard } from "@/components/auth/no-workspace-card";
import { getAuth } from "@/lib/auth/server";
import { requireViewer } from "@/lib/auth/viewer";

// Not "yet": a viewer here may have had a workspace, and lost it (ADR 0022, ADR 0023).
export const metadata: Metadata = { title: "No workspace" };

export default async function NoWorkspacePage() {
  const viewer = await requireViewer();
  if (viewer.tenant !== null) redirect("/");
  // Only invitations to the viewer's own address that they can still accept.
  const invitations = await listMyInvitations(getAuth(), viewer);

  return (
    <NoWorkspaceCard
      email={viewer.user.email}
      removedFrom={viewer.removedFrom?.name ?? null}
      deactivatedFirms={viewer.deactivatedFirms.map(({ name }) => ({ name }))}
      invitations={invitations}
    />
  );
}
