import { CliError } from "@repo/db/cli/cli-error";

export type Refusal = { code: string; message: string; retryable: boolean };

/**
 * What a command passes to incur's `c.error()` for `error`: a `CliError`'s own code, or a Node
 * error's (`ECONNREFUSED`, `ERR_MODULE_NOT_FOUND`), so an agent can branch on it. Anything else is
 * a bug and is rethrown, for incur to report as `UNKNOWN` with its message.
 */
export function refusal(error: unknown): Refusal {
  if (error instanceof CliError) {
    return { code: error.code, message: error.message, retryable: false };
  }
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return { code: error.code, message: error.message, retryable: false };
  }
  throw error;
}
