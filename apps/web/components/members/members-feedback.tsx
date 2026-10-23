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
import { usePathname } from "next/navigation";
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
import type { ActionResult } from "@/lib/action-result";
import { signInErrorMessage, tenantErrorMessage } from "@/lib/auth/messages";

interface MembersFeedback {
  organizationName: string;
  /**
   * Shows the outcome of an action: a toast, or the "sign in again" dialog when the session is
   * too old for it. Returns whether the action worked.
   */
  report: (result: ActionResult, success: string) => boolean;
}

const MembersFeedbackContext = createContext<MembersFeedback | null>(null);

export function useMembersFeedback(): MembersFeedback {
  const context = use(MembersFeedbackContext);
  if (context === null) throw new Error("useMembersFeedback needs a MembersFeedbackProvider");
  return context;
}

export function MembersFeedbackProvider({
  email,
  organizationName,
  children,
}: {
  /** The viewer's own address, where the fresh sign-in link goes. */
  email: string;
  organizationName: string;
  children: React.ReactNode;
}) {
  const [reauth, setReauth] = useState({ open: false, key: 0 });

  const report = useCallback((result: ActionResult, success: string) => {
    if (result.ok) {
      toast.success(success);
      return true;
    }
    if (result.error === "reauth_required") {
      setReauth((current) => ({ open: true, key: current.key + 1 }));
    } else {
      toast.error(tenantErrorMessage(result.error));
    }
    return false;
  }, []);

  const value = useMemo(() => ({ organizationName, report }), [organizationName, report]);

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
