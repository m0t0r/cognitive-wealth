export type CustodianEnv = Record<string, string | undefined>;

/**
 * Where the custodian is: `CUSTODIAN_URL`, an absolute http or https URL such as
 * `http://127.0.0.1:8000`, with any trailing slash dropped. The generated client calls this
 * for every request (orval.config.ts), so a missing or malformed value fails before anything
 * is sent. There's no default: under portless the custodian is at an https `.localhost`
 * address whose local CA Node doesn't trust, so a guess would fail in a more confusing way.
 */
export function custodianUrl(env: CustodianEnv = process.env): string {
  const value = env.CUSTODIAN_URL;
  if (value === undefined || value === "") throw new Error("CUSTODIAN_URL must be set");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("CUSTODIAN_URL must be an absolute http or https URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("CUSTODIAN_URL must be an absolute http or https URL");
  }
  return value.replace(/\/+$/, "");
}
