// The dismissal cookie (ADR 0022, point 11): which Deactivated Firms' notices this browser has
// dismissed. Each entry pairs the Firm's publicId with its deactivation time, so a Firm deactivated
// again after a reactivation shows its notice again. It isn't signed: editing it only hides or
// shows the viewer's own notice, so a malformed value is just ignored.
import type { DeactivatedFirm } from "@repo/auth";
import { COOKIE_PREFIX } from "@repo/auth/constants";

export const DISMISSED_NOTICES_COOKIE = `${COOKIE_PREFIX}.dismissed_notices`;

/** Chrome's maximum: a longer `Max-Age` is cut to 400 days anyway. */
export const DISMISSED_NOTICES_MAX_AGE = 400 * 24 * 60 * 60;

/** Longer values are ignored. Pruning keeps real ones far below it (about 50 bytes a Firm). */
export const DISMISSED_NOTICES_MAX_LENGTH = 2048;

/** A dismissed notice: the Firm and the deactivation it was about, in epoch milliseconds. */
export type Dismissal = { publicId: string; deactivatedAt: number };

type FirmDeactivation = Pick<DeactivatedFirm, "publicId" | "deactivatedAt">;

// `<publicId>~<epoch ms>`, joined by `.`: characters cookies and form fields carry as they are.
const PAIR = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})~(\d{1,15})$/;
const SEPARATOR = ".";

export function dismissalOf({ publicId, deactivatedAt }: FirmDeactivation): Dismissal {
  return { publicId, deactivatedAt: deactivatedAt.getTime() };
}

/** One pair as the cookie writes it, and as the notice's form names a Firm it shows. */
export function dismissalKey(firm: FirmDeactivation | Dismissal): string {
  const at = firm.deactivatedAt instanceof Date ? firm.deactivatedAt.getTime() : firm.deactivatedAt;
  return `${firm.publicId}~${at}`;
}

function parsePair(value: string): Dismissal | null {
  const match = PAIR.exec(value);
  return match ? { publicId: match[1]!, deactivatedAt: Number(match[2]) } : null;
}

/** The cookie's dismissals; a missing, malformed or oversized value is none. */
export function parseDismissals(value: string | undefined): Dismissal[] {
  if (!value || value.length > DISMISSED_NOTICES_MAX_LENGTH) return [];
  const pairs = value.split(SEPARATOR).map(parsePair);
  return pairs.every((pair) => pair !== null) ? pairs : [];
}

export function serializeDismissals(dismissals: Dismissal[]): string {
  return dismissals.map(dismissalKey).join(SEPARATOR);
}

/** The Firms whose notice still shows: those whose deactivation isn't dismissed. */
export function undismissed<Firm extends FirmDeactivation>({
  firms,
  dismissals,
}: {
  firms: Firm[];
  dismissals: Dismissal[];
}): Firm[] {
  const dismissed = new Set(dismissals.map(dismissalKey));
  return firms.filter((firm) => !dismissed.has(dismissalKey(firm)));
}

type DismissArgs = {
  /** The viewer's Deactivated Firms now. */
  firms: FirmDeactivation[];
  /** What the cookie says already. */
  dismissals: Dismissal[];
  /** The pairs the dismissed notice named (`dismissalKey`), as the form sent them. */
  named: string[];
};

/**
 * The cookie's new dismissals once the viewer dismisses a notice: the earlier ones and the named
 * ones, kept only for deactivations the viewer still has, so the cookie can't grow without bound
 * and a pair the viewer was never shown can't be planted.
 */
export function dismiss({ firms, dismissals, named }: DismissArgs): Dismissal[] {
  const wanted = new Set([
    ...dismissals.map(dismissalKey),
    ...named.flatMap((value) => {
      const pair = parsePair(value);
      return pair ? [dismissalKey(pair)] : [];
    }),
  ]);
  return firms.map(dismissalOf).filter((dismissal) => wanted.has(dismissalKey(dismissal)));
}
