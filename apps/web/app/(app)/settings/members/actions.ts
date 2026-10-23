"use server";

import {
  cancelInvitation,
  changeMemberRole,
  inviteMember,
  normalizeEmail,
  removeMember,
  type Result,
} from "@repo/auth";
import { ROLES } from "@repo/auth/access";
import { refresh } from "next/cache";
import { headers } from "next/headers";
import * as z from "zod";
import type { ActionResult } from "@/lib/action-result";
import { getAuth } from "@/lib/auth/server";
import { formString } from "@/lib/form-data";

// `@repo/auth` checks the session, tenant, permissions and fresh-session rule on every call;
// these only check the shape of the input and refresh the page on success.

const inviteSchema = z.object({ email: z.email().max(254), role: z.enum(ROLES) });
const roleSchema = z.object({ memberPublicId: z.uuid(), role: z.enum(ROLES) });
const memberSchema = z.object({ memberPublicId: z.uuid() });
const invitationSchema = z.object({ invitationPublicId: z.uuid() });

export async function inviteMemberAction(formData: FormData): Promise<ActionResult> {
  const input = inviteSchema.safeParse({
    email: normalizeEmail(formString(formData, "email")),
    role: formData.get("role"),
  });
  if (!input.success) return { ok: false, error: "invalid_input" };
  return done(await inviteMember(getAuth(), await headers(), input.data));
}

export async function changeRoleAction(input: {
  memberPublicId: string;
  role: string;
}): Promise<ActionResult> {
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  return done(await changeMemberRole(getAuth(), await headers(), parsed.data));
}

export async function removeMemberAction(input: { memberPublicId: string }): Promise<ActionResult> {
  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "not_found" };
  return done(await removeMember(getAuth(), await headers(), parsed.data));
}

export async function cancelInvitationAction(input: {
  invitationPublicId: string;
}): Promise<ActionResult> {
  const parsed = invitationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "not_found" };
  return done(await cancelInvitation(getAuth(), await headers(), parsed.data));
}

/** Drops the DTO the call returned (the page re-renders with fresh data instead). */
function done(result: Result<unknown>): ActionResult {
  if (!result.ok) return { ok: false, error: result.error };
  refresh();
  return { ok: true };
}
