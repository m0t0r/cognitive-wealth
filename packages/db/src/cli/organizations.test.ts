import { slugFromName } from "./organizations";

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
