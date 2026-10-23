# ADR 0010: Cognitive AI states only computed facts

- Status: accepted
- Date: 2026-10-23

Cognitive AI never does arithmetic. Every number it shows an Advisor (a balance, a tax cost, a projection, a rate) comes from a deterministic calculation over recorded data, called as a tool, and is cited back to that result. The model chooses which calculations to run, explains them, and drafts the words around them. Anything Cognitive AI produces that is kept (a recommendation, a summary, a scenario) stores the calculations it rests on, with their inputs, so it can be reproduced and audited later.

## Why

An advisor's numbers end up in front of clients and regulators, and a language model is good at fluent text and unreliable at arithmetic. AI demos in this space routinely contradict themselves: one marginal tax rate in one paragraph and another in the next, a chart labelled for a different scenario than the one run, two different totals for the same household. A rule that the model cannot produce a number on its own removes that whole class of error, and makes it testable: an evaluation checks every number in the output against the calculation it cites.

## Consequences

- Each kind of figure Cognitive AI can talk about needs a calculation it can call. A question it has no calculation for gets an answer without a figure, or a request for the missing input.
- Kept outputs carry the model, prompt version and calculation inputs they came from, and stay drafts until an Advisor approves them.
