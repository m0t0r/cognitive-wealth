import { listMyInvitations } from "@repo/auth";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NoWorkspaceCard } from "@/components/auth/no-workspace-card";
import { getAuth } from "@/lib/auth/server";
import { currentViewer, requireViewer } from "@/lib/auth/viewer";

export async function generateMetadata(): Promise<Metadata> {
  // A viewer whose Firms were all deactivated had a workspace, so not "yet" (ADR 0022).
  const viewer = await currentViewer();
  return { title: viewer?.deactivatedFirms.length ? "No workspace" : "No workspace yet" };
}

export default async function NoWorkspacePage() {
  const viewer = await requireViewer();
  if (viewer.tenant !== null) redirect("/");
  // Only invitations to the viewer's own address that they can still accept.
  const invitations = await listMyInvitations(getAuth(), viewer);

  return (
    <NoWorkspaceCard
      email={viewer.user.email}
      deactivatedFirms={viewer.deactivatedFirms.map(({ name }) => ({ name }))}
      invitations={invitations}
    />
  );
}
