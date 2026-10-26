"use server";

import {
  dismissRemovalNotice as dismissOnSession,
  getViewer,
  switchOrganization,
} from "@repo/auth";
import { refresh } from "next/cache";
import { cookies, headers } from "next/headers";
import * as z from "zod";
import type { ActionResult } from "@/lib/action-result";
import { getAuth } from "@/lib/auth/server";
import {
  DISMISSED_NOTICES_COOKIE,
  DISMISSED_NOTICES_MAX_AGE,
  dismiss,
  parseDismissals,
  serializeDismissals,
} from "@/lib/dismissed-notices";

const schema = z.object({ organizationPublicId: z.uuid() });

export async function switchWorkspace(input: {
  organizationPublicId: string;
}): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "not_found" };
  const result = await switchOrganization(getAuth(), { ...parsed.data, headers: await headers() });
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

/**
 * `useActionState` state for the notice: how many times Dismiss was submitted on this page, so
 * each submission is a new state and the notice moves focus once more.
 */
export type DismissNoticeState = { submitted: number } | null;

/**
 * Dismisses the Deactivated Firm notice (ADR 0022, point 11): records each Firm it named (the
 * form's `firm` fields), with its deactivation time, in the dismissal cookie, keeping only Firms
 * the viewer still has deactivated. A cookie, not a row, so it changes nothing on the server.
 */
export async function dismissDeactivatedNotice(
  state: DismissNoticeState,
  form: FormData,
): Promise<DismissNoticeState> {
  const viewer = await getViewer(getAuth(), await headers());
  if (viewer === null) return state;
  const cookieStore = await cookies();
  const dismissals = dismiss({
    firms: viewer.deactivatedFirms,
    dismissals: parseDismissals(cookieStore.get(DISMISSED_NOTICES_COOKIE)?.value),
    named: form.getAll("firm").filter((value) => typeof value === "string"),
  });
  if (dismissals.length === 0) {
    cookieStore.delete(DISMISSED_NOTICES_COOKIE);
  } else {
    cookieStore.set(DISMISSED_NOTICES_COOKIE, serializeDismissals(dismissals), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: DISMISSED_NOTICES_MAX_AGE,
    });
  }
  refresh();
  return { submitted: (state?.submitted ?? 0) + 1 };
}

/**
 * Dismisses the Removal notice (ADR 0023): clears it from this session, so every page of this
 * browser stops showing it, and other sessions keep their own.
 */
export async function dismissRemovalNotice(
  state: DismissNoticeState,
  _form: FormData,
): Promise<DismissNoticeState> {
  const result = await dismissOnSession(getAuth(), await headers());
  if (!result.ok) return state;
  refresh();
  return { submitted: (state?.submitted ?? 0) + 1 };
}
