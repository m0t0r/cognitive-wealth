"use server";

import {
  cancelInvitation,
  changeMemberRole,
  inviteMember,
  normalizeEmail,
  removeMember,
  requireTenant,
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
// these only check the shape of the input and refresh the page on success. Each one carries the
// `organizationPublicId` of the workspace the page showed, so a page left open after a switch in
// another tab gets `tenant_changed` instead of acting on the new workspace.

const organizationPublicId = z.uuid();
const inviteSchema = z.object({
  organizationPublicId,
  email: z.string().transform(normalizeEmail).pipe(z.email().max(254)),
  role: z.enum(ROLES),
});
const roleSchema = z.object({
  organizationPublicId,
  memberPublicId: z.uuid(),
  role: z.enum(ROLES),
});
const memberSchema = z.object({ organizationPublicId, memberPublicId: z.uuid() });
const invitationSchema = z.object({ organizationPublicId, invitationPublicId: z.uuid() });

export async function inviteMemberAction(formData: FormData): Promise<ActionResult> {
  return invite({
    organizationPublicId: formData.get("organizationPublicId"),
    email: formString(formData, "email"),
    role: formData.get("role"),
  });
}

/** Sends an expired invitation again: a new invitation to the same address and role. */
export async function resendInvitationAction(input: {
  organizationPublicId: string;
  email: string;
  role: string;
}): Promise<ActionResult> {
  return invite(input);
}

export async function changeRoleAction(input: {
  organizationPublicId: string;
  memberPublicId: string;
  role: string;
}): Promise<ActionResult> {
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  return done(await changeMemberRole(getAuth(), { headers: await headers(), ...parsed.data }));
}

export async function removeMemberAction(input: {
  organizationPublicId: string;
  memberPublicId: string;
}): Promise<ActionResult> {
  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "not_found" };
  return done(await removeMember(getAuth(), { headers: await headers(), ...parsed.data }));
}

export async function cancelInvitationAction(input: {
  organizationPublicId: string;
  invitationPublicId: string;
}): Promise<ActionResult> {
  const parsed = invitationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "not_found" };
  return done(await cancelInvitation(getAuth(), { headers: await headers(), ...parsed.data }));
}

async function invite(input: {
  organizationPublicId: unknown;
  email: unknown;
  role: unknown;
}): Promise<ActionResult> {
  // Server Actions take whatever a client sends: parse before touching any field.
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  return done(await inviteMember(getAuth(), { headers: await headers(), ...parsed.data }));
}

/**
 * Drops the DTO the call returned (the page re-renders with fresh data instead). For
 * `tenant_changed`, names the workspace the session is in now, so the page can say so.
 */
async function done(result: Result<unknown>): Promise<ActionResult> {
  if (result.ok) {
    refresh();
    return { ok: true };
  }
  if (result.error !== "tenant_changed") return { ok: false, error: result.error };
  const current = await requireTenant(getAuth(), await headers());
  return current.ok
    ? { ok: false, error: result.error, workspace: current.data.tenant.organization.name }
    : { ok: false, error: result.error };
}
