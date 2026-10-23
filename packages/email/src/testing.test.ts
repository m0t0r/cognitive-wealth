import { renderSignInEmail } from "./render";
import { createMemoryMailer } from "./testing";

describe("createMemoryMailer", () => {
  it("records each message in order", async () => {
    const mailer = createMemoryMailer();
    const email = await renderSignInEmail({
      url: "https://app.example.test/sign-in/confirm#token=t",
      code: "123456",
      expiresInMinutes: 5,
    });

    await mailer.send({ to: "a@example.test", ...email, tags: { category: "sign_in" } });
    await mailer.send({ to: "b@example.test", ...email });

    expect(mailer.messages.map((message) => message.to)).toEqual([
      "a@example.test",
      "b@example.test",
    ]);
    expect(mailer.messages[0]).toMatchObject({ subject: email.subject, text: email.text });
  });

  it("starts empty and keeps a copy of each message", async () => {
    const mailer = createMemoryMailer();
    const message = { to: "a@example.test", subject: "s", html: "h", text: "t" };
    expect(mailer.messages).toEqual([]);

    await mailer.send(message);
    message.subject = "changed";

    expect(mailer.messages[0]?.subject).toBe("s");
  });
});
