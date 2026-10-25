"use server";

import { acceptInvitation, declineInvitation } from "@repo/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import * as z from "zod";
import type { ActionResult, FormState } from "@/lib/action-result";
import { getAuth } from "@/lib/auth/server";

const schema = z.object({ invitationPublicId: z.uuid() });

/** Accepts, which makes the organization active, then opens the app. */
export async function acceptInvitationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const input = schema.safeParse({ invitationPublicId: formData.get("invitationPublicId") });
  if (!input.success) return { ok: false, error: "not_found" };
  const result = await acceptInvitation(getAuth(), { headers: await headers(), ...input.data });
  if (!result.ok) return result;
  return redirect("/");
}

/** Declines and stays on the page, which then says so (the viewer's workspace is unchanged). */
export async function declineInvitationAction(input: {
  invitationPublicId: string;
}): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "not_found" };
  const result = await declineInvitation(getAuth(), { headers: await headers(), ...parsed.data });
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
