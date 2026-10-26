// A scripted model for the unit tests: each call returns the next response (the last one again
// once they run out), so a test drives the AI SDK's real tool loop and output parsing without the
// network.
import { MockLanguageModelV4 } from "ai/test";

type Response = { text: string } | { toolCall: { name: string; input: Record<string, unknown> } };

type ScriptedModelArgs = {
  responses: [Response, ...Response[]];
  /** Tokens each call reports, for the cost tests. */
  usage?: { input: number; output: number };
};

type ScriptedModel = {
  model: MockLanguageModelV4;
  calls: () => MockLanguageModelV4["doGenerateCalls"];
};

export function scriptedModel({
  responses,
  usage = { input: 10, output: 10 },
}: ScriptedModelArgs): ScriptedModel {
  let call = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      const response = responses[Math.min(call, responses.length - 1)] ?? responses[0];
      call++;
      const usageReport = {
        inputTokens: {
          total: usage.input,
          noCache: usage.input,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: usage.output, text: usage.output, reasoning: undefined },
      };
      if ("text" in response) {
        return {
          content: [{ type: "text", text: response.text }],
          finishReason: { unified: "stop", raw: undefined },
          usage: usageReport,
          warnings: [],
        };
      }
      return {
        content: [
          {
            type: "tool-call",
            toolCallId: `call-${call}`,
            toolName: response.toolCall.name,
            input: JSON.stringify(response.toolCall.input),
          },
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage: usageReport,
        warnings: [],
      };
    },
  });
  return { model, calls: () => model.doGenerateCalls };
}
