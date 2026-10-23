"use server";

import { callbackPathOrDefault, updateProfileName } from "@repo/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import * as z from "zod";
import type { FormState } from "@/lib/action-result";
import { getAuth } from "@/lib/auth/server";

const schema = z.object({
  name: z.string().trim().min(1).max(100),
  next: z.string().nullable(),
});

export async function saveName(_previous: FormState, formData: FormData): Promise<FormState> {
  const input = schema.safeParse({ name: formData.get("name"), next: formData.get("next") });
  if (!input.success) return { ok: false, error: "invalid_input" };

  const result = await updateProfileName(getAuth(), await headers(), { name: input.data.name });
  if (!result.ok) return result;
  return redirect(callbackPathOrDefault(input.data.next));
}
