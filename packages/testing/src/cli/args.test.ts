import { describe, expect, it } from "vitest";
import { parseDevSignInArgs } from "./args";

describe("parseDevSignInArgs", () => {
  it("takes the email, lowercased, with defaults for everything else", () => {
    expect(parseDevSignInArgs(["Owner@Cognitive-Wealth.test"])).toEqual({
      help: false,
      email: "owner@cognitive-wealth.test",
      link: false,
      state: undefined,
      app: undefined,
      mailpit: undefined,
      ip: undefined,
    });
  });

  it.each(["10.77.0.3", "2001:db8::7"])("passes --ip %s on", (ip) => {
    expect(parseDevSignInArgs(["a@b.test", "--ip", ip]).ip).toBe(ip);
  });

  it.each(["10.77.0", "not-an-ip", "10.0.0.1, 10.0.0.2", ""])("refuses --ip %j", (ip) => {
    expect(() => parseDevSignInArgs(["a@b.test", "--ip", ip])).toThrow(`Not an IP address: ${ip}`);
  });

  it("reads the other options", () => {
    expect(
      parseDevSignInArgs([
        "a@b.test",
        "--link",
        "--state",
        "s.json",
        "--app",
        "http://localhost:3000",
        "--mailpit",
        "http://127.0.0.1:8025",
      ]),
    ).toMatchObject({ link: true, state: "s.json", app: "http://localhost:3000" });
  });

  it("refuses a missing or extra email, or one that isn't an address", () => {
    expect(() => parseDevSignInArgs([])).toThrow(/^Usage:/);
    expect(() => parseDevSignInArgs(["a@b.test", "c@d.test"])).toThrow(/^Usage:/);
    expect(() => parseDevSignInArgs(["nobody"])).toThrow("Not an email address: nobody");
  });

  it("answers --help without an email", () => {
    expect(parseDevSignInArgs(["--help"]).help).toBe(true);
  });
});
