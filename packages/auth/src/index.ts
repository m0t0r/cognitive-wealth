// Server entry point. Client components import `@repo/auth/client` or `@repo/auth/access` instead.
export {
  createAuth,
  INVITATION_EXPIRES_IN,
  ROUTE_RATE_LIMITS,
  SESSION_EXPIRES_IN,
  SESSION_FRESH_AGE,
  SESSION_UPDATE_AGE,
  UNSET_IP_HEADER,
  type Auth,
  type AuthDeps,
} from "./auth";
export { writeAuditEvent, type AuditAction, type AuditEventInput } from "./audit";
export {
  DEFAULT_CALLBACK_PATH,
  callbackPathOrDefault,
  sanitizeCallbackPath,
} from "./callback-path";
export {
  AUTH_BASE_PATH,
  COOKIE_PREFIX,
  DEVICE_COOKIE_NAMES,
  SESSION_COOKIE_NAMES,
} from "./constants";
export type {
  InvitationStatus,
  PublicInvitation,
  PublicMember,
  PublicMembership,
  PublicOrganization,
  PublicUser,
  Tenant,
} from "./dto";
export { consumeRateLimit, type RateLimitResult, type RateLimitRule } from "./rate-limit";
export {
  createAuthRouteHandler,
  isSameOriginFetch,
  isSameOriginPost,
  mapAuthResponse,
  matchAuthRoute,
  type AuthErrorCode,
  type AuthRoute,
} from "./route-handler";
export {
  SIGN_IN_EMAIL_LIMITS,
  SIGN_IN_EXPIRES_IN,
  normalizeEmail,
  type BackgroundRunner,
} from "./sign-in";
export type { SecondaryStorage } from "./storage/types";
export {
  INVITE_LIMIT,
  acceptInvitation,
  cancelInvitation,
  changeMemberRole,
  clientIp,
  declineInvitation,
  getInvitation,
  getViewer,
  inviteMember,
  listInvitations,
  listMembers,
  listMemberships,
  listMyInvitations,
  removeMember,
  requireTenant,
  revokeUserSessions,
  switchOrganization,
  tenantOf,
  updateProfileName,
  type Result,
  type TenantErrorCode,
  type TenantViewer,
  type Viewer,
} from "./tenant";
