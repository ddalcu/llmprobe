import { describe, expect, test } from "vitest";

import {
  expectNumber,
  expectWord,
  firstNumber,
  normalize,
  parseStrictJson,
  saysWord,
} from "./grading";

describe("normalize", () => {
  test("strips case and punctuation", () => {
    expect(normalize("  Tokyo.  ")).toBe("tokyo");
  });

  test("keeps unicode letters", () => {
    expect(normalize("Canberra!")).toBe("canberra");
  });
});

describe("saysWord", () => {
  test("tolerates a conversational preamble — we grade substance, not form", () => {
    expect(saysWord("The capital of France is Paris.", "paris")).toBe(true);
  });

  test("matches whole words only", () => {
    // "Parisian" is not "Paris" — a substring match would grade sloppily.
    expect(saysWord("A Parisian cafe", "paris")).toBe(false);
  });
});

describe("firstNumber", () => {
  test("finds the number inside a sentence", () => {
    expect(firstNumber("The answer is 408.")).toBe(408);
  });

  test("handles thousands separators", () => {
    expect(firstNumber("1,024 tokens")).toBe(1024);
  });

  test("returns null when there is no number", () => {
    expect(firstNumber("no digits here")).toBeNull();
  });
});

describe("expectWord / expectNumber", () => {
  test("passes on the right answer, however it's phrased", () => {
    expect(expectWord("It's Canberra.", "canberra", "capital").passed).toBe(
      true,
    );
    expect(expectNumber("408", 408, "product").passed).toBe(true);
    expect(expectNumber("The answer is 408.", 408, "product").passed).toBe(
      true,
    );
  });

  test("a model that restates the problem is graded on its answer, not its phrasing", () => {
    // "17 * 24 = 408" — taking the *first* number would grade this as 17 and
    // fail a correct answer for its formatting.
    expect(expectNumber("17 * 24 = 408", 408, "product").passed).toBe(true);
  });

  test("a wrong answer still fails, restated or not", () => {
    expect(expectNumber("17 * 24 = 407", 408, "product").passed).toBe(false);
  });

  test("fails with a message naming what was expected", () => {
    const graded = expectWord("Sydney", "canberra", "capital");
    expect(graded.passed).toBe(false);
    expect(graded.message).toContain("canberra");
  });
});

describe("parseStrictJson", () => {
  test("accepts raw JSON", () => {
    expect(parseStrictJson('{"name":"Ada","age":36}')).toMatchObject({
      ok: true,
    });
  });

  test("rejects fenced JSON — emitting fences when told not to IS the failure", () => {
    // A lenient parser that stripped the fence would hide exactly the model
    // behaviour this eval exists to measure.
    const result = parseStrictJson('```json\n{"name":"Ada"}\n```');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("code fence");
  });

  test("rejects JSON buried in prose", () => {
    expect(parseStrictJson('Here you go: {"name":"Ada"}').ok).toBe(false);
  });

  test("tolerates surrounding whitespace", () => {
    expect(parseStrictJson('\n  {"a":1}\n ').ok).toBe(true);
  });
});
