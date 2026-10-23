/**
 * A calendar date like "Oct 22, 2026". Without options it uses the runtime's locale and time
 * zone: the viewer's in the browser. The server has no idea of either, so it passes fixed ones.
 */
export function formatDate(
  date: Date,
  { locale, timeZone }: { locale?: string; timeZone?: string } = {},
): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone }).format(date);
}
