import { describe, expect, it, vi } from "vitest";
import { createResendMailer } from "./resend";

const API_KEY = "re_secret_test_key";
const FROM = "Cognitive Wealth <no-reply@example.test>";
const message = {
  to: "ada@example.test",
  subject: "Your Cognitive Wealth sign-in link",
  html: "<p>Hi</p>",
  text: "Hi",
};

function stubFetch(response: () => Response) {
  const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(response()));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function requestBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
  return JSON.parse(init.body);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createResendMailer", () => {
  it("posts the message with tags and the idempotency key", async () => {
    const fetch = stubFetch(() => json({ id: "email_1" }));
    const mailer = createResendMailer({ apiKey: API_KEY, from: FROM });

    await mailer.send({
      ...message,
      tags: { category: "sign_in" },
      idempotencyKey: "sign-in/ada@example.test/1",
    });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${API_KEY}`);
    expect(headers.get("idempotency-key")).toBe("sign-in/ada@example.test/1");
    expect(requestBody(init)).toEqual({
      from: FROM,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      tags: [{ name: "category", value: "sign_in" }],
    });
  });

  it("omits tags and generates an idempotency key when not given", async () => {
    const fetch = stubFetch(() => json({ id: "email_2" }));

    await createResendMailer({ apiKey: API_KEY, from: FROM }).send(message);

    const [, init] = fetch.mock.calls[0]!;
    expect(new Headers(init?.headers).get("idempotency-key")).toMatch(/^send\/[0-9a-f-]{36}$/);
    expect(requestBody(init)).not.toHaveProperty("tags");
  });

  it("retries transient failures with the same idempotency key", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const responses = [
      json({ name: "internal_server_error", statusCode: 500, message: "boom" }, 500),
      json({ name: "rate_limit_exceeded", statusCode: 429, message: "slow down" }, 429),
      json({ id: "email_3" }),
    ];
    const fetch = stubFetch(() => responses.shift()!);
    const mailer = createResendMailer({ apiKey: API_KEY, from: FROM, retryDelay: () => 0 });

    await mailer.send(message);

    expect(fetch).toHaveBeenCalledTimes(3);
    const keys = fetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get("idempotency-key"),
    );
    expect(new Set(keys).size).toBe(1);
  });

  it("does not retry client errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = stubFetch(() =>
      json({ name: "validation_error", statusCode: 422, message: "bad from" }, 422),
    );
    const mailer = createResendMailer({ apiKey: API_KEY, from: FROM, retryDelay: () => 0 });

    await expect(mailer.send(message)).rejects.toThrow("validation_error (HTTP 422)");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("gives up after the last attempt", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = stubFetch(() =>
      json({ name: "internal_server_error", statusCode: 503, message: "down" }, 503),
    );
    const mailer = createResendMailer({
      apiKey: API_KEY,
      from: FROM,
      maxAttempts: 2,
      retryDelay: () => 0,
    });

    await expect(mailer.send(message)).rejects.toThrow("(HTTP 503)");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("throws an Error without the API key when Resend rejects the email", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(() =>
      json(
        {
          name: "validation_error",
          statusCode: 422,
          message: `Invalid key ${API_KEY} for the from field`,
        },
        422,
      ),
    );
    const mailer = createResendMailer({ apiKey: API_KEY, from: FROM });

    const error: unknown = await mailer.send(message).catch((reason: unknown) => reason);

    if (!(error instanceof Error)) throw new Error("Expected send to reject with an Error");
    expect(error.message).toMatch(/^Resend rejected the email: validation_error \(HTTP 422\)/);
    expect(error.message).not.toContain(API_KEY);
  });

  it("throws when the request fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );

    const mailer = createResendMailer({ apiKey: API_KEY, from: FROM, retryDelay: () => 0 });
    await expect(mailer.send(message)).rejects.toThrow(
      "Resend rejected the email: application_error",
    );
  });

  it("refuses an empty API key", () => {
    expect(() => createResendMailer({ apiKey: " ", from: FROM })).toThrow("API key is empty");
  });
});
