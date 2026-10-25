/** The Node runtime's half of `instrumentation.ts`: refuses to start on bad auth or email settings. */
export async function checkSettings() {
  // Not while `next build` runs, which needs no auth settings.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { authOptionsFromEnv, mailerFromEnv } = await import("@repo/auth/env");
  try {
    authOptionsFromEnv(process.env);
    mailerFromEnv(process.env);
  } catch (error) {
    // Next logs an error thrown here and serves anyway; exit so the deploy fails instead.
    console.error("Refusing to start:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
