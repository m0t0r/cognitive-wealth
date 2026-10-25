// Oxlint JS plugin `repo`, loaded by the root `.oxlintrc.json` straight from this TypeScript
// source (Node strips the types), so it has no build step.
import maxInlineParamTypeMembers, { type Rule } from "./max-inline-param-type-members.ts";

const plugin: { meta: { name: string }; rules: Record<string, Rule> } = {
  meta: { name: "repo" },
  rules: { "max-inline-param-type-members": maxInlineParamTypeMembers },
};

export default plugin;
