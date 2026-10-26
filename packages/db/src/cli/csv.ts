// CSV as RFC 4180 writes it (https://www.rfc-editor.org/rfc/rfc4180): fields separated by commas,
// lines ended by CRLF, and a field with a comma, a double quote or a line break wrapped in double
// quotes, its own quotes doubled. RFC 4180 has no null, so this follows Postgres's `COPY … csv`: a
// null is an empty field and an empty string is `""`.

const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

function csvField(value: string | null): string {
  if (value === null) return "";
  if (value === "" || NEEDS_QUOTES.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

/** One CSV line, CRLF included. */
export function csvRow(values: readonly (string | null)[]): string {
  return `${values.map(csvField).join(",")}\r\n`;
}
