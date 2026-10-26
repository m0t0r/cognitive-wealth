/**
 * `value` quoted for a POSIX shell when it needs it. incur writes a CTA's option values as they
 * are, so `--reason Contract ended` would run with the reason `Contract`.
 */
export function shellQuoted(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}
