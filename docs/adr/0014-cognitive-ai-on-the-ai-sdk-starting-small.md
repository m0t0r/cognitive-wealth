# ADR 0014: Cognitive AI runs on the AI SDK, starting with the smallest model

- Status: accepted
- Date: 2026-10-23

Cognitive AI calls language models through the Vercel AI SDK, with Anthropic as the first provider, rather than through a vendor's own SDK. Its tools, the calculations behind Computed facts ([ADR 0010](0010-cognitive-ai-states-only-computed-facts.md)), are AI SDK tools, and the model is chosen in one place.

It starts on Claude Haiku 5.5, the cheapest current Claude model. A feature moves to Claude Sonnet 5.5 only when an evaluation shows Haiku falls short on it, and the evaluation decides, not a guess.

## Why

Cognitive Wealth has no funding and no revenue, so model spend comes out of pocket. The AI SDK keeps the provider swappable and is common in product-engineering work. Starting small makes cost a measured trade-off from day one.

## Considered options

- **Anthropic's TypeScript SDK directly.** One less layer, and first access to Claude-specific features such as citations and refusal fallbacks, but it ties Cognitive AI to one vendor.

## Consequences

- Tests and local runs without an API key use the AI SDK's mock model, so no test spends money and CI needs no key.
- Every call records its model, token usage and cost in its trace, so spend is visible per feature.
- Claude-specific features are used only through the AI SDK's provider options, and a feature that depends on one says so.
