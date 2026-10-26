import type { Viewer } from "@repo/auth";

/**
 * What the app shell (the layout's header, workspace switcher and notices) shows of the viewer,
 * as one string of publicIds: their tenant, their workspaces, the Firm a Removal moved them off
 * and their Deactivated Firms. The layout and the page each work it out; when they differ, the
 * layout is stale (`RefreshStaleShell`).
 */
export function shellKey(
  viewer: Pick<Viewer, "tenant" | "memberships" | "removedFrom" | "deactivatedFirms">,
): string {
  return JSON.stringify([
    viewer.tenant?.organization.publicId ?? null,
    viewer.memberships.map((m) => m.organization.publicId),
    viewer.removedFrom?.publicId ?? null,
    viewer.deactivatedFirms.map((firm) => [firm.publicId, firm.deactivatedAt.getTime()]),
  ]);
}
