"use client";

import { requestSignIn, verifyCode } from "@repo/auth/client";
import { Alert, AlertDescription } from "@repo/design-system/components/alert";
import { Button } from "@repo/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@repo/design-system/components/field";
import { Input } from "@repo/design-system/components/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@repo/design-system/components/input-otp";
import { Spinner } from "@repo/design-system/components/spinner";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import * as z from "zod";
import { signInErrorMessage } from "@/lib/auth/messages";
import { formString } from "@/lib/form-data";

/** Seconds before "Resend email" works again. */
export const RESEND_COOLDOWN = 30;
const CODE_LENGTH = 6;
const DIGITS = "^\\d+$";
const CODE_PATTERN = new RegExp(`^\\d{${CODE_LENGTH}}$`);
const emailSchema = z.email();

interface SignInFlowProps {
  /** Sanitized path to land on after signing in. */
  next: string | null;
  /** Copy for a `?error=` code the page arrived with. */
  arrivalError: string | null;
  /** Why the visitor is signing in, when `next` says: `invitation` for an invitation link. */
  purpose?: "invitation" | null;
}

interface RequestState {
  error: string | null;
  notice: string | null;
}

interface VerifyState {
  error: string | null;
  done: boolean;
  /** Which email the result belongs to; a resend starts a new one. */
  attempt: number;
  /** The code the error is about: editing it makes the error stale, so it's hidden. */
  code: string;
  /** Too many wrong codes for this email: its code can't work any more, whatever is typed. */
  locked: boolean;
}

const INITIAL_VERIFY: VerifyState = {
  error: null,
  done: false,
  attempt: 0,
  code: "",
  locked: false,
};

const INITIAL_REQUEST: RequestState = { error: null, notice: null };

/**
 * Email → "check your email" → code. The link in the email signs in on its own page
 * (`/sign-in/confirm`); this page only takes the code. Every response reads the same whether or
 * not the address can sign in.
 */
export function SignInFlow({ next, arrivalError, purpose = null }: SignInFlowProps) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [lastEmail, setLastEmail] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [code, setCode] = useState("");
  const [attempt, setAttempt] = useState(0);

  const [requestState, request, requesting] = useActionState(
    async (_previous: RequestState, input: { email: string; resend: boolean }) => {
      const email = input.email.trim();
      if (!emailSchema.safeParse(email).success) {
        return { error: "Enter an email address, like name@example.com.", notice: null };
      }
      const result = await requestSignIn(email, next ?? undefined);
      if (!result.ok) return { error: signInErrorMessage(result.error), notice: null };
      setSentTo(email);
      setLastEmail(email);
      setCooldown(RESEND_COOLDOWN);
      setCode("");
      setAttempt((count) => count + 1);
      return {
        error: null,
        notice: input.resend ? `If ${email} has access, a new email is on its way.` : null,
      };
    },
    INITIAL_REQUEST,
  );

  const [verifyState, verify, verifying] = useActionState(
    async (previous: VerifyState, input: { code: string }): Promise<VerifyState> => {
      const base = { done: false, attempt, code: input.code };
      const locked = previous.locked && previous.attempt === attempt;
      if (sentTo === null) return { ...base, error: null, locked };
      if (!CODE_PATTERN.test(input.code)) {
        return { ...base, error: "Enter the 6-digit code from the email.", locked };
      }
      const result = await verifyCode(sentTo, input.code);
      if (!result.ok) {
        // After a lockout the server forgets the code, so later tries read as expired; keep
        // saying what actually happened (and that a new email is the way out).
        const nowLocked = locked || result.error === "too_many_attempts";
        const error = nowLocked ? "too_many_attempts" : result.error;
        return { ...base, error: signInErrorMessage(error, "code"), locked: nowLocked };
      }
      // A full navigation, so Server Components see the new session cookie.
      window.location.assign(next ?? "/");
      return { ...base, error: null, done: true, locked: false };
    },
    INITIAL_VERIFY,
  );

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // Move focus with the step, so keyboard and screen reader users land on the new content.
  const step = sentTo === null ? "email" : "check";
  const headingRef = useRef<HTMLHeadingElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const previousStep = useRef(step);
  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    if (step === "check") headingRef.current?.focus();
    else emailRef.current?.focus();
  }, [step]);

  const busy = requesting || verifying || verifyState.done;

  if (sentTo === null) {
    const error = requestState.error;
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="font-heading text-xl">
              {purpose === "invitation"
                ? "Sign in to view your invitation"
                : "Sign in to Cognitive Wealth"}
            </h1>
          </CardTitle>
          <CardDescription>Enter your email to get a sign-in link and code.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {arrivalError !== null && requestState === INITIAL_REQUEST ? (
            <Alert variant="destructive">
              <AlertDescription>{arrivalError}</AlertDescription>
            </Alert>
          ) : null}
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const email = formString(new FormData(event.currentTarget), "email");
              startTransition(() => request({ email, resend: false }));
            }}
          >
            <FieldGroup>
              <Field data-invalid={error !== null || undefined}>
                <FieldLabel htmlFor="sign-in-email">Email</FieldLabel>
                <Input
                  ref={emailRef}
                  id="sign-in-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="name@example.com"
                  defaultValue={lastEmail}
                  aria-invalid={error !== null || undefined}
                  aria-describedby={error === null ? undefined : "sign-in-email-error"}
                  required
                />
                <FieldError id="sign-in-email-error">{error}</FieldError>
              </Field>
              <Button type="submit" size="lg" disabled={busy}>
                {requesting ? <Spinner data-icon="inline-start" /> : null}
                Continue
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    );
  }

  // A code error is about the code it was given: hidden while a new try runs, or once the code
  // is edited, so it never describes a code that isn't on screen.
  const verifyError =
    verifyState.attempt === attempt && !verifying && verifyState.code === code
      ? verifyState.error
      : null;
  const codeError = verifyError ?? requestState.error;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 ref={headingRef} tabIndex={-1} className="font-heading text-xl outline-none">
            Check your email
          </h1>
        </CardTitle>
        <CardDescription id="sign-in-check-description">
          If <span className="font-medium wrap-anywhere text-foreground">{sentTo}</span> has access,
          you&apos;ll get an email with a sign-in link and a 6-digit code. Both expire in 5 minutes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(() => verify({ code }));
          }}
        >
          <FieldGroup>
            <Field data-invalid={codeError !== null || undefined}>
              <FieldLabel htmlFor="sign-in-code">Sign-in code</FieldLabel>
              <InputOTP
                id="sign-in-code"
                name="code"
                maxLength={CODE_LENGTH}
                pattern={DIGITS}
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={setCode}
                disabled={verifyState.done}
                aria-invalid={codeError !== null || undefined}
                aria-describedby={
                  codeError === null ? "sign-in-code-hint" : "sign-in-code-hint sign-in-code-error"
                }
              >
                <InputOTPGroup>
                  {Array.from({ length: CODE_LENGTH }, (_, index) => (
                    <InputOTPSlot key={index} index={index} aria-invalid={codeError !== null} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              <FieldDescription id="sign-in-code-hint">
                Or open the link in the email on this device.
              </FieldDescription>
              <FieldError id="sign-in-code-error">{codeError}</FieldError>
            </Field>
            <Button type="submit" size="lg" disabled={busy}>
              {verifying || verifyState.done ? <Spinner data-icon="inline-start" /> : null}
              Sign in
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex flex-col items-start gap-1 sm:flex-row sm:justify-between">
        <Button
          type="button"
          variant="link"
          className="px-0"
          disabled={busy}
          onClick={() => setSentTo(null)}
        >
          Use a different email
        </Button>
        <Button
          type="button"
          variant="link"
          className="px-0 data-disabled:cursor-not-allowed data-disabled:no-underline data-disabled:opacity-50"
          disabled={busy || cooldown > 0}
          focusableWhenDisabled
          onClick={() => startTransition(() => request({ email: sentTo, resend: true }))}
        >
          {cooldown > 0 ? `Resend email in ${cooldown}s` : "Resend email"}
        </Button>
      </CardFooter>
      <output className="-mt-2 block px-6 text-sm text-muted-foreground empty:hidden">
        {requestState.notice}
      </output>
    </Card>
  );
}
