// What the browser may see. Every mapper copies named fields only, so internal IDs (`id`,
// `userId`, `organizationId`, `inviterId`, …) can't ride along on a spread.
import { isRole, type Role } from "./access";

export interface PublicUser {
  publicId: string;
  name: string;
  email: string;
  image: string | null;
}

export interface PublicOrganization {
  publicId: string;
  name: string;
  slug: string;
  logo: string | null;
}

export interface PublicMember {
  publicId: string;
  role: Role;
  user: PublicUser;
  createdAt: Date;
}

export type InvitationStatus = "pending" | "accepted" | "rejected" | "canceled";

export interface PublicInvitation {
  publicId: string;
  email: string;
  role: Role;
  status: InvitationStatus;
  expiresAt: Date;
  organization: PublicOrganization;
  inviter: { name: string };
}

/** One of the viewer's organizations, for the org switcher. */
export interface PublicMembership {
  organization: PublicOrganization;
  role: Role;
  isActive: boolean;
}

/**
 * A Firm the viewer is a member of that no longer uses Cognitive Wealth (ADR 0022), for
 * `/no-workspace` and the notice on app pages. `deactivatedAt` tells one deactivation from a later
 * one, so a dismissed notice comes back when the Firm is deactivated again.
 */
export interface DeactivatedFirm {
  publicId: string;
  name: string;
  deactivatedAt: Date;
}

/** The viewer's active organization and their place in it. */
export interface Tenant {
  organization: PublicOrganization;
  role: Role;
  memberPublicId: string;
}

interface UserRow {
  publicId: string;
  name: string;
  email: string;
  image?: string | null | undefined;
}

interface OrganizationRow {
  publicId: string;
  name: string;
  slug: string;
  logo?: string | null | undefined;
}

export function toPublicUser(row: UserRow): PublicUser {
  return { publicId: row.publicId, name: row.name, email: row.email, image: row.image ?? null };
}

export function toPublicOrganization(row: OrganizationRow): PublicOrganization {
  return { publicId: row.publicId, name: row.name, slug: row.slug, logo: row.logo ?? null };
}

type ToPublicMemberArgs = {
  publicId: string;
  role: string;
  createdAt: Date;
  user: UserRow;
};

export function toPublicMember(row: ToPublicMemberArgs): PublicMember {
  return {
    publicId: row.publicId,
    role: toRole(row.role),
    user: toPublicUser(row.user),
    createdAt: row.createdAt,
  };
}

type ToPublicInvitationArgs = {
  publicId: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date;
  organization: OrganizationRow;
  inviter: { name: string };
};

export function toPublicInvitation(row: ToPublicInvitationArgs): PublicInvitation {
  return {
    publicId: row.publicId,
    email: row.email,
    role: toRole(row.role),
    status: toInvitationStatus(row.status),
    expiresAt: row.expiresAt,
    organization: toPublicOrganization(row.organization),
    inviter: { name: row.inviter.name },
  };
}

export function toPublicMembership(row: {
  role: string;
  organization: OrganizationRow;
  isActive: boolean;
}): PublicMembership {
  return {
    organization: toPublicOrganization(row.organization),
    role: toRole(row.role),
    isActive: row.isActive,
  };
}

/**
 * Better Auth stores roles as text (comma-separated for multiple). We only assign single
 * built-in roles; anything else reads as `member`, the least privileged.
 */
export function toRole(value: string | null | undefined): Role {
  return isRole(value) ? value : "member";
}

const STATUSES: readonly InvitationStatus[] = ["pending", "accepted", "rejected", "canceled"];

function toInvitationStatus(value: string): InvitationStatus {
  return isInvitationStatus(value) ? value : "canceled";
}

function isInvitationStatus(value: string): value is InvitationStatus {
  return (STATUSES as readonly string[]).includes(value);
}
