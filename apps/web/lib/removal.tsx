// What a removed member reads (ADR 0023), in the notice on app pages and on `/no-workspace`. Whole
// sentences, so each can be translated as one string; Firm names come from `firmNames`.
import type { ReactNode } from "react";

type RemovalCopy = {
  /** The notice on app pages, for a member who is in `workspace` now. */
  notice: (args: { firm: string; workspace: string }) => string;
  /** `/no-workspace`'s heading. */
  heading: (firm: string) => string;
  /** `/no-workspace`'s text when the viewer has invitations to open. */
  openInvitation: string;
  /** `/no-workspace`'s text when they don't, with their address (styled by the page). */
  askForInvitation: (email: ReactNode) => ReactNode;
  /** Added on `/no-workspace` when the viewer's other Firms were deactivated (ADR 0022). */
  alsoDeactivated: Record<"one" | "several", (names: string) => string>;
};

export const REMOVAL: RemovalCopy = {
  notice: ({ firm, workspace }) =>
    `You're no longer a member of ${firm}. You're now in ${workspace}.`,
  heading: (firm) => `You're no longer a member of ${firm}`,
  openInvitation: "Open an invitation to join another workspace.",
  askForInvitation: (email) => (
    <>To join another workspace, ask a workspace owner or admin to invite {email}.</>
  ),
  alsoDeactivated: {
    one: (names) => `${names} also no longer uses Cognitive Wealth.`,
    several: (names) => `${names} also no longer use Cognitive Wealth.`,
  },
};
