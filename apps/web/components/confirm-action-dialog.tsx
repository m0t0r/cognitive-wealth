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

type ConfirmActionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** An `AlertDialogTrigger`, when the dialog has its own (otherwise open it with `open`). */
  trigger?: ReactNode;
  finalFocus?: ComponentProps<typeof AlertDialogContent>["finalFocus"];
  title: ReactNode;
  description: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  /** `destructive` for what can't be undone; `default` for a change that can be. */
  confirmVariant?: "default" | "destructive";
  onConfirm: () => Promise<void>;
};

/**
 * Confirms a destructive or high-stakes action. `onConfirm` runs in a transition, with the confirm
 * button disabled (but still focused) and showing a spinner until it settles; it should close the
 * dialog (`onOpenChange`) whatever the outcome. Focus returns to `trigger`, or wherever
 * `finalFocus` says. Titles and descriptions wrap anywhere, since they quote names people chose.
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
  confirmVariant = "destructive",
  onConfirm,
}: ConfirmActionDialogProps) {
  const [pending, startTransition] = useTransition();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {trigger}
      <AlertDialogContent finalFocus={finalFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle className="wrap-anywhere">{title}</AlertDialogTitle>
          <AlertDialogDescription className="wrap-anywhere">{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            variant={confirmVariant}
            disabled={pending}
            focusableWhenDisabled
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
