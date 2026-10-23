"use server";

import { acceptInvitation, declineInvitation } from "@repo/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import * as z from "zod";
import type { FormState } from "@/lib/action-result";
import { getAuth } from "@/lib/auth/server";

const schema = z.object({ invitationPublicId: z.uuid() });

export async function respondToInvitation(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const input = schema.safeParse({ invitationPublicId: formData.get("invitationPublicId") });
  if (!input.success) return { ok: false, error: "not_found" };
  const respond = formData.get("response") === "accept" ? acceptInvitation : declineInvitation;

  const result = await respond(getAuth(), await headers(), input.data);
  if (!result.ok) return result;
  // Accepting makes the organization active; declining leaves the viewer where they were.
  return redirect("/");
}
