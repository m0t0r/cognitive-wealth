"use server";

import { switchOrganization } from "@repo/auth";
import { refresh } from "next/cache";
import { headers } from "next/headers";
import * as z from "zod";
import type { ActionResult } from "@/lib/action-result";
import { getAuth } from "@/lib/auth/server";

const schema = z.object({ organizationPublicId: z.uuid() });

export async function switchWorkspace(input: {
  organizationPublicId: string;
}): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "not_found" };
  const result = await switchOrganization(getAuth(), { headers: await headers(), ...parsed.data });
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}
