// What a tool loop has spent, from the token counts each step reports, so the fixer and triage can
// stop at a dollar cap (the AI SDK has no budget of its own), and the prompt-cache breakpoint that
// keeps each step's input cheap.
import type { LanguageModelUsage, ModelMessage, StepResult, ToolSet } from "ai";

/** US dollars per million tokens. */
export type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };

// Anthropic's list prices; a 5-minute cache write costs 1.25 times input.
export const SONNET_5_5: Price = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };
export const HAIKU_5_5: Price = { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 };
/** Haiku 5.5 on a request whose input passes 100K tokens. */
const HAIKU_5_5_LONG: Price = { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 };

/** Haiku 5.5's price for one request, which depends on how long its input is. */
export function haikuPrice(usage: LanguageModelUsage): Price {
  return (usage.inputTokens ?? 0) > 100_000 ? HAIKU_5_5_LONG : HAIKU_5_5;
}

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

/** What `steps` cost, each at the price `price` gives for its usage. */
export function spent({
  steps,
  price,
}: {
  steps: StepResult<ToolSet>[];
  price: (usage: LanguageModelUsage) => Price;
}): number {
  return steps.reduce(
    (total, step) => total + usageCost({ usage: step.usage, price: price(step.usage) }),
    0,
  );
}

/**
 * `messages` with one prompt-cache breakpoint, on the last message, so each step reads the
 * conversation so far from the cache. Earlier breakpoints are dropped: the API allows four.
 */
export function withCacheBreakpoint(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((message, index) => {
    const { cacheControl: _dropped, ...anthropicOptions } =
      message.providerOptions?.anthropic ?? {};
    const last = index === messages.length - 1;
    return {
      ...message,
      providerOptions: {
        ...message.providerOptions,
        anthropic: last
          ? { ...anthropicOptions, cacheControl: { type: "ephemeral" } }
          : anthropicOptions,
      },
    };
  });
}
