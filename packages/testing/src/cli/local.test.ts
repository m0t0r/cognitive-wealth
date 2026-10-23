import { isLocalHost, localUrl, portlessCaPath } from "./local";

describe("isLocalHost", () => {
  it.each([
    "http://localhost:3000",
    "http://127.0.0.1:8025",
    "http://[::1]:3000",
    "https://cognitive-wealth.localhost",
    "https://feat-auth.cognitive-wealth.localhost/sign-in",
    "https://LOCALHOST.",
  ])("allows %s", (url) => {
    expect(isLocalHost(url)).toBe(true);
  });

  it.each([
    "https://cognitive-wealth.com",
    "https://localhost.evil.com",
    "https://evil-localhost",
    "http://127.0.0.2",
    "http://10.0.0.1",
    "http://0.0.0.0",
    "not a url",
  ])("refuses %s", (url) => {
    expect(isLocalHost(url)).toBe(false);
  });
});

describe("localUrl", () => {
  it("returns the parsed URL for a local http(s) URL", () => {
    expect(localUrl("the app", "https://cognitive-wealth.localhost/").origin).toBe(
      "https://cognitive-wealth.localhost",
    );
  });

  it("refuses remote hosts, other schemes and junk", () => {
    expect(() => localUrl("the app", "https://example.com")).toThrow(
      "Refusing to sign in against the app https://example.com",
    );
    expect(() => localUrl("Mailpit", "ftp://localhost")).toThrow("must be http(s)");
    expect(() => localUrl("Mailpit", "localhost:8025")).toThrow("must be http(s)");
    expect(() => localUrl("Mailpit", "::")).toThrow("is not a URL");
  });
});

describe("portlessCaPath", () => {
  it("uses PORTLESS_STATE_DIR, else ~/.portless", () => {
    expect(portlessCaPath("/state", "/home/me")).toBe("/state/ca.pem");
    expect(portlessCaPath(undefined, "/home/me")).toBe("/home/me/.portless/ca.pem");
    expect(portlessCaPath("", "/home/me")).toBe("/home/me/.portless/ca.pem");
  });
});
