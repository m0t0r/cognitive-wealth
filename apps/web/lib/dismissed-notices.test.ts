import {
  DISMISSED_NOTICES_MAX_LENGTH,
  dismiss,
  dismissalKey,
  dismissalOf,
  parseDismissals,
  serializeDismissals,
  undismissed,
} from "./dismissed-notices";

const ACME = {
  publicId: "0192f0c4-0000-7000-8000-000000000001",
  name: "Acme",
  deactivatedAt: new Date("2026-10-01T12:00:00.123Z"),
};
const GLOBEX = {
  publicId: "0192f0c4-0000-7000-8000-000000000002",
  name: "Globex",
  deactivatedAt: new Date("2026-10-02T08:30:00Z"),
};
const ACME_PAIR = `${ACME.publicId}~${ACME.deactivatedAt.getTime()}`;
const GLOBEX_PAIR = `${GLOBEX.publicId}~${GLOBEX.deactivatedAt.getTime()}`;

describe("parseDismissals and serializeDismissals", () => {
  it("round-trip pairs of publicId and deactivation time", () => {
    const dismissals = [dismissalOf(ACME), dismissalOf(GLOBEX)];
    const value = serializeDismissals(dismissals);

    expect(value).toBe(`${ACME_PAIR}.${GLOBEX_PAIR}`);
    expect(parseDismissals(value)).toEqual(dismissals);
  });

  it("reads no cookie, or an empty one, as nothing dismissed", () => {
    expect(parseDismissals(undefined)).toEqual([]);
    expect(parseDismissals("")).toEqual([]);
    expect(serializeDismissals([])).toBe("");
  });

  it.for([
    ["not a pair", "acme"],
    ["no time", `${ACME.publicId}~`],
    ["a time that isn't a number", `${ACME.publicId}~soon`],
    ["a publicId that isn't a UUID", "acme~1759320000123"],
    ["one bad pair among good ones", `${ACME_PAIR}.junk`],
    ["an empty pair", `${ACME_PAIR}..${GLOBEX_PAIR}`],
    ["JSON", JSON.stringify([ACME.publicId])],
  ])("ignores a malformed value: %s", ([, value]) => {
    expect(parseDismissals(value)).toEqual([]);
  });

  it("ignores an oversized value", () => {
    const value = Array.from({ length: 100 }, () => ACME_PAIR).join(".");
    expect(value.length).toBeGreaterThan(DISMISSED_NOTICES_MAX_LENGTH);
    expect(parseDismissals(value)).toEqual([]);
  });
});

describe("undismissed", () => {
  it("shows every Firm when nothing is dismissed", () => {
    expect(undismissed({ firms: [ACME, GLOBEX], dismissals: [] })).toEqual([ACME, GLOBEX]);
  });

  it("hides a Firm whose pair the cookie lists", () => {
    expect(undismissed({ firms: [ACME, GLOBEX], dismissals: parseDismissals(ACME_PAIR) })).toEqual([
      GLOBEX,
    ]);
  });

  it("shows a Firm deactivated again since it was dismissed", () => {
    const again = { ...ACME, deactivatedAt: new Date("2026-10-20T09:00:00Z") };
    expect(undismissed({ firms: [again], dismissals: parseDismissals(ACME_PAIR) })).toEqual([
      again,
    ]);
  });
});

describe("dismiss", () => {
  it("adds the pairs the notice named", () => {
    expect(
      dismiss({ firms: [ACME, GLOBEX], dismissals: [], named: [ACME_PAIR, GLOBEX_PAIR] }),
    ).toEqual([dismissalOf(ACME), dismissalOf(GLOBEX)]);
  });

  it("keeps earlier dismissals of Firms still deactivated", () => {
    expect(
      dismiss({
        firms: [ACME, GLOBEX],
        dismissals: parseDismissals(ACME_PAIR),
        named: [GLOBEX_PAIR],
      }),
    ).toEqual([dismissalOf(ACME), dismissalOf(GLOBEX)]);
  });

  it("drops pairs for Firms the viewer no longer has deactivated", () => {
    // Globex was reactivated (or the viewer left it); Acme was deactivated again.
    const again = { ...ACME, deactivatedAt: new Date("2026-10-20T09:00:00Z") };
    expect(
      dismiss({
        firms: [again],
        dismissals: parseDismissals(`${ACME_PAIR}.${GLOBEX_PAIR}`),
        named: [dismissalKey(again)],
      }),
    ).toEqual([dismissalOf(again)]);
  });

  it("ignores named pairs that aren't the viewer's deactivated Firms, or are malformed", () => {
    const stranger = "0192f0c4-0000-7000-8000-00000000000f~1759320000000";
    expect(
      dismiss({ firms: [ACME], dismissals: [], named: [stranger, "junk", GLOBEX_PAIR] }),
    ).toEqual([]);
  });

  it("lists each Firm once", () => {
    expect(
      dismiss({ firms: [ACME], dismissals: parseDismissals(ACME_PAIR), named: [ACME_PAIR] }),
    ).toEqual([dismissalOf(ACME)]);
  });
});
