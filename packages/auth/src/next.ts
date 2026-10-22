// For `apps/web` only: Better Auth's Next.js cookie plugin pulls in `next/headers`, so it stays out
// of the package's main entry point. Pass it last in `createAuth({ plugins: [nextCookies()] })`.
export { nextCookies } from "better-auth/next-js";
