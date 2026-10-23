"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/design-system/components/alert-dialog";
import { Spinner } from "@repo/design-system/components/spinner";
import { type ComponentProps, type ReactNode, useTransition } from "react";

/**
 * Confirms a destructive action. `onConfirm` runs in a transition, with the confirm button
 * disabled and showing a spinner until it settles; it should close the dialog (`onOpenChange`)
 * whatever the outcome. Focus returns to `trigger`, or wherever `finalFocus` says.
 */
export function ConfirmActionDialog({
  open,
  onOpenChange,
  trigger,
  finalFocus,
  title,
  description,
  cancelLabel,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** An `AlertDialogTrigger`, when the dialog has its own (otherwise open it with `open`). */
  trigger?: ReactNode;
  finalFocus?: ComponentProps<typeof AlertDialogContent>["finalFocus"];
  title: ReactNode;
  description: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {trigger}
      <AlertDialogContent finalFocus={finalFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={() => startTransition(onConfirm)}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
