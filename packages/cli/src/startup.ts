// What `cw` prints when it can't even load: a dependency missing from node_modules (a fast-forward
// that wasn't followed by `pnpm install`) fails an import before incur runs, so incur can't report
// it. It imports nothing, so it still loads then.

/**
 * With `--json` (or `--format json`), the error envelope incur prints for a failure, so a caller
 * that reads fields (the `teardown-worktree` hook) gets `code: ERR_MODULE_NOT_FOUND` either way.
 * Without it, undefined: the entry rethrows and Node prints the error for a person.
 */
export function startupFailure({
  error,
  argv,
}: {
  error: unknown;
  argv: string[];
}): string | undefined {
  const json =
    argv.includes("--json") ||
    argv.includes("--format=json") ||
    argv.some((arg, i) => arg === "--format" && argv[i + 1] === "json");
  if (!json) return undefined;
  const code =
    error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : "UNKNOWN";
  const message = error instanceof Error ? error.message : String(error);
  return JSON.stringify({ code, message, retryable: false });
}
