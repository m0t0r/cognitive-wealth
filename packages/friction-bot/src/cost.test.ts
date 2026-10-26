import type { LanguageModelUsage } from "ai";
import { SONNET_5_5, usageCost } from "./cost.ts";

function usage({
  noCache,
  cacheRead,
  cacheWrite,
  output,
}: Record<string, number | undefined>): LanguageModelUsage {
  return {
    inputTokens: (noCache ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0),
    inputTokenDetails: {
      noCacheTokens: noCache,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
    },
    outputTokens: output,
    outputTokenDetails: { textTokens: output, reasoningTokens: undefined },
    totalTokens: undefined,
  };
}

describe("usageCost", () => {
  it("prices each kind of token", () => {
    const cost = usageCost({
      usage: usage({
        noCache: 1_000_000,
        cacheRead: 1_000_000,
        cacheWrite: 1_000_000,
        output: 1_000_000,
      }),
      price: SONNET_5_5,
    });
    expect(cost).toBeCloseTo(2 + 0.2 + 2.5 + 10);
  });

  it("counts all input at full price without the breakdown", () => {
    const bare = { ...usage({ output: 0 }), inputTokens: 500_000 };
    bare.inputTokenDetails = {
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    };
    expect(usageCost({ usage: bare, price: SONNET_5_5 })).toBeCloseTo(1);
  });
});
