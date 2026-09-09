import { describe, expect, test } from "vitest";

import { extractCode, gradeCode } from "./code";
import type { ReasoningCase } from "./types";

const tc: ReasoningCase = {
  source: "HumanEval",
  id: "HumanEval_0_add",
  domain: "javascript",
  title: "add",
  kind: "code",
  question: "//Add two numbers.\nfunction add(a, b){\n",
  entryPoint: "add",
  tests:
    "const assert = require('node:assert');\n\nfunction test() {\n  let candidate = add;\n  assert.deepEqual(candidate(1, 2), 3);\n  assert.deepEqual(candidate(-1, 1), 0);\n}\n\ntest();",
  answer: "tests pass",
};

describe("extractCode", () => {
  test("takes the fenced block that defines the entry point, not a usage example", () => {
    const text =
      "Here you go:\n```javascript\nfunction add(a, b) { return a + b; }\n```\nExample:\n```js\nconsole.log(add(1, 2));\n```";
    expect(extractCode(text, "add")).toEqual({
      code: "function add(a, b) { return a + b; }",
      anchored: true,
    });
  });

  test("falls back to the whole text when nothing is fenced", () => {
    expect(extractCode("function add(a, b) { return a + b; }", "add")).toEqual({
      code: "function add(a, b) { return a + b; }",
      anchored: false,
    });
  });
});

describe("gradeCode", () => {
  test("passes a correct fenced function", () => {
    const r = gradeCode(
      tc,
      "```js\nfunction add(a, b) {\n  return a + b;\n}\n```",
    );
    expect(r).toEqual({ passed: true, got: "pass", anchored: true });
  });

  test("accepts a body-only completion of the prompt", () => {
    const r = gradeCode(tc, "```js\n  return a + b;\n}\n```");
    expect(r.passed).toBe(true);
  });

  test("reports the failing assertion", () => {
    const r = gradeCode(tc, "```js\nfunction add(a, b) { return a - b; }\n```");
    expect(r.passed).toBe(false);
    expect(r.got).toMatch(/AssertionError/);
  });

  test("kills an infinite loop", () => {
    const r = gradeCode(
      tc,
      "```js\nfunction add(a, b) { while (true) {} }\n```",
    );
    expect(r.passed).toBe(false);
    expect(r.got).toMatch(/timed out/);
  });

  test("cannot reach process or require anything but assert", () => {
    const r = gradeCode(
      tc,
      "```js\nfunction add(a, b) { require('node:fs'); return a + b; }\n```",
    );
    expect(r.passed).toBe(false);
    expect(r.got).toMatch(/not available/);
    expect(
      gradeCode(tc, "```js\nfunction add(a, b) { process.exit(1); }\n```").got,
    ).toMatch(/process is not defined/);
  });
});
