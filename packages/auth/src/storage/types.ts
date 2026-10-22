import type { BetterAuthOptions } from "better-auth";

/** Better Auth's secondary storage interface (`@better-auth/core`), which `better-auth` doesn't export. */
export type SecondaryStorage = NonNullable<BetterAuthOptions["secondaryStorage"]>;
