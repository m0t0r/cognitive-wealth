import { join } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (`node apps/web/server.js`).
  output: "standalone",
  // Trace from the monorepo root so workspace packages land in the standalone output.
  outputFileTracingRoot: join(import.meta.dirname, "../.."),
  poweredByHeader: false,
  transpilePackages: ["@repo/design-system", "@repo/db"],
};

export default nextConfig;
