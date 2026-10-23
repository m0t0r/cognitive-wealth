const DATE = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

/** A calendar date like "Oct 22, 2026", the same on the server and in the browser. */
export function formatDate(date: Date): string {
  return DATE.format(date);
}
