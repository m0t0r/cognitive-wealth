import { healthHealthGet } from "./index.ts";

/** Stands in for the custodian: answers every request with `body` as JSON, and records the URL. */
function stubCustodian(body: unknown): string[] {
  const requested: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL) => {
    requested.push(String(input));
    return Response.json(body);
  });
  return requested;
}

describe("the generated custodian client", () => {
  it("calls the custodian at CUSTODIAN_URL", async () => {
    vi.stubEnv("CUSTODIAN_URL", "http://custodian.test/");
    const requested = stubCustodian({ status: "ok" });

    const response = await healthHealthGet();

    expect(requested).toEqual(["http://custodian.test/health"]);
    expect(response.data).toEqual({ status: "ok" });
  });

  it("rejects a response the contract doesn't allow", async () => {
    // Nothing from the custodian is trusted: the Zod schema parses every response body.
    vi.stubEnv("CUSTODIAN_URL", "http://custodian.test");
    stubCustodian({ status: "degraded" });

    await expect(healthHealthGet()).rejects.toThrow();
  });

  it("sends nothing without CUSTODIAN_URL", async () => {
    vi.stubEnv("CUSTODIAN_URL", undefined);
    const requested = stubCustodian({ status: "ok" });

    await expect(healthHealthGet()).rejects.toThrow("CUSTODIAN_URL must be set");
    expect(requested).toEqual([]);
  });
});
