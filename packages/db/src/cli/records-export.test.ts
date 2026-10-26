import { isInside } from "./records-export";

describe("isInside", () => {
  it.for([
    ["/repo/exports/acme", true],
    ["/repo", true],
    ["/repository/acme", false],
    ["/elsewhere/acme", false],
  ] as const)("%s is inside /repo: %s", ([path, inside]) => {
    expect(isInside({ path, root: "/repo" })).toBe(inside);
  });
});
