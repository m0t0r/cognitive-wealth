import { describe, expect, it } from "vitest";
import { renderInvitationEmail, renderSignInEmail } from "./render";

const signInUrl = "https://app.example.test/sign-in/confirm#token=abc&next=%2Forgs";
const invitationUrl = "https://app.example.test/invitations/0192f5a4-7c1e";
const hostile = `<script>alert(1)</script> "&'`;

function textLines(text: string): string[] {
  return text.split("\n");
}

describe("renderSignInEmail", () => {
  const props = { url: signInUrl, code: "012345", expiresInMinutes: 5 };

  it("puts the link and the code on their own lines in the text", async () => {
    const { text } = await renderSignInEmail(props);

    expect(textLines(text)).toContain(`Sign-in link: ${signInUrl}`);
    expect(textLines(text)).toContain("Sign-in code: 012345");
    expect(textLines(text).filter((line) => line.startsWith("Sign-in link: "))).toHaveLength(1);
    expect(textLines(text).filter((line) => line.startsWith("Sign-in code: "))).toHaveLength(1);
  });

  it("states the expiry, single use and what to do if it wasn't requested", async () => {
    const { subject, text, html } = await renderSignInEmail(props);

    expect(subject).toBe("Your Cognitive Wealth sign-in link");
    for (const body of [text, html]) {
      expect(body).toContain("This link and code expire in 5 minutes and can be used once.");
      expect(body).toContain("you can safely ignore it");
    }
  });

  it("links the button to the URL and shows the code in the HTML", async () => {
    const { html } = await renderSignInEmail(props);

    expect(html).toContain('<html dir="ltr" lang="en">');
    expect(html).toContain(`href="${signInUrl.replace("&", "&amp;")}"`);
    expect(html).toContain(">012345</p>");
  });

  it("uses the singular for one minute", async () => {
    const { text } = await renderSignInEmail({ ...props, expiresInMinutes: 1 });

    expect(text).toContain("expire in 1 minute and");
  });

  it.each(["12345", "1234567", "12a456", " 123456"])("rejects the code %j", async (code) => {
    await expect(renderSignInEmail({ ...props, code })).rejects.toThrow("6 digits");
  });

  it.each(["javascript:alert(1)", "/sign-in/confirm", "https://app.example.test/a b"])(
    "rejects the URL %j",
    async (url) => {
      await expect(renderSignInEmail({ ...props, url })).rejects.toThrow(/Email link/);
    },
  );

  it("rejects a non-positive expiry", async () => {
    await expect(renderSignInEmail({ ...props, expiresInMinutes: 0 })).rejects.toThrow(
      "expiresInMinutes",
    );
  });
});

describe("renderInvitationEmail", () => {
  const props = {
    url: invitationUrl,
    organizationName: "Acme",
    inviterName: "Olivia Owner",
    role: "admin",
    expiresAt: new Date("2026-10-29T15:00:00.000Z"),
  };

  it("puts the link on its own line in the text", async () => {
    const { text } = await renderInvitationEmail(props);

    expect(textLines(text)).toContain(`Invitation link: ${invitationUrl}`);
    expect(textLines(text).filter((line) => line.startsWith("Invitation link: "))).toHaveLength(1);
  });

  it("names the organization, inviter, role and expiry", async () => {
    const { subject, text, html } = await renderInvitationEmail(props);

    expect(subject).toBe("You're invited to join Acme on Cognitive Wealth");
    expect(text).toContain("Olivia Owner has invited you to join Acme as an admin.");
    expect(text).toContain("This invitation expires on October 29, 2026 at 3:00 PM UTC.");
    expect(html).toContain("Olivia Owner has invited you to join Acme as an admin.");
    expect(html).toContain(`href="${invitationUrl}"`);
  });

  it("works without an inviter name", async () => {
    const { text } = await renderInvitationEmail({ ...props, inviterName: " " });

    expect(text).toContain("You've been invited to join Acme as an admin.");
  });

  it("escapes names in the HTML and keeps them literal in the text and subject", async () => {
    const { subject, text, html } = await renderInvitationEmail({
      ...props,
      organizationName: hostile,
      inviterName: hostile,
    });

    expect(html).not.toContain("<script>");
    expect(html).not.toContain(hostile);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &quot;&amp;&#x27;");
    expect(text).toContain(`${hostile} has invited you to join ${hostile} as an admin.`);
    expect(subject).toBe(`You're invited to join ${hostile} on Cognitive Wealth`);
  });

  it("keeps names from adding lines to the text or subject", async () => {
    const { subject, text } = await renderInvitationEmail({
      ...props,
      organizationName: "Acme\nInvitation link: https://evil.example.test",
      inviterName: "Eve\r\nSign-in code: 000000",
    });

    expect(subject).not.toMatch(/[\r\n]/);
    expect(textLines(text).filter((line) => line.startsWith("Invitation link: "))).toEqual([
      `Invitation link: ${invitationUrl}`,
    ]);
    expect(textLines(text).some((line) => line.startsWith("Sign-in code: "))).toBe(false);
  });

  it("rejects an invalid expiry date", async () => {
    await expect(renderInvitationEmail({ ...props, expiresAt: "soon" })).rejects.toThrow(
      "expiresAt",
    );
  });
});
