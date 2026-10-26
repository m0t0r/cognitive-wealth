// The AI SDK's errors as coded refusals (`ReportError`), so `cw friction …` tells "Credit balance is
// too low" or a missing key apart from a bug, and says whether a retry may help.
import { APICallError, LoadAPIKeyError, NoObjectGeneratedError, RetryError } from "ai";
import { ReportError } from "./reports.ts";

export function apiRefusal(error: unknown): unknown {
  // The SDK retries a retryable failure twice, then throws a RetryError holding the last one.
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  if (APICallError.isInstance(cause)) {
    return new ReportError({
      code: "anthropic_api_error",
      message: `The Anthropic API answered ${cause.statusCode ?? "nothing"}: ${cause.message}`,
      retryable: cause.isRetryable,
    });
  }
  if (LoadAPIKeyError.isInstance(cause)) {
    return new ReportError({ code: "no_api_key", message: "ANTHROPIC_API_KEY isn't set." });
  }
  if (NoObjectGeneratedError.isInstance(cause)) {
    return new ReportError({
      code: "invalid_answer",
      message: `The model's answer didn't match the schema: ${cause.message}`,
      retryable: true,
    });
  }
  return error;
}

/** `call`, with an AI SDK error thrown as its `apiRefusal`. */
export async function callingTheApi<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw apiRefusal(error);
  }
}
