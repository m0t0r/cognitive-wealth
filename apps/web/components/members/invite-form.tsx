"use client";

import type { Role } from "@repo/auth/access";
import { Button } from "@repo/design-system/components/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@repo/design-system/components/field";
import { Input } from "@repo/design-system/components/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/design-system/components/select";
import { Spinner } from "@repo/design-system/components/spinner";
import { startTransition, useActionState, useRef, useState } from "react";
import { inviteMemberAction } from "@/app/(app)/settings/members/actions";
import type { FormState } from "@/lib/action-result";
import { formString } from "@/lib/form-data";
import { assignableRoles, ROLE_LABELS } from "@/lib/roles";
import { useMembersFeedback } from "./members-feedback";

const FIELD_ERRORS: Partial<Record<string, string>> = {
  invalid_input: "Enter an email address, like name@example.com.",
  already_member: "This person is already a member of this workspace.",
};

export function InviteForm({ viewerRole }: { viewerRole: Role }) {
  const { report } = useMembersFeedback();
  const items = assignableRoles(viewerRole).map((role) => ({
    value: role,
    label: ROLE_LABELS[role],
  }));
  const [role, setRole] = useState<Role>("member");
  const formRef = useRef<HTMLFormElement>(null);

  const [state, invite, pending] = useActionState(
    async (_previous: FormState, formData: FormData): Promise<FormState> => {
      const result = await inviteMemberAction(formData);
      if (!result.ok && FIELD_ERRORS[result.error] !== undefined) return result;
      if (report(result, `Invitation sent to ${formString(formData, "email").trim()}.`)) {
        formRef.current?.reset();
        setRole("member");
      }
      return result;
    },
    null,
  );
  const emailError = state?.ok === false ? (FIELD_ERRORS[state.error] ?? null) : null;

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => invite(formData));
      }}
    >
      <FieldGroup className="gap-5">
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,12rem)]">
          <Field data-invalid={emailError !== null || undefined}>
            <FieldLabel htmlFor="invite-email">Email</FieldLabel>
            <Input
              id="invite-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="name@example.com"
              required
              aria-invalid={emailError !== null || undefined}
              aria-describedby={emailError === null ? undefined : "invite-email-error"}
            />
            <FieldError id="invite-email-error">{emailError}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor="invite-role">Role</FieldLabel>
            <Select
              name="role"
              items={items}
              value={role}
              onValueChange={(value) => {
                if (value !== null) setRole(value);
              }}
            >
              <SelectTrigger id="invite-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {items.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Send invitation
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
