"use client";

import { signOut } from "@repo/auth/client";
import { Button } from "@repo/design-system/components/button";
import { Spinner } from "@repo/design-system/components/spinner";
import { useTransition } from "react";
import { toast } from "sonner";

/** Signs out, then loads `redirectTo` in full so no signed-in page stays in the router cache. */
export function SignOutButton({
  redirectTo = "/sign-in",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "onClick"> & { redirectTo?: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      disabled={pending}
      {...props}
      onClick={() => startTransition(() => signOutAndLeave(redirectTo))}
    >
      {pending ? <Spinner data-icon="inline-start" /> : null}
      Sign out
    </Button>
  );
}

/** Signs out, then loads `redirectTo`; for menu items that can't be a `SignOutButton`. */
export async function signOutAndLeave(redirectTo = "/sign-in"): Promise<void> {
  const result = await signOut();
  if (!result.ok) {
    toast.error("Unable to sign out. Check your connection and try again.");
    return;
  }
  window.location.assign(redirectTo);
}
