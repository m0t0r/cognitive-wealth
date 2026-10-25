import { formatIsoDate, formatMoney, formatPrice, formatShares } from "./format";

describe("formatShares", () => {
  it.each([
    ["300.000000", "300"],
    ["6476.650000", "6,476.65"],
    ["0.123456", "0.123456"],
    // More digits than a float holds: formatted from the string, never through a number.
    ["123456789012345678.000001", "123,456,789,012,345,678.000001"],
  ])("shows %s as %s", (shares, shown) => {
    expect(formatShares(shares)).toBe(shown);
  });
});

describe("formatPrice", () => {
  it.each([
    ["10.02", "$10.02"],
    ["1.00", "$1.00"],
    ["1", "$1.00"],
    // A price keeps the scale it was quoted at (ADR 0013).
    ["153.4025", "$153.4025"],
    ["1234.5", "$1,234.50"],
  ])("shows %s as %s", (price, shown) => {
    expect(formatPrice(price)).toBe(shown);
  });
});

describe("formatMoney", () => {
  it.each([
    ["3006.00", "$3,006.00"],
    ["6476.65", "$6,476.65"],
    ["-12.50", "-$12.50"],
    ["12345678901234567.89", "$12,345,678,901,234,567.89"],
  ])("shows %s as %s", (amount, shown) => {
    expect(formatMoney(amount)).toBe(shown);
  });
});

it.for(["", "abc", "1e3", "NaN", "1,000.00"])("refuses %j, which isn't a decimal", (value) => {
  expect(() => formatMoney(value)).toThrow(TypeError);
  expect(() => formatShares(value)).toThrow(TypeError);
  expect(() => formatPrice(value)).toThrow(TypeError);
});

describe("formatIsoDate", () => {
  it("shows the calendar date itself, whatever the time zone", () => {
    expect(formatIsoDate("2026-03-06")).toBe("Mar 6, 2026");
    expect(formatIsoDate("2026-01-01")).toBe("Jan 1, 2026");
  });
});
