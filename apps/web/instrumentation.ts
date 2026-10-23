/**
 * Runs once when the server starts. Checks the auth and email settings then, so a misconfigured
 * deployment refuses to start instead of answering every sign-in with an error (ADR 0001,
 * "Environments"). `getAuth()` still builds the instance lazily, on the first request.
 */
export async function register() {
  // Not in the edge runtime (nothing there uses auth), and not while `next build` runs, which
  // needs no auth settings.
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build")
    return;
  const { authOptionsFromEnv, mailerFromEnv } = await import("@repo/auth/env");
  authOptionsFromEnv(process.env);
  mailerFromEnv(process.env);
}
