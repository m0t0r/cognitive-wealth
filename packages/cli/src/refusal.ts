import { CliError } from "@repo/db/cli/cli-error";

export type Refusal = { code: string; message: string; retryable: boolean };

/**
 * What a command passes to incur's `c.error()` for `error`: a `CliError`'s own code, or another
 * error's (a Node one's `ECONNREFUSED` or `ERR_MODULE_NOT_FOUND`, `@repo/friction-bot`'s
 * `ReportError`), so an agent can branch on it, with the error's own `retryable` if it has one.
 * Anything else is a bug and is rethrown, for incur to report as `UNKNOWN` with its message.
 */
export function refusal(error: unknown): Refusal {
  if (error instanceof CliError) {
    return { code: error.code, message: error.message, retryable: false };
  }
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    const retryable = "retryable" in error && error.retryable === true;
    return { code: error.code, message: error.message, retryable };
  }
  throw error;
}
