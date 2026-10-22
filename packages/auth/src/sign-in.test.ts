import { setImmediate as nextTurn } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { runInBackground } from "./sign-in";

/** Lets `setImmediate` callbacks and the microtasks after them run. */
const afterNextTurn = async () => {
  await nextTurn();
  await nextTurn();
};

describe("runInBackground", () => {
  it("returns before the task starts", async () => {
    let started = false;
    runInBackground(async () => {
      started = true;
    });
    expect(started).toBe(false);
    await afterNextTurn();
    expect(started).toBe(true);
  });

  it("logs a rejection instead of letting it escape", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    runInBackground(() => Promise.reject(new Error("boom")));
    await afterNextTurn();
    expect(error).toHaveBeenCalledWith("Background task failed", expect.any(Error));
  });

  it("never throws into the caller, even for a task that throws synchronously", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      runInBackground(() => {
        throw new Error("sync");
      }),
    ).not.toThrow();
    await afterNextTurn();
    expect(error).toHaveBeenCalledWith("Background task failed", expect.any(Error));
  });
});
