"use client";

import type { DeactivatedFirm } from "@repo/auth";
import { useActionState } from "react";
import { dismissDeactivatedNotice } from "@/app/(app)/actions";
import { NoticeBand, useFocusPageHeadingAfterDismiss } from "@/components/app-shell/notice-band";
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
 * and it never takes focus. The layout renders it on every page, even with nothing to say, so
 * focus can move on to the page's `h1` after a dismissal.
 */
export function DeactivatedNotice({ firms, workspace }: DeactivatedNoticeProps) {
  const [state, formAction] = useActionState(dismissDeactivatedNotice, null);
  useFocusPageHeadingAfterDismiss(state);

  if (firms.length === 0) return null;
  return (
    <NoticeBand
      dismissLabel="Dismiss notice"
      formAction={formAction}
      fields={firms.map((firm) => (
        <input key={firm.publicId} type="hidden" name="firm" value={dismissalKey(firm)} />
      ))}
    >
      {deactivatedCopy(firms.length).notice({ names: firmNames(firms), workspace })}
    </NoticeBand>
  );
}
