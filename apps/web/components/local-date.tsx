"use client";

import { useSyncExternalStore } from "react";
import { formatDate } from "@/lib/format";

/** What the server renders, and so what hydration must render too. */
const SERVER_FORMAT = { locale: "en", timeZone: "UTC" } as const;

const noSubscription = () => () => {};

/**
 * A date in the viewer's own locale and time zone, inside `<time dateTime>`. The server can't
 * know either, so the server render and hydration both show it in UTC (no mismatch), and the
 * browser re-renders it right after; client-side navigations render the local date at once.
 * (Next's inline-script fix for the flash would need this page's CSP nonce on every date.)
 */
export function LocalDate({ date }: { date: string }) {
  const inBrowser = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const value = new Date(date);
  return <time dateTime={date}>{formatDate(value, inBrowser ? {} : SERVER_FORMAT)}</time>;
}
