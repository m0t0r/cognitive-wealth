"use client";

import { Button } from "@repo/design-system/components/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@repo/design-system/components/field";
import { Input } from "@repo/design-system/components/input";
import { Spinner } from "@repo/design-system/components/spinner";
import { useActionState } from "react";
import { saveName } from "@/app/(auth)/welcome/actions";
import type { FormState } from "@/lib/action-result";
import { tenantErrorMessage } from "@/lib/auth/messages";
import { formString } from "@/lib/form-data";

/** The server's limit too (`nameSchema` in `@repo/auth`). */
export const NAME_MAX_LENGTH = 100;
const INVALID_NAME = `Enter your name, up to ${NAME_MAX_LENGTH} characters.`;

/**
 * The browser's own "fill out this field" bubble is off (`noValidate`): an empty name gets the
 * same message, in the same place, as one that is only spaces.
 */
export function NameForm({ next }: { next: string | null }) {
  const [state, action, pending] = useActionState(
    async (previous: FormState, formData: FormData): Promise<FormState> => {
      if (formString(formData, "name").trim() === "") return { ok: false, error: "invalid_input" };
      return saveName(previous, formData);
    },
    null,
  );
  const error =
    state === null || state.ok
      ? null
      : state.error === "invalid_input"
        ? INVALID_NAME
        : tenantErrorMessage(state.error);

  return (
    <form action={action} noValidate>
      <input type="hidden" name="next" value={next ?? ""} />
      <FieldGroup>
        <Field data-invalid={error !== null || undefined}>
          <FieldLabel htmlFor="profile-name">Name</FieldLabel>
          <Input
            id="profile-name"
            name="name"
            autoComplete="name"
            maxLength={NAME_MAX_LENGTH}
            required
            aria-invalid={error !== null || undefined}
            aria-describedby={error === null ? undefined : "profile-name-error"}
          />
          <FieldError id="profile-name-error">{error}</FieldError>
        </Field>
        <Button type="submit" size="lg" disabled={pending} focusableWhenDisabled>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Continue
        </Button>
      </FieldGroup>
    </form>
  );
}
