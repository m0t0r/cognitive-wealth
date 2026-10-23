"use client";

import { requestSignIn } from "@repo/auth/client";
import { Button } from "@repo/design-system/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/design-system/components/dialog";
import { FieldError } from "@repo/design-system/components/field";
import { Spinner } from "@repo/design-system/components/spinner";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  startTransition,
  use,
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import type { TenantErrorCode } from "@repo/auth";
import type { ActionResult } from "@/lib/action-result";
import { signInErrorMessage, tenantErrorMessage } from "@/lib/auth/messages";

/**
 * Errors that mean the page is out of date (another tab switched workspace, the viewer's role
 * changed, the row is gone, or the viewer left the workspace): re-render it from the server.
 */
const STALE_PAGE_ERRORS: ReadonlySet<TenantErrorCode> = new Set([
  "tenant_changed",
  "forbidden",
  "not_found",
  "no_tenant",
]);

/** Where focus goes once a table row is gone, captured while the row is still on the page. */
export interface RowFocus {
  row: Element;
  /** The next row's first button (its actions), if there is a next row. */
  next: HTMLElement | null;
  /** The table's section heading (`tabIndex={-1}`), when there's no next row. */
  headingId: string;
}

/** Captures where focus should go if the row holding `element` disappears. */
export function captureRowFocus(element: Element | null, headingId: string): RowFocus | null {
  const row = element?.closest("tr");
  if (!row) return null;
  return { row, next: row.nextElementSibling?.querySelector("button") ?? null, headingId };
}

interface MembersFeedback {
  /** The workspace the page shows; every action sends it (`tenant_changed` otherwise). */
  organizationPublicId: string;
  organizationName: string;
  /**
   * Shows the outcome of an action: a toast, or the "sign in again" dialog when the session is
   * too old for it. Errors that mean the page is stale also refresh it. Returns whether the
   * action worked.
   */
  report: (result: ActionResult, success: string) => boolean;
  /**
   * Once `focus.row` has left the page (the refresh after a removal), moves focus to the next
   * row's actions, or the section heading: never to the document body.
   */
  focusAfterRowRemoval: (focus: RowFocus | null) => void;
}

const MembersFeedbackContext = createContext<MembersFeedback | null>(null);

export function useMembersFeedback(): MembersFeedback {
  const context = use(MembersFeedbackContext);
  if (context === null) throw new Error("useMembersFeedback needs a MembersFeedbackProvider");
  return context;
}

export function MembersFeedbackProvider({
  email,
  organizationPublicId,
  organizationName,
  children,
}: {
  /** The viewer's own address, where the fresh sign-in link goes. */
  email: string;
  organizationPublicId: string;
  organizationName: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [reauth, setReauth] = useState({ open: false, key: 0 });
  const pendingFocus = useRef<RowFocus | null>(null);

  const report = useCallback(
    (result: ActionResult, success: string) => {
      if (result.ok) {
        toast.success(success);
        return true;
      }
      if (result.error === "reauth_required") {
        setReauth((current) => ({ open: true, key: current.key + 1 }));
        return false;
      }
      toast.error(tenantErrorMessage(result.error, result.workspace));
      if (STALE_PAGE_ERRORS.has(result.error)) router.refresh();
      return false;
    },
    [router],
  );

  const focusAfterRowRemoval = useCallback((focus: RowFocus | null) => {
    pendingFocus.current = focus;
    moveFocusIfRowGone(pendingFocus);
  }, []);

  // The refresh that removes the row re-renders this provider (new children); check after every
  // commit, which is cheap: nothing to do unless a removal is pending.
  useEffect(() => {
    moveFocusIfRowGone(pendingFocus);
  });

  const value = useMemo(
    () => ({ organizationPublicId, organizationName, report, focusAfterRowRemoval }),
    [organizationPublicId, organizationName, report, focusAfterRowRemoval],
  );

  return (
    <MembersFeedbackContext value={value}>
      {children}
      <Dialog
        open={reauth.open}
        onOpenChange={(open) => setReauth((current) => ({ ...current, open }))}
      >
        <DialogContent>
          <ReauthBody key={reauth.key} email={email} />
        </DialogContent>
      </Dialog>
    </MembersFeedbackContext>
  );
}

function moveFocusIfRowGone(pending: React.RefObject<RowFocus | null>) {
  const focus = pending.current;
  if (focus === null || focus.row.isConnected) return;
  pending.current = null;
  const target = focus.next?.isConnected ? focus.next : document.getElementById(focus.headingId);
  target?.focus();
}

function ReauthBody({ email }: { email: string }) {
  const pathname = usePathname();
  const [state, send, sending] = useActionState(async () => requestSignIn(email, pathname), null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const sent = state?.ok === true;

  // The send button goes away once the link is sent; keep focus inside the dialog.
  useEffect(() => {
    if (sent) doneRef.current?.focus();
  }, [sent]);

  if (sent) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Check your email</DialogTitle>
          <DialogDescription>
            Open the sign-in link sent to <span className="font-medium wrap-anywhere">{email}</span>
            , then try again. The link expires in 5 minutes.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button ref={doneRef} />}>Done</DialogClose>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Sign in again to continue</DialogTitle>
        <DialogDescription>
          Changing roles and removing people needs a sign-in from the last hour. We&apos;ll email a
          sign-in link to <span className="font-medium wrap-anywhere">{email}</span>.
        </DialogDescription>
      </DialogHeader>
      <FieldError>{state?.ok === false ? signInErrorMessage(state.error) : null}</FieldError>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Not now</DialogClose>
        <Button type="button" disabled={sending} onClick={() => startTransition(() => send())}>
          {sending ? <Spinner data-icon="inline-start" /> : null}
          Send sign-in link
        </Button>
      </DialogFooter>
    </>
  );
}
