import type { Locator, Page } from "@playwright/test";
import type { Database } from "@repo/db";
import { seedInvitation, seedOrganization, seedUser } from "./seed";

// Every page route; the a11y and security-header specs run against each. Add new routes here.

export interface Route {
  /** The route as test titles show it. */
  name: string;
  /** For a page that renders its real state only in the browser: what to wait for first. */
  ready?: (page: Page) => Locator;
}

export interface PublicRoute extends Route {
  url: string;
}

/** Pages anyone can open signed out. */
export const PUBLIC_ROUTES: PublicRoute[] = [
  { name: "/design-system", url: "/design-system" },
  { name: "/sign-in", url: "/sign-in" },
  {
    // With the fragment an emailed link carries (it never reaches the server), so the page shows
    // its "Continue" state rather than "open the link from your email".
    name: "/sign-in/confirm",
    url: "/sign-in/confirm#token=e2e-placeholder-token",
    ready: (page) => page.getByRole("button", { name: "Continue to Cognitive Wealth" }),
  },
];

export interface SignedInRoute extends Route {
  /**
   * Seeds what the page needs for `email`, the user the spec then signs in, and returns the URL
   * to open. The spec checks the page doesn't redirect elsewhere.
   */
  setUp: (db: Database, email: string) => Promise<string>;
}

/** Pages that need a session; specs sign in as the seeded user with the `signIn` fixture. */
export const SIGNED_IN_ROUTES: SignedInRoute[] = [
  {
    name: "/",
    async setUp(db, email) {
      const viewer = await seedUser(db, { email, name: "Ada Owner" });
      await seedOrganization(db, { name: "Acme", members: [{ user: viewer, role: "owner" }] });
      return "/";
    },
  },
  {
    // With another member and a pending invitation, so both tables and their actions render.
    name: "/settings/members",
    async setUp(db, email) {
      const viewer = await seedUser(db, { email, name: "Ada Owner" });
      const colleague = await seedUser(db, { email: `colleague-${email}`, name: "Cy Member" });
      const acme = await seedOrganization(db, {
        name: "Acme",
        members: [
          { user: viewer, role: "owner" },
          { user: colleague, role: "member" },
        ],
      });
      await seedInvitation(db, {
        organization: acme,
        email: `invitee-${email}`,
        role: "admin",
        inviter: viewer,
      });
      return "/settings/members";
    },
  },
  {
    // A member who hasn't set a name yet.
    name: "/welcome",
    async setUp(db, email) {
      const viewer = await seedUser(db, { email, name: "" });
      await seedOrganization(db, { name: "Acme", members: [{ user: viewer, role: "member" }] });
      return "/welcome";
    },
  },
  {
    // With an open invitation, so its list renders.
    name: "/no-workspace",
    async setUp(db, email) {
      await seedUser(db, { email, name: "Nia Nomad" });
      const owner = await seedUser(db, { email: `owner-${email}`, name: "Ada Owner" });
      const acme = await seedOrganization(db, {
        name: "Acme",
        members: [{ user: owner, role: "owner" }],
      });
      await seedInvitation(db, { organization: acme, email, role: "member", inviter: owner });
      return "/no-workspace";
    },
  },
  {
    name: "/invite/[publicId]",
    async setUp(db, email) {
      const invitee = await seedUser(db, { email, name: "Ivy Invitee" });
      const owner = await seedUser(db, { email: `owner-${email}`, name: "Ada Owner" });
      const acme = await seedOrganization(db, {
        name: "Acme",
        members: [{ user: owner, role: "owner" }],
      });
      const { publicId } = await seedInvitation(db, {
        organization: acme,
        email: invitee.email,
        role: "member",
        inviter: owner,
      });
      return `/invite/${publicId}`;
    },
  },
];
