import { within } from "@repo/testing/react";
import { render } from "@react-email/render";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { InvitationEmail } from "./invitation";
import { SignInEmail } from "./sign-in";

// An email isn't a page: it has no `<main>` landmark, and clients drop such elements anyway.
const EMAIL_AXE_OPTIONS = { rules: { "landmark-one-main": { enabled: false } } };

/** Renders the email to its final HTML and loads it as the test document. */
async function renderEmail(email: ReactElement): Promise<HTMLElement> {
  const html = await render(email);
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const root = document.adoptNode(parsed.documentElement);
  // Remove, then append: happy-dom's `replaceChild` inserts first and refuses a second root.
  document.documentElement.remove();
  document.append(root);
  return document.documentElement;
}

describe("SignInEmail", () => {
  it("is accessible and shows the button, code, expiry and ignore notice", async () => {
    const root = await renderEmail(<SignInEmail {...SignInEmail.PreviewProps} />);
    const body = within(document.body);

    await expect(root).toHaveNoA11yViolations(EMAIL_AXE_OPTIONS);
    expect(root).toHaveAttribute("lang", "en");
    expect(document.title).toBe("Your Cognitive Wealth sign-in link");
    expect(
      body.getByRole("heading", { level: 1, name: "Sign in to Cognitive Wealth" }),
    ).toBeVisible();
    expect(body.getByRole("link", { name: "Sign in to Cognitive Wealth" })).toHaveAttribute(
      "href",
      SignInEmail.PreviewProps.url,
    );
    expect(body.getByText(SignInEmail.PreviewProps.code)).toBeInTheDocument();
    expect(
      body.getByText("This link and code expire in 5 minutes and can be used once."),
    ).toBeInTheDocument();
    expect(
      body.getByText("If you didn't request this email, you can safely ignore it."),
    ).toBeInTheDocument();
  });
});

describe("InvitationEmail", () => {
  it("is accessible and shows the organization, inviter, role and accept button", async () => {
    const root = await renderEmail(<InvitationEmail {...InvitationEmail.PreviewProps} />);
    const body = within(document.body);

    await expect(root).toHaveNoA11yViolations(EMAIL_AXE_OPTIONS);
    expect(root).toHaveAttribute("lang", "en");
    expect(
      body.getByRole("heading", { level: 1, name: "Join Acme on Cognitive Wealth" }),
    ).toBeVisible();
    // The hidden inbox preview repeats this sentence; the visible copy is the paragraph.
    expect(
      body
        .getAllByText("Olivia Owner has invited you to join Acme as a member.")
        .filter((element) => element.tagName === "P"),
    ).toHaveLength(1);
    expect(body.getByRole("link", { name: "Accept invitation" })).toHaveAttribute(
      "href",
      InvitationEmail.PreviewProps.url,
    );
    expect(
      body.getByText("This invitation expires on October 29, 2026 at 3:00 PM UTC."),
    ).toBeInTheDocument();
  });
});
