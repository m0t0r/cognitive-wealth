"use client";

import type { DeactivatedFirm } from "@repo/auth";
import { Button } from "@repo/design-system/components/button";
import { useActionState, useEffect } from "react";
import { dismissDeactivatedNotice } from "@/app/(app)/actions";
import { deactivatedCopy, firmNames } from "@/lib/deactivated-firms";
import { dismissalKey } from "@/lib/dismissed-notices";

type DeactivatedNoticeProps = {
  /** The viewer's Deactivated Firms whose notice isn't dismissed in this browser. */
  firms: DeactivatedFirm[];
  /** The workspace the viewer is in now. */
  workspace: string;
};

/**
 * Tells a member who still has a workspace that others of theirs no longer use Cognitive Wealth
 * (ADR 0022), on every app page until they dismiss it. Ordinary page content: not a live region,
 * and it never takes focus. The layout renders it on every page, even with nothing to say, so its
 * state outlives the dismissal that empties it and focus can move on to the page's `h1`. The form
 * posts without JavaScript too.
 */
export function DeactivatedNotice({ firms, workspace }: DeactivatedNoticeProps) {
  const [state, formAction] = useActionState(dismissDeactivatedNotice, null);

  useEffect(() => {
    if (state !== null) focusPageHeading();
  }, [state]);

  if (firms.length === 0) return null;
  return (
    // The band runs the inset's full width; its content sits in the pages' own column
    // (`mx-auto max-w-4xl` inside the layout's `px-4 md:px-8`), so the text lines up with the h1.
    <div className="border-b bg-muted px-4 py-3 md:px-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 sm:flex-row sm:items-center">
        <p className="flex-1 text-sm wrap-anywhere">
          {deactivatedCopy(firms.length).notice({ names: firmNames(firms), workspace })}
        </p>
        <form action={formAction}>
          {firms.map((firm) => (
            <input key={firm.publicId} type="hidden" name="firm" value={dismissalKey(firm)} />
          ))}
          <Button type="submit" variant="outline" size="sm" aria-label="Dismiss notice">
            Dismiss
          </Button>
        </form>
      </div>
    </div>
  );
}

/**
 * Moves focus to the page's `h1`, so it isn't lost to `body` once the notice is gone. Like the
 * app's other focus-target headings (`tabIndex={-1}` with `outline-none`), it draws no ring: a
 * heading isn't a control, and the page reads on from it.
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
