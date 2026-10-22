import { join } from "node:path";
import type { NextConfig } from "next";
import { API_CONTENT_SECURITY_POLICY, staticSecurityHeaders } from "./lib/security-headers";

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (`node apps/web/server.js`).
  output: "standalone",
  // Trace from the monorepo root so workspace packages land in the standalone output.
  outputFileTracingRoot: join(import.meta.dirname, "../.."),
  poweredByHeader: false,
  transpilePackages: ["@repo/design-system", "@repo/db"],
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
    ];
  },
};

export default nextConfig;
