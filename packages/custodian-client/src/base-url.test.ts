import { custodianUrl } from "./base-url.ts";

describe("custodianUrl", () => {
  it("is CUSTODIAN_URL", () => {
    expect(custodianUrl({ CUSTODIAN_URL: "http://127.0.0.1:8000" })).toBe("http://127.0.0.1:8000");
  });

  it("drops a trailing slash, since every path starts with one", () => {
    expect(custodianUrl({ CUSTODIAN_URL: "https://custodian.test/" })).toBe(
      "https://custodian.test",
    );
  });

  it("keeps a path prefix", () => {
    expect(custodianUrl({ CUSTODIAN_URL: "https://example.test/custodian/" })).toBe(
      "https://example.test/custodian",
    );
  });

  it.each([undefined, ""])("refuses to guess when CUSTODIAN_URL is %j", (value) => {
    expect(() => custodianUrl({ CUSTODIAN_URL: value })).toThrow("CUSTODIAN_URL must be set");
  });

  it.each(["custodian.test", "/custodian", "ftp://custodian.test"])(
    "rejects %j, which isn't an absolute http(s) URL",
    (value) => {
      expect(() => custodianUrl({ CUSTODIAN_URL: value })).toThrow(
        "CUSTODIAN_URL must be an absolute http or https URL",
      );
    },
  );

  it("reads process.env by default", () => {
    vi.stubEnv("CUSTODIAN_URL", "http://custodian.test");

    expect(custodianUrl()).toBe("http://custodian.test");
  });
});
