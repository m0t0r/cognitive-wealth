import { describe, expect, it, onTestFinished } from "vitest";
import { startFakeMailpit } from "./fake-mailpit";
import { createMailpit, parseInvitationEmail, parseSignInEmail } from "./mailpit";

const SIGN_IN_TEXT = [
  "Sign in to Cognitive Wealth",
  "",
  "Sign-in link: https://cognitive-wealth.localhost/sign-in/confirm#token=tok_123&next=%2Finvite%2Fabc",
  "Sign-in code: 042317",
  "",
  "Didn't ask for this? Ignore this email.",
].join("\r\n");

async function fakeMailpit(options?: { auth?: string }) {
  const fake = await startFakeMailpit(options);
  onTestFinished(fake.close);
  return fake;
}

describe("parseSignInEmail", () => {
  it("reads the link, token, next path and code (CRLF line endings)", () => {
    expect(parseSignInEmail(SIGN_IN_TEXT)).toEqual({
      url: "https://cognitive-wealth.localhost/sign-in/confirm#token=tok_123&next=%2Finvite%2Fabc",
      token: "tok_123",
      next: "/invite/abc",
      code: "042317",
    });
  });

  it("defaults next to / when the link carries none", () => {
    const text =
      "Sign-in link: http://localhost:3000/sign-in/confirm#token=t\nSign-in code: 123456\n";
    expect(parseSignInEmail(text).next).toBe("/");
  });

  it("throws when the link line is missing", () => {
    expect(() => parseSignInEmail("Sign-in code: 123456")).toThrow(/no "Sign-in link: …" line/);
  });

  it("throws when the code line is missing", () => {
    expect(() =>
      parseSignInEmail("Sign-in link: http://localhost/sign-in/confirm#token=t&next=%2F"),
    ).toThrow(/no "Sign-in code: …" line/);
  });

  it("throws when the code is not 6 digits", () => {
    expect(() =>
      parseSignInEmail("Sign-in link: http://localhost/c#token=t\nSign-in code: 12345"),
    ).toThrow(/not 6 digits/);
  });

  it("throws when the link has no token", () => {
    expect(() =>
      parseSignInEmail(
        "Sign-in link: http://localhost/sign-in/confirm#next=%2F\nSign-in code: 123456",
      ),
    ).toThrow(/no #token/);
  });
});

describe("parseInvitationEmail", () => {
  it("reads the invitation link", () => {
    const text = "You're invited.\r\nInvitation link: http://localhost:3000/invite/0199-abc\r\n";
    expect(parseInvitationEmail(text)).toEqual({ url: "http://localhost:3000/invite/0199-abc" });
  });

  it("throws when the line is missing", () => {
    expect(() => parseInvitationEmail(SIGN_IN_TEXT)).toThrow(/no "Invitation link: …" line/);
  });
});

describe("createMailpit", () => {
  it("returns the newest message to exactly that recipient", async () => {
    const fake = await fakeMailpit();
    fake.deliver({ to: "ann@example.test", subject: "Old", text: "old" });
    fake.deliver({ to: "ann@example.test", subject: "New", text: "new", html: "<p>new</p>" });
    // Mailpit's `to:` search would also match this one.
    fake.deliver({ to: "joann@example.test", subject: "Other", text: "other" });

    const message = await createMailpit(fake.url).waitForMessage({ to: "Ann@Example.test" });

    expect(message).toMatchObject({
      subject: "New",
      text: "new",
      html: "<p>new</p>",
      to: ["ann@example.test"],
    });
    expect(message.date).toBeInstanceOf(Date);
  });

  it("skips excluded IDs and mail received before `after`", async () => {
    const fake = await fakeMailpit();
    const mailpit = createMailpit(fake.url);
    const to = "bo@example.test";
    fake.deliver({ to, subject: "Sign in", text: "early", created: new Date("2026-01-01") });
    const exclude = await mailpit.messageIds(to);

    await expect(mailpit.waitForMessage({ to, exclude, timeoutMs: 150 })).rejects.toThrow(
      /No email to bo@example.test/,
    );
    await expect(
      mailpit.waitForMessage({ to, after: new Date("2026-06-01"), timeoutMs: 150 }),
    ).rejects.toThrow(/after 2026-06-01/);

    fake.deliver({ to, subject: "Sign in", text: "later" });
    await expect(mailpit.waitForMessage({ to, exclude })).resolves.toMatchObject({ text: "later" });
  });

  it("filters by exact subject or a pattern", async () => {
    const fake = await fakeMailpit();
    const mailpit = createMailpit(fake.url);
    const to = "cal@example.test";
    fake.deliver({ to, subject: "You're invited to Acme", text: "invite" });
    fake.deliver({ to, subject: "Sign in to Cognitive Wealth", text: "sign-in" });

    await expect(mailpit.waitForMessage({ to, subject: /invited/ })).resolves.toMatchObject({
      text: "invite",
    });
    await expect(
      mailpit.waitForMessage({ to, subject: "Sign in", timeoutMs: 150 }),
    ).rejects.toThrow(/subject Sign in/);
  });

  it("waits for a message that arrives while polling", async () => {
    const fake = await fakeMailpit();
    setTimeout(() => fake.deliver({ to: "cy@example.test", subject: "Hi", text: "late" }), 250);

    await expect(
      createMailpit(fake.url).waitForMessage({ to: "cy@example.test", timeoutMs: 5_000 }),
    ).resolves.toMatchObject({ text: "late" });
  });

  it("times out with the recipient and filters in the error", async () => {
    const fake = await fakeMailpit();

    await expect(
      createMailpit(fake.url).waitForMessage({
        to: "dee@example.test",
        subject: "X",
        timeoutMs: 150,
      }),
    ).rejects.toThrow("No email to dee@example.test (subject X) arrived in Mailpit within 150ms");
  });

  it("sends credentials from the URL as Basic auth", async () => {
    const fake = await fakeMailpit({ auth: "cw:s3cret" });
    fake.deliver({ to: "eve@example.test", subject: "Hi", text: "authed" });
    const authed = new URL(fake.url);
    authed.username = "cw";
    authed.password = "s3cret";

    await expect(
      createMailpit(authed.toString()).waitForMessage({ to: "eve@example.test" }),
    ).resolves.toMatchObject({ text: "authed" });
    await expect(createMailpit(fake.url).messageIds("eve@example.test")).rejects.toThrow(/401/);
  });
});
