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

/** An ISO calendar date (`YYYY-MM-DD`), such as an As-of date, as "Mar 6, 2026" wherever it's read. */
export function formatIsoDate(isoDate: string): string {
  // Midnight UTC, shown in UTC: the date itself, never the day before in a zone west of UTC.
  return formatDate(new Date(`${isoDate}T00:00:00Z`), { locale: "en-US", timeZone: "UTC" });
}

// Amounts arrive as the Custodian's decimal strings (ADR 0013). `Intl.NumberFormat` formats a
// string as the exact decimal it spells, so no amount passes through a float on its way to the page.
const SHARES = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });
const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// A Postgres `numeric` as text: an optional minus, digits, and optional places.
const DECIMAL = /^-?\d+(?:\.\d+)?$/;

/** `value`, which must be a plain decimal: anything else (`NaN`, "1e3", "") is a bug upstream. */
function decimal(value: string): Intl.StringNumericLiteral {
  if (!isDecimal(value)) throw new TypeError(`Not a decimal: ${JSON.stringify(value)}`);
  return value;
}

function isDecimal(value: string): value is Intl.StringNumericLiteral {
  return DECIMAL.test(value);
}

/** Shares as "6,476.65", up to their six places, without trailing zeros. */
export function formatShares(shares: string): string {
  return SHARES.format(decimal(shares));
}

/** Money, whole cents, as "$3,006.00". */
export function formatMoney(amount: string): string {
  return MONEY.format(decimal(amount));
}

/** A price in dollars, at least to the cent and otherwise at the scale it was quoted at. */
export function formatPrice(price: string): string {
  const places = Math.max(2, price.split(".")[1]?.length ?? 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  }).format(decimal(price));
}
