import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEV_EMAIL_FROM, DEV_SMTP_URL, emailConfigFromEnv, mailerFromEnv } from "./env";

const FROM = "Cognitive Wealth <no-reply@example.test>";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function secretFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "email-env-"));
  tempDirs.push(dir);
  const file = join(dir, "resend_api_key");
  writeFileSync(file, contents);
  return file;
}

function stubEmailEnv(values: Record<string, string | undefined>): void {
  const names = [
    "NODE_ENV",
    "EMAIL_TRANSPORT",
    "EMAIL_FROM",
    "SMTP_URL",
    "RESEND_API_KEY",
    "RESEND_API_KEY_FILE",
  ];
  for (const name of names) vi.stubEnv(name, values[name]);
}

describe("emailConfigFromEnv outside production", () => {
  it("defaults to Mailpit on localhost with the dev sender", () => {
    stubEmailEnv({ NODE_ENV: "development" });

    expect(emailConfigFromEnv()).toEqual({
      transport: "smtp",
      url: DEV_SMTP_URL,
      from: DEV_EMAIL_FROM,
    });
    expect(DEV_SMTP_URL).toBe("smtp://localhost:1025");
    expect(DEV_EMAIL_FROM).toBe("Cognitive Wealth <no-reply@cognitive-wealth.localhost>");
  });

  it("treats blank variables as unset", () => {
    expect(emailConfigFromEnv({ EMAIL_TRANSPORT: " ", EMAIL_FROM: "", SMTP_URL: "" })).toEqual({
      transport: "smtp",
      url: DEV_SMTP_URL,
      from: DEV_EMAIL_FROM,
    });
  });

  it("uses SMTP_URL and EMAIL_FROM when set", () => {
    expect(
      emailConfigFromEnv({
        EMAIL_TRANSPORT: "smtp",
        EMAIL_FROM: FROM,
        SMTP_URL: "smtp://mailpit:1025",
      }),
    ).toEqual({ transport: "smtp", url: "smtp://mailpit:1025", from: FROM });
  });

  it("selects Resend with RESEND_API_KEY", () => {
    expect(emailConfigFromEnv({ EMAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_test" })).toEqual({
      transport: "resend",
      apiKey: "re_test",
      from: DEV_EMAIL_FROM,
    });
  });

  it("reads and trims RESEND_API_KEY_FILE", () => {
    const file = secretFile("re_from_file\n");

    expect(
      emailConfigFromEnv({
        EMAIL_TRANSPORT: "resend",
        EMAIL_FROM: FROM,
        RESEND_API_KEY_FILE: file,
      }),
    ).toEqual({ transport: "resend", apiKey: "re_from_file", from: FROM });
  });

  it("rejects Resend without a key, with both key sources, or with an empty key file", () => {
    expect(() => emailConfigFromEnv({ EMAIL_TRANSPORT: "resend" })).toThrow(
      "RESEND_API_KEY or RESEND_API_KEY_FILE must be set",
    );
    expect(() =>
      emailConfigFromEnv({
        EMAIL_TRANSPORT: "resend",
        RESEND_API_KEY: "re_test",
        RESEND_API_KEY_FILE: secretFile("re_other"),
      }),
    ).toThrow("Set only one of");
    expect(() =>
      emailConfigFromEnv({ EMAIL_TRANSPORT: "resend", RESEND_API_KEY_FILE: secretFile(" \n") }),
    ).toThrow("RESEND_API_KEY_FILE is empty");
  });

  it("does not leak the key file path's contents when it can't be read", () => {
    expect(() =>
      emailConfigFromEnv({
        EMAIL_TRANSPORT: "resend",
        RESEND_API_KEY_FILE: "/nonexistent/resend_api_key",
      }),
    ).toThrow("Could not read RESEND_API_KEY_FILE");
  });

  it("rejects an unknown transport", () => {
    expect(() => emailConfigFromEnv({ EMAIL_TRANSPORT: "sendgrid" })).toThrow(
      'EMAIL_TRANSPORT must be "smtp" or "resend"',
    );
  });
});

describe("emailConfigFromEnv in production", () => {
  it("requires EMAIL_TRANSPORT", () => {
    stubEmailEnv({ NODE_ENV: "production", EMAIL_FROM: FROM, SMTP_URL: "smtp://mail:25" });

    expect(() => emailConfigFromEnv()).toThrow("EMAIL_TRANSPORT and EMAIL_FROM must be set");
  });

  it("requires EMAIL_FROM", () => {
    stubEmailEnv({ NODE_ENV: "production", EMAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_x" });

    expect(() => emailConfigFromEnv()).toThrow("EMAIL_TRANSPORT and EMAIL_FROM must be set");
  });

  it("requires SMTP_URL for smtp instead of defaulting to localhost", () => {
    stubEmailEnv({ NODE_ENV: "production", EMAIL_TRANSPORT: "smtp", EMAIL_FROM: FROM });

    expect(() => emailConfigFromEnv()).toThrow("SMTP_URL must be set");
  });

  it("accepts a complete Resend configuration", () => {
    stubEmailEnv({
      NODE_ENV: "production",
      EMAIL_TRANSPORT: "resend",
      EMAIL_FROM: FROM,
      RESEND_API_KEY_FILE: secretFile("re_prod\n"),
    });

    expect(emailConfigFromEnv()).toEqual({ transport: "resend", apiKey: "re_prod", from: FROM });
  });
});

describe("mailerFromEnv", () => {
  it("throws on an incomplete production configuration", () => {
    stubEmailEnv({ NODE_ENV: "production" });

    expect(() => mailerFromEnv()).toThrow("EMAIL_TRANSPORT and EMAIL_FROM must be set");
  });

  it("builds a mailer for each transport", () => {
    const mailer = { send: expect.any(Function) };
    expect(mailerFromEnv({ EMAIL_TRANSPORT: "smtp" })).toEqual(mailer);
    expect(mailerFromEnv({ EMAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_test" })).toEqual(mailer);
  });
});
