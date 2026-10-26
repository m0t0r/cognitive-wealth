import { homedir } from "node:os";
import { join } from "node:path";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Whether `url` points at this machine: a loopback address, `localhost`, or a `*.localhost` name
 * (which browsers and portless resolve to loopback). Anything else could be a real deployment.
 */
export function isLocalHost(url: string | URL): boolean {
  let hostname: string;
  try {
    // URL lowercases the host and brackets IPv6; a trailing dot (`localhost.`) is the same host.
    hostname = new URL(url).hostname.replace(/\.$/, "");
  } catch {
    return false;
  }
  return LOOPBACK_HOSTS.has(hostname) || hostname.endsWith(".localhost");
}

/** Parses `value` and throws unless it is a local http(s) URL. */
export function localUrl(label: string, value: string): URL {
  if (!URL.canParse(value)) throw new Error(`${label} is not a URL: ${value}`);
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must be http(s): ${value}`);
  }
  if (!isLocalHost(url)) {
    throw new Error(
      `Refusing to sign in against ${label} ${url.origin}: only localhost, 127.0.0.1, ::1 and *.localhost are allowed`,
    );
  }
  return url;
}

/**
 * Where portless keeps its local CA: `$PORTLESS_STATE_DIR/ca.pem`, else `~/.portless/ca.pem`
 * (portless resolves the invoking user's home even when its proxy runs under sudo).
 */
export function portlessCaPath(
  stateDir: string | undefined = process.env.PORTLESS_STATE_DIR,
  home: string = homedir(),
): string {
  return join(stateDir || join(home, ".portless"), "ca.pem");
}
