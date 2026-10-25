import { join } from "node:path";
import type { NextConfig } from "next";
import {
  API_CONTENT_SECURITY_POLICY,
  NO_REFERRER_PATHS,
  staticSecurityHeaders,
} from "./lib/security-headers";

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (`node apps/web/server.js`).
  output: "standalone",
  // Trace from the monorepo root so workspace packages land in the standalone output.
  outputFileTracingRoot: join(import.meta.dirname, "../.."),
  poweredByHeader: false,
  transpilePackages: [
    "@repo/design-system",
    "@repo/db",
    "@repo/auth",
    "@repo/email",
    "@repo/households",
    // `@repo/db/schema` takes the Registration types from its generated Zod schemas.
    "@repo/custodian-client",
  ],
  // Page CSPs carry a per-request nonce, so `proxy.ts` sets those.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: staticSecurityHeaders({ hsts: process.env.NODE_ENV === "production" }),
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Content-Security-Policy", value: API_CONTENT_SECURITY_POLICY }],
      },
      // Sign-in and invitation URLs carry tokens or IDs worth keeping out of Referer. Later entries
      // win for the same key, so this overrides the default policy above.
      ...NO_REFERRER_PATHS.map((source) => ({
        source,
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      })),
    ];
  },
};

export default nextConfig;
