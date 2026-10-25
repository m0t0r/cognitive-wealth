import { RuleTester } from "oxlint/plugins-dev";
import rule from "./max-inline-param-type-members.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

const tooMany = (members: number, max = 3) => ({
  message: `Inline parameter type has ${members} members (max ${max}); extract it to a named type.`,
});

tester.run("max-inline-param-type-members", rule, {
  valid: [
    {
      name: "a type literal with 3 members",
      code: "function f({ a, b, c }: { a: 1; b: 2; c: 3 }) {}",
    },
    {
      name: "an interface method with 5 members",
      code: "interface I { m(input: { a: 1; b: 2; c: 3; d: 4; e: 5 }): void }",
    },
    {
      name: "a type-literal method signature with 5 members",
      code: "type T = { m(input: { a: 1; b: 2; c: 3; d: 4; e: 5 }): void };",
    },
    {
      name: "a function type with 5 members",
      code: "type F = (input: { a: 1; b: 2; c: 3; d: 4; e: 5 }) => void;",
    },
    {
      name: "a named interface parameter",
      code: "interface Input { a: 1; b: 2; c: 3; d: 4; e: 5 }\nfunction f(input: Input) {}",
    },
    {
      name: "a literal nested in a union",
      code: "function f(input: { a: 1; b: 2; c: 3; d: 4 } | null) {}",
    },
    {
      name: "a literal in a generic argument",
      code: "function f(input: Partial<{ a: 1; b: 2; c: 3; d: 4 }>) {}",
    },
    {
      name: "a variable's type",
      code: "const x: { a: 1; b: 2; c: 3; d: 4 } = { a: 1, b: 2, c: 3, d: 4 };",
    },
    {
      name: "nested members don't count toward the outer type",
      code: "function f(input: { a: { x: 1; y: 2; z: 3 }; b: 2; c: 3 }) {}",
    },
    {
      name: "a nested literal isn't a parameter's annotation, whatever its size",
      code: "function f(input: { a: { w: 1; x: 2; y: 3; z: 4 } }) {}",
    },
  ],
  invalid: [
    {
      name: "a 4-member destructured parameter",
      code: "function f({ a, b, c, d }: { a: 1; b: 2; c: 3; d: 4 }) {}",
      errors: [tooMany(4)],
    },
    {
      name: "a 4-member plain parameter",
      code: "function f(input: { a: 1; b: 2; c: 3; d: 4 }) {}",
      errors: [tooMany(4)],
    },
    {
      name: "a parameter with a default value",
      code: "function f({ a }: { a?: 1; b?: 2; c?: 3; d?: 4 } = {}) {}",
      errors: [tooMany(4)],
    },
    {
      name: "a rest parameter",
      code: "function f(...rest: { a: 1; b: 2; c: 3; d: 4 }) {}",
      errors: [tooMany(4)],
    },
    {
      name: "each kind of member counts 1",
      code: "function f(input: { a: 1; b?: 2; [key: string]: unknown; m(): void; (): void }) {}",
      errors: [tooMany(5)],
    },
    {
      name: "an arrow function",
      code: "const f = (input: { a: 1; b: 2; c: 3; d: 4 }) => {};",
      errors: [tooMany(4)],
    },
    {
      name: "a function expression",
      code: "const f = function (input: { a: 1; b: 2; c: 3; d: 4 }) {};",
      errors: [tooMany(4)],
    },
    {
      name: "a class method",
      code: "class C { m(input: { a: 1; b: 2; c: 3; d: 4 }) {} }",
      errors: [tooMany(4)],
    },
    {
      name: "a constructor",
      code: "class C { constructor(input: { a: 1; b: 2; c: 3; d: 4 }) {} }",
      errors: [tooMany(4)],
    },
    {
      name: "a constructor parameter property",
      code: "class C { constructor(private input: { a: 1; b: 2; c: 3; d: 4 }) {} }",
      errors: [tooMany(4)],
    },
    {
      name: "a declare function",
      code: "declare function f(input: { a: 1; b: 2; c: 3; d: 4 }): void;",
      errors: [tooMany(4)],
    },
    {
      name: "a function overload signature",
      code: "function f(input: { a: 1; b: 2; c: 3; d: 4 }): void;\nfunction f(input: unknown) {}",
      errors: [tooMany(4)],
    },
    {
      name: "a class method overload signature",
      code: "class C {\n  m(input: { a: 1; b: 2; c: 3; d: 4 }): void;\n  m(input: unknown) {}\n}",
      errors: [tooMany(4)],
    },
    {
      name: "max: 1 flags 2 members",
      code: "function f(input: { a: 1; b: 2 }) {}",
      options: [{ max: 1 }],
      errors: [tooMany(2, 1)],
    },
  ],
});
