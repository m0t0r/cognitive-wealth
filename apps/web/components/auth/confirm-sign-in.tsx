"use client";

import {
  callbackPathOrDefault,
  isWellFormedSignInToken,
  sanitizeCallbackPath,
  verifyMagicLink,
} from "@repo/auth/client";
import { Alert, AlertDescription } from "@repo/design-system/components/alert";
import { Button, buttonVariants } from "@repo/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/card";
import { Spinner } from "@repo/design-system/components/spinner";
import Link from "next/link";
import { startTransition, useActionState, useEffect, useState } from "react";
import { signInErrorMessage } from "@/lib/auth/messages";
import { signInPath } from "@/lib/auth/paths";

/**
 * What the email's link carried in its fragment. `undefined` until read in the browser.
 * `malformed`: a token no link of ours carries (mangled by a mail client, or made up).
 */
type FragmentLink = { token: string; next: string | null; malformed: boolean } | null | undefined;

/** Codes that mean this link can never work: offer a new one rather than a retry. */
const DEAD_LINK_ERRORS = new Set(["invalid_or_expired", "invalid_request"]);

interface ConfirmState {
  error: string | null;
  expired: boolean;
  done: boolean;
}

/**
 * The magic link lands here with `#token=…&next=…`. The fragment never reaches a server, and is
 * removed from the address bar (and history) as soon as it's read. Only a click spends the
 * token: mail scanners and prefetchers that open the link never sign anyone in.
 *
 * A link signs in whoever it was sent to, in any browser. Someone already signed in is told so
 * before the click, so a link someone else sent them can't quietly swap their account.
 */
export function ConfirmSignIn({ signedInAs = null }: { signedInAs?: string | null }) {
  const [link, setLink] = useState<FragmentLink>(undefined);

  // The fragment only exists in the browser, so it's read after hydration, once.
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get("token");
    if (token) {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    }
    const found = token
      ? {
          token,
          next: sanitizeCallbackPath(params.get("next")),
          malformed: !isWellFormedSignInToken(token),
        }
      : null;
    // A second run (React's dev double-invoke) finds the fragment already cleared: keep the first.
    // oxlint-disable-next-line react/set-state-in-effect
    setLink((current) => current ?? found);
  }, []);

  const [state, confirm, confirming] = useActionState(
    async (_previous: ConfirmState): Promise<ConfirmState> => {
      if (!link) return { error: null, expired: false, done: false };
      const result = await verifyMagicLink(link.token);
      if (!result.ok) {
        // A link the server refuses as malformed is as dead as an expired one.
        const dead = DEAD_LINK_ERRORS.has(result.error);
        return {
          error: signInErrorMessage(dead ? "invalid_or_expired" : result.error, "link"),
          expired: dead,
          done: false,
        };
      }
      // A full navigation, so Server Components see the new session cookie.
      window.location.assign(callbackPathOrDefault(link.next));
      return { error: null, expired: false, done: true };
    },
    { error: null, expired: false, done: false },
  );

  if (link === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="font-heading text-xl">Finish signing in</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-muted-foreground">
          <Spinner aria-hidden />
          <span>Reading your sign-in link…</span>
        </CardContent>
      </Card>
    );
  }

  if (link === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="font-heading text-xl">Open the link from your email</h1>
          </CardTitle>
          <CardDescription>
            This page signs you in from the link in your sign-in email. To get a new one, sign in
            again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/sign-in" className={buttonVariants({ size: "lg", className: "w-full" })}>
            Go to sign in
          </Link>
        </CardContent>
      </Card>
    );
  }

  const retryHref = signInPath(link.next);
  // A malformed token is never sent to the server: it shows the dead-link state straight away.
  const expired = state.expired || link.malformed;
  const error = link.malformed ? signInErrorMessage("invalid_or_expired", "link") : state.error;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="font-heading text-xl">Finish signing in</h1>
        </CardTitle>
        {expired ? null : <CardDescription>Continue to sign in on this device.</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {error === null ? null : (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {expired || signedInAs === null ? null : (
          <Alert>
            <AlertDescription className="wrap-anywhere">
              You&apos;re signed in as <span className="font-medium">{signedInAs}</span>. Continuing
              signs you in with the account this link was sent to instead.
            </AlertDescription>
          </Alert>
        )}
        {expired ? (
          <Link href={retryHref} className={buttonVariants({ size: "lg" })}>
            Get a new sign-in link
          </Link>
        ) : (
          <Button
            type="button"
            size="lg"
            disabled={confirming || state.done}
            onClick={() => startTransition(() => confirm())}
          >
            {confirming || state.done ? <Spinner data-icon="inline-start" /> : null}
            Continue to Cognitive Wealth
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
