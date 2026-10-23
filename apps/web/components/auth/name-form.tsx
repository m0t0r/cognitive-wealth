"use client";

import { Button } from "@repo/design-system/components/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@repo/design-system/components/field";
import { Input } from "@repo/design-system/components/input";
import { Spinner } from "@repo/design-system/components/spinner";
import { useActionState } from "react";
import { saveName } from "@/app/(auth)/welcome/actions";
import { tenantErrorMessage } from "@/lib/auth/messages";

export function NameForm({ next }: { next: string | null }) {
  const [state, action, pending] = useActionState(saveName, null);
  const error =
    state === null || state.ok
      ? null
      : state.error === "invalid_input"
        ? "Enter your name, up to 100 characters."
        : tenantErrorMessage(state.error);

  return (
    <form action={action}>
      <input type="hidden" name="next" value={next ?? ""} />
      <FieldGroup>
        <Field data-invalid={error !== null || undefined}>
          <FieldLabel htmlFor="profile-name">Name</FieldLabel>
          <Input
            id="profile-name"
            name="name"
            autoComplete="name"
            maxLength={100}
            required
            aria-invalid={error !== null || undefined}
            aria-describedby={error === null ? undefined : "profile-name-error"}
          />
          <FieldError id="profile-name-error">{error}</FieldError>
        </Field>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Continue
        </Button>
      </FieldGroup>
    </form>
  );
}
