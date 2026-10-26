// What a member of a Deactivated Firm reads (ADR 0022, point 10), on `/no-workspace` and in the
// notice on app pages. Whole sentences for one Firm and for several, so each can be translated as
// one string; `names` comes from `firmNames`.

const NAMES = new Intl.ListFormat("en-US", { style: "long", type: "conjunction" });

/** "Acme", "Acme and Globex", "Acme, Globex, and Initech". */
export function firmNames(firms: readonly { name: string }[]): string {
  return NAMES.format(firms.map((firm) => firm.name));
}

type DeactivatedCopy = {
  /** `/no-workspace`'s heading. */
  heading: (names: string) => string;
  /** `/no-workspace`'s first sentence. */
  gone: string;
  /** The notice on app pages, for a member who is in `workspace` now. */
  notice: (args: { names: string; workspace: string }) => string;
};

export const DEACTIVATED: Record<"one" | "several", DeactivatedCopy> = {
  one: {
    heading: (names) => `${names} no longer uses Cognitive Wealth`,
    gone: "Its workspace is no longer available.",
    notice: ({ names, workspace }) =>
      `${names} no longer uses Cognitive Wealth, so its workspace is no longer available. You're in ${workspace}.`,
  },
  several: {
    heading: (names) => `${names} no longer use Cognitive Wealth`,
    gone: "Their workspaces are no longer available.",
    notice: ({ names, workspace }) =>
      `${names} no longer use Cognitive Wealth, so their workspaces are no longer available. You're in ${workspace}.`,
  },
};

/** The copy for `firms`: one Firm's, or several's. */
export function deactivatedCopy(firms: readonly unknown[]): DeactivatedCopy {
  return firms.length === 1 ? DEACTIVATED.one : DEACTIVATED.several;
}
