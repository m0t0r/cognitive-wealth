import { createAuthRouteHandler } from "@repo/auth";
import { getAuth } from "@/lib/auth/server";

// Only the allowlisted Better Auth endpoints; everything else under /api/auth is a 404. The auth
// instance is built on the first allowlisted request, not at import.
export const { GET, POST } = createAuthRouteHandler(getAuth);
