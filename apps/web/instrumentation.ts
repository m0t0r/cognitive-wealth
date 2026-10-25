/**
 * Runs once when the server starts. Checks the auth and email settings then, so a misconfigured
 * deployment refuses to start instead of answering every sign-in with an error (ADR 0008).
 * `getAuth()` still builds the instance lazily, on the first request.
 */
export async function register() {
  // Not in the edge runtime (nothing there uses auth). The check lives in its own file, imported
  // only inside this branch, so the edge bundle never sees its `process.exit` (an early return
  // still left it there, and every build warned "Ecmascript file had an error", #148).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkSettings } = await import("./instrumentation.node");
    await checkSettings();
  }
}
