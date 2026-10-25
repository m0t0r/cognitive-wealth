import type { RuleTester } from "oxlint/plugins-dev";

// `oxlint/plugins-dev` exports neither `Rule` nor the AST types, so they're read off
// `RuleTester.run`, which takes a rule, and the rule's visitor, which takes nodes.
export type Rule = Parameters<RuleTester["run"]>[1];
type Visitor = ReturnType<NonNullable<Rule["create"]>>;
type Node = Parameters<NonNullable<Visitor["TSTypeLiteral"]>>[0]["parent"];

// Functions whose parameters count. Function types (`TSFunctionType`) and interface or type-literal
// method signatures (`TSMethodSignature`) are left out: they describe a function, not define one.
const FUNCTION_NODES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  // `declare function` and function overload signatures.
  "TSDeclareFunction",
  // Class method overloads and abstract methods.
  "TSEmptyBodyFunctionExpression",
]);

// The function a type annotation's owner is a parameter of, or undefined. Walks up from the
// parameter through a default value (`= {}`) and a constructor parameter property (`private x`).
function functionOf(param: Node): Node | undefined {
  let node = param;
  while (node.parent?.type === "AssignmentPattern" || node.parent?.type === "TSParameterProperty") {
    node = node.parent;
  }
  const fn = node.parent;
  if (!fn || !FUNCTION_NODES.has(fn.type) || !("params" in fn)) return undefined;
  return (fn.params as Node[]).includes(node) ? fn : undefined;
}

const rule: Rule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Limit the members of a parameter's inline object type, so a larger one gets a name.",
    },
    schema: [
      {
        type: "object",
        properties: { max: { type: "integer", minimum: 0 } },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const option = context.options[0];
    const max =
      option && typeof option === "object" && "max" in option && typeof option.max === "number"
        ? option.max
        : 3;
    return {
      TSTypeLiteral(literal) {
        const annotation = literal.parent;
        if (annotation.type !== "TSTypeAnnotation" || !functionOf(annotation.parent)) return;
        const members = literal.members.length;
        if (members <= max) return;
        context.report({
          node: literal,
          message: `Inline parameter type has ${members} members (max ${max}); extract it to a named type.`,
        });
      },
    };
  },
};

export default rule;
