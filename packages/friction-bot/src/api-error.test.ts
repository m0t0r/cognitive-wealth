import { APICallError, LoadAPIKeyError, RetryError } from "ai";
import { http, HttpResponse } from "msw";
import { z } from "zod";
import { apiRefusal, callingTheApi } from "./api-error.ts";
import { server } from "./testing/msw-setup.ts";
import { TRIAGE_MODEL, triage } from "./triage.ts";

describe("a triage the Anthropic API refuses", () => {
  it("fails as anthropic_api_error, not retryable, with the API's own message", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    const requests: { model: string; key: string | null }[] = [];
    server.use(
      http.post("https://api.anthropic.com/v1/messages", async ({ request }) => {
        const { model } = z.object({ model: z.string() }).parse(await request.json());
        requests.push({ model, key: request.headers.get("x-api-key") });
        // The API's error body, with the refusal the friction workflows hit (#218).
        return HttpResponse.json(
          {
            type: "error",
            error: {
              type: "invalid_request_error",
              message:
                "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
            },
          },
          { status: 400 },
        );
      }),
    );

    const input = { issue: "{}", open: "[]", closed: "[]", guide: "", claudeMd: "" };
    await expect(callingTheApi(() => triage(input))).rejects.toMatchObject({
      code: "anthropic_api_error",
      message: expect.stringContaining("400: Your credit balance is too low"),
      retryable: false,
    });
    // A 400 isn't retried: one request, with the model and the key.
    expect(requests).toEqual([{ model: TRIAGE_MODEL, key: "sk-ant-test" }]);
  });
});

const credit = new APICallError({
  message: "Your credit balance is too low to access the Anthropic API.",
  url: "https://api.anthropic.com/v1/messages",
  requestBodyValues: {},
  statusCode: 400,
  isRetryable: false,
});

describe("apiRefusal", () => {
  it("gives the API's refusal a code, its status and whether a retry may help", () => {
    expect(apiRefusal(credit)).toMatchObject({
      code: "anthropic_api_error",
      message:
        "The Anthropic API answered 400: Your credit balance is too low to access the Anthropic API.",
      retryable: false,
    });
  });

  it("looks inside the RetryError the SDK throws after its retries", () => {
    const overloaded = new APICallError({
      message: "Overloaded",
      url: "https://api.anthropic.com/v1/messages",
      requestBodyValues: {},
      statusCode: 529,
      isRetryable: true,
    });
    const retried = new RetryError({
      message: "Failed after 3 attempts",
      reason: "maxRetriesExceeded",
      errors: [overloaded, overloaded],
    });
    expect(apiRefusal(retried)).toMatchObject({ code: "anthropic_api_error", retryable: true });
  });

  it("says a missing key is no_api_key", () => {
    expect(apiRefusal(new LoadAPIKeyError({ message: "missing" }))).toMatchObject({
      code: "no_api_key",
    });
  });

  it("leaves any other error as it is, a bug", () => {
    const bug = new TypeError("x is undefined");
    expect(apiRefusal(bug)).toBe(bug);
  });
});
