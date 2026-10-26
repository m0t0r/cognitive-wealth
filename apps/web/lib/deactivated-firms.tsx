// What a member of a Deactivated Firm reads (ADR 0022, point 10), on `/no-workspace` and in the
// notice on app pages. Whole sentences for one Firm and for several, so each can be translated as
// one string; `names` comes from `firmNames`.
import type { ReactNode } from "react";

const NAMES = new Intl.ListFormat("en-US", { style: "long", type: "conjunction" });

/** "Acme", "Acme and Globex", "Acme, Globex, and Initech". */
export function firmNames(firms: readonly { name: string }[]): string {
  return NAMES.format(firms.map((firm) => firm.name));
}

type DeactivatedCopy = {
  /** `/no-workspace`'s heading. */
  heading: (names: string) => string;
  /** `/no-workspace`'s text when the viewer has invitations to open. */
  openInvitation: string;
  /** `/no-workspace`'s text when they don't, with their address (styled by the page). */
  askForInvitation: (email: ReactNode) => ReactNode;
  /** The notice on app pages, for a member who is in `workspace` now. */
  notice: (args: { names: string; workspace: string }) => string;
};

export const DEACTIVATED: Record<"one" | "several", DeactivatedCopy> = {
  one: {
    heading: (names) => `${names} no longer uses Cognitive Wealth`,
    openInvitation: "Its workspace is no longer available. Open an invitation to join another one.",
    askForInvitation: (email) => (
      <>
        Its workspace is no longer available. To join another one, ask a workspace owner or admin to
        invite {email}.
      </>
    ),
    notice: ({ names, workspace }) =>
      `${names} no longer uses Cognitive Wealth, so its workspace is no longer available. You're in ${workspace}.`,
  },
  several: {
    heading: (names) => `${names} no longer use Cognitive Wealth`,
    openInvitation:
      "Their workspaces are no longer available. Open an invitation to join another one.",
    askForInvitation: (email) => (
      <>
        Their workspaces are no longer available. To join another one, ask a workspace owner or
        admin to invite {email}.
      </>
    ),
    notice: ({ names, workspace }) =>
      `${names} no longer use Cognitive Wealth, so their workspaces are no longer available. You're in ${workspace}.`,
  },
};

/** The copy for `count` Deactivated Firms: one Firm's, or several's. */
export function deactivatedCopy(count: number): DeactivatedCopy {
  return count === 1 ? DEACTIVATED.one : DEACTIVATED.several;
}
