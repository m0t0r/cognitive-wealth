import type { Page } from "@playwright/test";

export interface CapturedBody {
  url: string;
  contentType: string;
  body: string;
}

const CAPTURED_TYPES = /^(text\/html|text\/x-component|application\/json)/;

/**
 * Records the body of every HTML, RSC (`text/x-component`) and JSON response `page` receives
 * from here on. `page.on("response")` can't do this: Chromium keeps no body for a streamed
 * response (RSC) or for one whose page has navigated on (the verify fetch). So each response is
 * paused (CDP `Fetch`, response stage), read, and passed on unchanged: requests still go through
 * Chromium's own network stack, with its real `Sec-Fetch-*` headers and cookies.
 */
export async function captureResponseBodies(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const bodies: CapturedBody[] = [];
  const errors: string[] = [];
  const pending: Array<Promise<void>> = [];

  // The fields of CDP's `Fetch.requestPaused` this reads.
  async function capture(event: {
    requestId: string;
    request: { url: string };
    responseStatusCode?: number;
    responseHeaders?: Array<{ name: string; value: string }>;
  }) {
    const status = event.responseStatusCode ?? 0;
    const contentType =
      event.responseHeaders?.find((header) => header.name.toLowerCase() === "content-type")
        ?.value ?? "";
    // Redirects have no body.
    if ((status < 300 || status >= 400) && CAPTURED_TYPES.test(contentType)) {
      const { body, base64Encoded } = await cdp.send("Fetch.getResponseBody", {
        requestId: event.requestId,
      });
      bodies.push({
        url: event.request.url,
        contentType,
        body: base64Encoded ? Buffer.from(body, "base64").toString("utf8") : body,
      });
    }
    await cdp.send("Fetch.continueRequest", { requestId: event.requestId });
  }

  cdp.on("Fetch.requestPaused", (event) => {
    pending.push(
      capture(event).catch((error: unknown) => {
        errors.push(`${event.request.url}: ${String(error)}`);
      }),
    );
  });
  await cdp.send("Fetch.enable", {
    patterns: (["Document", "Fetch", "XHR"] as const).map((resourceType) => ({
      urlPattern: "*",
      resourceType,
      requestStage: "Response" as const,
    })),
  });

  return {
    /** Every body so far; throws if one couldn't be read, so nothing is skipped silently. */
    collect: async (): Promise<CapturedBody[]> => {
      await Promise.all(pending);
      if (errors.length > 0) throw new Error(`Unreadable responses:\n${errors.join("\n")}`);
      return bodies;
    },
  };
}
