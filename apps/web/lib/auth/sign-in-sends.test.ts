import { describe, expect, it } from "vitest";
import { nextSendAt, recordSend, type SendHistory } from "./sign-in-sends";

const MINUTE = 60_000;
const T0 = Date.UTC(2026, 9, 23, 12, 0);

/** The history after a request at each of `times`. */
function sentAt(...times: number[]): SendHistory | undefined {
  let history: SendHistory | undefined;
  for (const time of times) history = recordSend(history, time);
  return history;
}

describe("nextSendAt", () => {
  it("allows the first email and the next two", () => {
    expect(nextSendAt(undefined, T0)).toBeNull();
    expect(nextSendAt(sentAt(T0, T0 + MINUTE), T0 + 2 * MINUTE)).toBeNull();
  });

  it("waits for the end of the 10 minutes after 3 emails in them", () => {
    const history = sentAt(T0, T0 + MINUTE, T0 + 2 * MINUTE);
    expect(nextSendAt(history, T0 + 3 * MINUTE)).toBe(T0 + 10 * MINUTE);
    expect(nextSendAt(history, T0 + 10 * MINUTE)).toBeNull();
  });

  it("waits for the end of the hour after 6 emails in it, however they're spread", () => {
    const history = sentAt(
      T0,
      T0 + 1 * MINUTE,
      T0 + 2 * MINUTE,
      T0 + 10 * MINUTE,
      T0 + 11 * MINUTE,
      T0 + 12 * MINUTE,
    );
    // The 10 minutes that started at T0+10 end at T0+20, but the hour's 6 are spent until T0+60.
    expect(nextSendAt(history, T0 + 25 * MINUTE)).toBe(T0 + 60 * MINUTE);
    expect(nextSendAt(history, T0 + 60 * MINUTE)).toBeNull();
  });
});

describe("recordSend", () => {
  it("starts each window at its first request, like the server, and again once it ends", () => {
    expect(sentAt(T0, T0 + 5 * MINUTE)).toEqual({
      burst: { start: T0, count: 2 },
      hour: { start: T0, count: 2 },
    });
    expect(sentAt(T0, T0 + 10 * MINUTE)).toEqual({
      burst: { start: T0 + 10 * MINUTE, count: 1 },
      hour: { start: T0, count: 2 },
    });
  });
});
