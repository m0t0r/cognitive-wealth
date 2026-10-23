import "server-only";
import { callbackPathOrDefault, getViewer, tenantOf } from "@repo/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getAuth } from "./server";
import { REQUEST_PATH_HEADER, signInPath, welcomePath } from "./paths";

// Layouts and pages both ask for the viewer; `cache` makes that one session lookup per request,
// and pages pass the result to `@repo/auth`'s reads (`listMembers(auth, viewer)`) rather than
// looking the session up again. The results hold `internal` IDs: read DTO fields from them, never
// pass them to a client component.
// `headers()` comes first: it marks the route dynamic before `getAuth()` reads the environment, so
// `next build` never builds an auth instance.

/** The signed-in viewer, or `null`. */
export const currentViewer = cache(async () => {
  const requestHeaders = await headers();
  return getViewer(getAuth(), requestHeaders);
});

const currentTenant = cache(async () => tenantOf(await currentViewer()));

/** The path and query of the page being rendered, as `proxy.ts` saw it. */
export async function currentPath(): Promise<string> {
  return callbackPathOrDefault((await headers()).get(REQUEST_PATH_HEADER));
}

/**
 * The viewer and their tenant for an app page. Layouts don't re-render on client navigation, so
 * every app page calls this as well as the layout. Redirects:
 * - no session → `/sign-in?next=<this page>`
 * - no membership → `/no-workspace`
 * - no name yet → `/welcome?next=<this page>`
 */
export async function requireAppViewer() {
  const result = await currentTenant();
  if (!result.ok) {
    if (result.error === "no_tenant") redirect("/no-workspace");
    redirect(signInPath(await currentPath()));
  }
  if (result.data.user.name.trim() === "") redirect(welcomePath(await currentPath()));
  return result.data;
}

/** The viewer for a page outside the app shell; signed-out visitors go to sign-in first. */
export async function requireViewer() {
  const viewer = await currentViewer();
  if (viewer === null) redirect(signInPath(await currentPath()));
  return viewer;
}
