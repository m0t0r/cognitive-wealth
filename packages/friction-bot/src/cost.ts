// What a run has spent, from the token counts each step reports, so the fixer can stop at a
// dollar cap (the AI SDK has no budget of its own).
import type { LanguageModelUsage } from "ai";

/** US dollars per million tokens. */
export type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };

// Anthropic's list prices; a 5-minute cache write costs 1.25 times input.
export const SONNET_5_5: Price = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };

export function usageCost({ usage, price }: { usage: LanguageModelUsage; price: Price }): number {
  const { noCacheTokens, cacheReadTokens = 0, cacheWriteTokens = 0 } = usage.inputTokenDetails;
  // Without the breakdown, count every input token at the full price.
  const uncached = noCacheTokens ?? usage.inputTokens ?? 0;
  return (
    (uncached * price.input +
      cacheReadTokens * price.cacheRead +
      cacheWriteTokens * price.cacheWrite +
      (usage.outputTokens ?? 0) * price.output) /
    1_000_000
  );
}
