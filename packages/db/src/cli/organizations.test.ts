import {
  CliError,
  REASON_MAX_LENGTH,
  normalizeSlug,
  parseReason,
  slugFromName,
} from "./organizations";

describe("slugFromName", () => {
  it.for([
    ["Acme", "acme"],
    ["Acme Corp.", "acme-corp"],
    ["  Société Générale  ", "societe-generale"],
    ["R&D -- Lab 42", "r-d-lab-42"],
    ["a".repeat(60), "a".repeat(48)],
    [`${"a".repeat(47)} b`, "a".repeat(47)],
  ])("%s → %s", ([name, slug]) => {
    expect(slugFromName(name!)).toBe(slug);
  });
});

describe("normalizeSlug", () => {
  it("trims and lowercases", () => {
    expect(normalizeSlug(" Acme ")).toBe("acme");
  });

  it("refuses one slugFromName wouldn't make, as invalid_input", () => {
    expect(() => normalizeSlug("Acme Corp")).toThrow(/Invalid slug/);
    expect(() => normalizeSlug("Acme Corp")).toThrow(
      expect.objectContaining({ code: "invalid_input" }),
    );
  });
});

describe("parseReason", () => {
  it("trims", () => {
    expect(parseReason("  Moved to Initech ")).toBe("Moved to Initech");
  });

  it.for([
    { name: "an empty reason", reason: "  ", message: /reason is empty/ },
    {
      name: "a reason that's too long",
      reason: "x".repeat(REASON_MAX_LENGTH + 1),
      message: /longer than 500/,
    },
  ])("refuses $name", ({ reason, message }) => {
    expect(() => parseReason(reason)).toThrow(message);
  });
});

describe("CliError", () => {
  it("is invalid_input unless the thrower names the refusal", () => {
    expect(new CliError("Bad").code).toBe("invalid_input");
    expect(new CliError({ code: "unknown_organization", message: "No such" })).toMatchObject({
      code: "unknown_organization",
      message: "No such",
    });
  });
});
