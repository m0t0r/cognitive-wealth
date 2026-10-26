"use client";

import { Button } from "@repo/design-system/components/button";
import { useEffect, type ReactNode } from "react";

type NoticeBandProps = {
  /** The notice's one sentence or two, or `null` when there's nothing to say. */
  children: ReactNode;
  /**
   * Announced as a status (an `output`), or ordinary page content (a `p`). An announced band
   * keeps its empty `output` mounted with nothing to say, since a status region inserted with its
   * text isn't reliably announced (WCAG 4.1.3).
   */
  announced?: boolean | undefined;
  /** The Dismiss button's accessible name. */
  dismissLabel: string;
  /** The Dismiss form's action, from `useActionState`. */
  formAction: (form: FormData) => void;
  /** Hidden fields the form posts. */
  fields?: ReactNode;
};

/**
 * A notice above every app page, with a Dismiss button, which the layout renders under the
 * header. The band runs the inset's full width; its content sits in the pages' own column
 * (`mx-auto max-w-4xl` inside the layout's `px-4 md:px-8`), so the text lines up with the h1. The
 * form posts without JavaScript too. It never takes focus.
 */
export function NoticeBand({
  children,
  announced = false,
  dismissLabel,
  formAction,
  fields,
}: NoticeBandProps) {
  const shown = children !== null && children !== undefined;
  if (!shown && !announced) return null;
  // Empty, the same elements stay in place with no styles, so they take no room and the
  // `output` is the one its text later arrives in.
  return (
    <div className={shown ? "border-b bg-muted px-4 py-3 md:px-8" : undefined}>
      <div
        className={
          shown
            ? "mx-auto flex w-full max-w-4xl flex-col gap-3 sm:flex-row sm:items-center"
            : undefined
        }
      >
        {announced ? (
          // `output` is a status region (`role="status"`), announced without taking focus.
          <output className={shown ? "block flex-1 text-sm wrap-anywhere" : undefined}>
            {children}
          </output>
        ) : (
          <p className="flex-1 text-sm wrap-anywhere">{children}</p>
        )}
        {shown ? (
          <form action={formAction}>
            {fields}
            <Button type="submit" variant="outline" size="sm" aria-label={dismissLabel}>
              Dismiss
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Moves focus to the page's `h1` once a dismissal settles (`state` stops being `null`), so it
 * isn't lost to `body` when the notice is gone. The notice's component stays mounted even with
 * nothing to say, so its state outlives the dismissal that empties it.
 */
export function useFocusPageHeadingAfterDismiss(state: unknown) {
  useEffect(() => {
    if (state !== null) focusPageHeading();
  }, [state]);
}

/**
 * Like the app's other focus-target headings (`tabIndex={-1}` with `outline-none`), it draws no
 * ring: a heading isn't a control, and the page reads on from it.
 */
function focusPageHeading() {
  const heading = document.querySelector<HTMLElement>("main h1");
  if (heading === null) return;
  if (!heading.hasAttribute("tabindex")) {
    heading.tabIndex = -1;
    heading.classList.add("outline-none");
  }
  heading.focus();
}
