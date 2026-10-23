import { createTransport } from "nodemailer";
import { createNodemailerMailer, createSmtpMailer } from "./smtp";

const FROM = "Cognitive Wealth <no-reply@example.test>";

describe("createNodemailerMailer", () => {
  it("builds the message from the sender and the email", async () => {
    const transporter = createTransport({ jsonTransport: true });
    const sendMail = vi.spyOn(transporter, "sendMail");
    const mailer = createNodemailerMailer(transporter, FROM);

    await mailer.send({
      to: "ada@example.test",
      subject: "Your Cognitive Wealth sign-in link",
      html: "<p>Sign in</p>",
      text: "Sign-in code: 123456",
      tags: { category: "sign_in" },
      idempotencyKey: "ignored-by-smtp",
    });

    expect(sendMail).toHaveBeenCalledWith({
      from: FROM,
      to: "ada@example.test",
      subject: "Your Cognitive Wealth sign-in link",
      html: "<p>Sign in</p>",
      text: "Sign-in code: 123456",
    });
    const info = await sendMail.mock.results[0]!.value;
    const sent = JSON.parse(info.message);
    expect(sent).toMatchObject({
      from: { address: "no-reply@example.test", name: "Cognitive Wealth" },
      to: [{ address: "ada@example.test", name: "" }],
      subject: "Your Cognitive Wealth sign-in link",
      html: "<p>Sign in</p>",
      text: "Sign-in code: 123456",
    });
  });

  it("rejects when the transport fails", async () => {
    const transporter = createTransport({ jsonTransport: true });
    vi.spyOn(transporter, "sendMail").mockRejectedValue(new Error("Connection refused"));

    await expect(
      createNodemailerMailer(transporter, FROM).send({
        to: "ada@example.test",
        subject: "s",
        html: "h",
        text: "t",
      }),
    ).rejects.toThrow("Connection refused");
  });
});

describe("createSmtpMailer", () => {
  it("creates a mailer from a connection URL without connecting", () => {
    expect(createSmtpMailer({ url: "smtp://localhost:1025", from: FROM })).toEqual({
      send: expect.any(Function),
    });
  });
});
