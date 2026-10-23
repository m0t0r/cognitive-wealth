import type { TenantErrorCode } from "@repo/auth";

/** What a Server Action hands back: no DTOs, no IDs, just whether it worked. */
export type ActionResult =
  | { ok: true }
  | {
      ok: false;
      error: TenantErrorCode;
      /** With `tenant_changed`: the name of the workspace the session is in now, if any. */
      workspace?: string;
    };

/** `useActionState` state for a form: nothing submitted yet, or the last result. */
export type FormState = ActionResult | null;
