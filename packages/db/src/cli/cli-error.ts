/**
 * A problem with the operator's input, or a refusal, printed as is (no stack trace). `code` is
 * what an agent branches on (`cw`'s error output): `invalid_input` for a bare message, or the
 * refusal's own, such as `unknown_organization`. Apart from `organizations.ts`, so a CLI can import
 * it without loading the schema.
 */
export class CliError extends Error {
  override name = "CliError";
  readonly code: string;

  constructor(input: string | { code: string; message: string }) {
    const { code, message } =
      typeof input === "string" ? { code: "invalid_input", message: input } : input;
    super(message);
    this.code = code;
  }
}
