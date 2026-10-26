import type { PublicInvitation } from "@repo/auth";
import { screen, setup } from "@repo/testing/react";
import { NoWorkspaceCard } from "./no-workspace-card";

vi.mock("@repo/auth/client", () => ({ signOut: vi.fn() }));

const EMAIL = "cy@example.com";
const INVITATION: PublicInvitation = {
  publicId: "0192f0c4-0000-7000-8000-000000000009",
  email: EMAIL,
  role: "member",
  status: "pending",
  expiresAt: new Date("2026-11-01"),
  organization: {
    publicId: "0192f0c4-0000-7000-8000-000000000003",
    name: "Initech",
    slug: "initech",
    logo: null,
  },
  inviter: { name: "Bill" },
};
const ACME = { name: "Acme" };
const GLOBEX = { name: "Globex" };
const INITECH = { name: "Initech" };

const body = () => screen.getByRole("heading", { level: 1 }).closest("[data-slot=card]")!;

describe("NoWorkspaceCard", () => {
  it("says a viewer's only Firm no longer uses Cognitive Wealth", async () => {
    const { container } = setup(
      <NoWorkspaceCard
        email={EMAIL}
        removedFrom={null}
        deactivatedFirms={[ACME]}
        invitations={[]}
      />,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Acme no longer uses Cognitive Wealth",
    );
    expect(body()).toHaveTextContent(
      `Its workspace is no longer available. To join another one, ask a workspace owner or admin to invite ${EMAIL}.`,
    );
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    await expect(container).toHaveNoA11yViolations();
  });

  it("names several Firms together", async () => {
    const { container } = setup(
      <NoWorkspaceCard
        email={EMAIL}
        removedFrom={null}
        deactivatedFirms={[ACME, GLOBEX]}
        invitations={[]}
      />,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Acme and Globex no longer use Cognitive Wealth",
    );
    expect(body()).toHaveTextContent(
      `Their workspaces are no longer available. To join another one, ask a workspace owner or admin to invite ${EMAIL}.`,
    );
    await expect(container).toHaveNoA11yViolations();
  });

  it.for([
    [[ACME], "Its workspace is no longer available. Open an invitation to join another one."],
    [
      [ACME, GLOBEX],
      "Their workspaces are no longer available. Open an invitation to join another one.",
    ],
  ] as const)("points to pending invitations (%#)", ([firms, text]) => {
    setup(
      <NoWorkspaceCard
        email={EMAIL}
        removedFrom={null}
        deactivatedFirms={[...firms]}
        invitations={[INVITATION]}
      />,
    );

    expect(body()).toHaveTextContent(text);
    expect(screen.getByRole("link", { name: "View invitation to Initech" })).toHaveAttribute(
      "href",
      `/invite/${INVITATION.publicId}`,
    );
  });

  it("says a viewer was removed from a Firm and how to join another", async () => {
    const { container } = setup(
      <NoWorkspaceCard email={EMAIL} removedFrom="Acme" deactivatedFirms={[]} invitations={[]} />,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "You're no longer a member of Acme",
    );
    expect(body()).toHaveTextContent(
      `To join another workspace, ask a workspace owner or admin to invite ${EMAIL}.`,
    );
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    await expect(container).toHaveNoA11yViolations();
  });

  it("points a removed viewer to their invitations", async () => {
    const { container } = setup(
      <NoWorkspaceCard
        email={EMAIL}
        removedFrom="Acme"
        deactivatedFirms={[]}
        invitations={[INVITATION]}
      />,
    );

    expect(body()).toHaveTextContent("Open an invitation to join another workspace.");
    expect(body()).not.toHaveTextContent(EMAIL);
    expect(screen.getByRole("link", { name: "View invitation to Initech" })).toBeInTheDocument();
    await expect(container).toHaveNoA11yViolations();
  });

  it.for([
    [
      [GLOBEX],
      `Globex also no longer uses Cognitive Wealth. To join another workspace, ask a workspace owner or admin to invite ${EMAIL}.`,
    ],
    [
      [GLOBEX, INITECH],
      `Globex and Initech also no longer use Cognitive Wealth. To join another workspace, ask a workspace owner or admin to invite ${EMAIL}.`,
    ],
  ] as const)("adds a removed viewer's Deactivated Firms (%#)", async ([firms, text]) => {
    const { container } = setup(
      <NoWorkspaceCard
        email={EMAIL}
        removedFrom="Acme"
        deactivatedFirms={[...firms]}
        invitations={[]}
      />,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "You're no longer a member of Acme",
    );
    expect(body()).toHaveTextContent(text);
    await expect(container).toHaveNoA11yViolations();
  });

  it("says a removed viewer's other Firm went, beside their invitations", () => {
    setup(
      <NoWorkspaceCard
        email={EMAIL}
        removedFrom="Acme"
        deactivatedFirms={[GLOBEX]}
        invitations={[INVITATION]}
      />,
    );

    expect(body()).toHaveTextContent(
      "Globex also no longer uses Cognitive Wealth. Open an invitation to join another workspace.",
    );
  });

  it("keeps today's text for a viewer who was never in a Firm", async () => {
    const { container } = setup(
      <NoWorkspaceCard email={EMAIL} removedFrom={null} deactivatedFirms={[]} invitations={[]} />,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "You're not in a workspace",
    );
    expect(body()).toHaveTextContent(
      `Cognitive Wealth is invite-only. Ask a workspace owner or admin to invite ${EMAIL}.`,
    );
    await expect(container).toHaveNoA11yViolations();
  });

  it("keeps today's invitation text for a viewer who was never in a Firm", () => {
    setup(
      <NoWorkspaceCard
        email={EMAIL}
        removedFrom={null}
        deactivatedFirms={[]}
        invitations={[INVITATION]}
      />,
    );
    expect(body()).toHaveTextContent("Open an invitation to join its workspace.");
  });
});
