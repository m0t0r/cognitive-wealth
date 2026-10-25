import { eq, inArray } from "drizzle-orm";
import type { Database } from "../index.ts";
import { member, organization, user } from "../schema/index.ts";

// `Role` from `@repo/auth/access`, copied: `@repo/auth` depends on `@repo/db`, so this package
// can't import it.
type Role = "owner" | "admin" | "member";

/** The slug of the Firm the world file's CRM half belongs to (`crm.firm` in `world/v0.json`). */
export const WORLD_FIRM_SLUG = "larkspur";

/**
 * The dev Firms (docs/dev-sign-in.md): the world's Firm, and a second, small Firm that exists to
 * show one Firm can't see another's data (docs/product.md, "The synthetic world").
 */
export const SEED_ORGANIZATIONS = [
  { name: "Larkspur Wealth Partners", slug: WORLD_FIRM_SLUG },
  { name: "Globex", slug: "globex" },
] as const;

type SeedSlug = (typeof SEED_ORGANIZATIONS)[number]["slug"];

/** The slug the world's Firm had before it was Larkspur. */
const OLD_WORLD_FIRM_SLUG = "acme";

/**
 * The dev users and their roles, by Firm slug. `owner@` is the Advisor who owns the world's Firm;
 * docs/dev-sign-in.md says why the other two exist.
 */
export const SEED_USERS: readonly {
  email: string;
  name: string;
  roles: Partial<Record<SeedSlug, Role>>;
}[] = [
  {
    email: "owner@cognitive-wealth.test",
    name: "Olivia Owner",
    roles: { larkspur: "owner", globex: "owner" },
  },
  { email: "admin@cognitive-wealth.test", name: "Adam Admin", roles: { larkspur: "admin" } },
  { email: "member@cognitive-wealth.test", name: "Mia Member", roles: { larkspur: "member" } },
];

export interface SeedResult {
  /** Rows this run inserted; rows that already existed are left as they are. */
  added: { users: number; organizations: number; memberships: number };
  /** Firms this run renamed: the old seeded Acme, turned into Larkspur. */
  renamed: { organizations: number };
}

/**
 * Inserts the dev users, Firms and memberships that are missing, in one transaction. Idempotent:
 * rows are keyed on email, slug and (organization, user), and existing ones are left untouched.
 * Writes with Drizzle directly, so Better Auth's sign-up hooks never run.
 *
 * The one exception: a database seeded when the world's Firm was Acme gets that row renamed to
 * Larkspur, unless Larkspur already exists. Its members, invitations, audit events and sessions
 * stay with it, so the app keeps opening the same Firm instead of an empty leftover Acme.
 */
export async function seedDevData(db: Database): Promise<SeedResult> {
  return db.transaction(async (tx) => {
    const [worldFirm] = await tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.slug, WORLD_FIRM_SLUG));
    const renamed = worldFirm
      ? []
      : await tx
          .update(organization)
          .set(SEED_ORGANIZATIONS[0])
          .where(eq(organization.slug, OLD_WORLD_FIRM_SLUG))
          .returning({ id: organization.id });

    const users = await tx
      .insert(user)
      .values(SEED_USERS.map(({ email, name }) => ({ email, name, emailVerified: true })))
      .onConflictDoNothing({ target: user.email })
      .returning({ id: user.id });
    const organizations = await tx
      .insert(organization)
      .values([...SEED_ORGANIZATIONS])
      .onConflictDoNothing({ target: organization.slug })
      .returning({ id: organization.id });

    const userIds = new Map(
      (
        await tx
          .select({ id: user.id, email: user.email })
          .from(user)
          .where(
            inArray(
              user.email,
              SEED_USERS.map((u) => u.email),
            ),
          )
      ).map((row) => [row.email, row.id]),
    );
    const organizationIds = new Map(
      (
        await tx
          .select({ id: organization.id, slug: organization.slug })
          .from(organization)
          .where(
            inArray(
              organization.slug,
              SEED_ORGANIZATIONS.map((o) => o.slug),
            ),
          )
      ).map((row) => [row.slug, row.id]),
    );

    // The world's Firm's memberships go in last. A first sign-in opens the user's newest membership
    // (`initialOrganizationId` in @repo/auth), and rows inserted together tie on `createdAt`, so
    // the higher id wins: this way `owner@` starts in Larkspur, where the world's data is (#147).
    const memberships = await tx
      .insert(member)
      .values(
        SEED_USERS.flatMap(({ email, roles }) =>
          Object.entries(roles).map(([slug, role]) => ({ email, slug, role })),
        )
          .toSorted(
            (a, b) => Number(a.slug === WORLD_FIRM_SLUG) - Number(b.slug === WORLD_FIRM_SLUG),
          )
          .map(({ email, slug, role }) => ({
            organizationId: organizationIds.get(slug)!,
            userId: userIds.get(email)!,
            role,
          })),
      )
      .onConflictDoNothing({ target: [member.organizationId, member.userId] })
      .returning({ id: member.id });

    return {
      added: {
        users: users.length,
        organizations: organizations.length,
        memberships: memberships.length,
      },
      renamed: { organizations: renamed.length },
    };
  });
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const LOCALHOST_SUBDOMAIN = /^(?:[a-z0-9-]+\.)+localhost$/;

const refuse = (reason: string) => new Error(`Refusing to seed: ${reason}`);

/**
 * Throws unless seeding `databaseUrl` is safe: `NODE_ENV` isn't `production`, and the host is
 * loopback (`localhost`, `127.0.0.1`, `::1`) or a `*.localhost` name. The message names the reason.
 */
export function assertSeedTarget(databaseUrl: string | undefined, nodeEnv: string | undefined) {
  if (nodeEnv === "production") {
    throw refuse("NODE_ENV is production. The seed is for local development databases only.");
  }
  if (!databaseUrl) throw refuse("DATABASE_URL is not set.");
  if (!URL.canParse(databaseUrl)) throw refuse("DATABASE_URL is not a valid URL.");
  // Check the host the way WHATWG URL reads it and the way postgres.js does: postgres.js takes
  // everything after the *first* `@` (URL takes the last), percent-decodes it, and connects to
  // every host in a comma-separated list. `postgres://u@db.example.com,x@localhost/db` looks
  // local to URL but connects to db.example.com. Every host either reads must be local.
  let hosts: string[];
  try {
    hosts = [new URL(databaseUrl).hostname, ...postgresJsHosts(databaseUrl)].map((host) =>
      decodeURIComponent(host)
        .toLowerCase()
        .replace(/^\[(.*)\]$/, "$1")
        .replace(/\.$/, ""),
    );
  } catch {
    throw refuse("DATABASE_URL has a malformed host.");
  }
  // Postgres URLs aren't a WHATWG special scheme, so `hostname` keeps its case and IPv6 brackets.
  const remote = hosts.find((host) => !LOOPBACK_HOSTS.has(host) && !LOCALHOST_SUBDOMAIN.test(host));
  if (remote !== undefined) {
    throw refuse(
      `the DATABASE_URL host "${remote || "(none)"}" isn't local. Only localhost, 127.0.0.1, ::1 and *.localhost are allowed.`,
    );
  }
}

/** The hosts postgres.js (`parseUrl`, then `parseOptions`) connects to for `url`. */
function postgresJsHosts(url: string): string[] {
  const authority = url.slice(url.indexOf("://") + 3).split(/[?/]/)[0] ?? "";
  const hostList = decodeURIComponent(authority.slice(authority.indexOf("@") + 1));
  return hostList
    .split(",")
    .map((entry) =>
      entry.startsWith("[") ? entry.slice(0, entry.indexOf("]") + 1) : (entry.split(":")[0] ?? ""),
    );
}
