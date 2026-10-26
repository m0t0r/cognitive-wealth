"use client";

import { useActionState } from "react";
import { dismissRemovalNotice } from "@/app/(app)/actions";
import { NoticeBand, useFocusPageHeadingAfterDismiss } from "@/components/app-shell/notice-band";
import { REMOVAL } from "@/lib/removal";

type RemovalNoticeProps = {
  /** The name of the Firm a Removal moved the viewer's session off, or `null` for no notice. */
  firm: string | null;
  /** The workspace the viewer is in now. */
  workspace: string;
};

/**
 * Tells a member that the Firm they were in removed them, and where they are now (ADR 0023), on
 * every app page until they dismiss it or switch workspace. Announced as a status, without taking
 * focus. The layout renders it on every page, even with nothing to say: its empty status region is
 * then in place before the text arrives, and focus can move on to the page's `h1` after a
 * dismissal.
 */
export function RemovalNotice({ firm, workspace }: RemovalNoticeProps) {
  const [state, formAction] = useActionState(dismissRemovalNotice, null);
  useFocusPageHeadingAfterDismiss(state);

  return (
    <NoticeBand
      announced
      dismissLabel={`Dismiss notice about ${firm ?? ""}`}
      formAction={formAction}
    >
      {firm === null ? null : REMOVAL.notice({ firm, workspace })}
    </NoticeBand>
  );
}
