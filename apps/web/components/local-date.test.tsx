import { render, screen } from "@repo/testing/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LocalDate } from "./local-date";

// 23:30 UTC on Oct 22 is already Oct 23 in Auckland.
const LATE_EVENING_UTC = "2026-10-22T23:30:00.000Z";

describe("LocalDate", () => {
  it("shows the date in the viewer's time zone, with the instant in dateTime", () => {
    vi.stubEnv("TZ", "Pacific/Auckland");
    render(<LocalDate date={LATE_EVENING_UTC} />);

    const time = screen.getByText(/2026/);
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("datetime", LATE_EVENING_UTC);
    expect(time).toHaveTextContent(
      new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
        new Date(LATE_EVENING_UTC),
      ),
    );
    expect(time).toHaveTextContent("23");
  });

  it("renders a fixed UTC date on the server, so hydration matches whatever the viewer's zone", () => {
    vi.stubEnv("TZ", "Pacific/Auckland");
    expect(renderToString(<LocalDate date={LATE_EVENING_UTC} />)).toBe(
      `<time dateTime="${LATE_EVENING_UTC}">Oct 22, 2026</time>`,
    );
  });
});
