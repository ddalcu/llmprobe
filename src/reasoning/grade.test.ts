import { describe, expect, test } from "vitest";
import { extractAnswer, extractAnswerDetailed, answerMatches } from "./grade";
import type { ReasoningCase } from "./types";

const mc = (answer: string, n = 10): ReasoningCase => ({
  source: "SuperGPQA",
  id: "t",
  domain: "",
  title: "",
  question: "",
  choices: "ABCDEFGHIJ".slice(0, n).split(""),
  answer,
});
const int = (answer: string): ReasoningCase => ({
  source: "AIME2025",
  id: "t",
  domain: "",
  title: "",
  question: "",
  answer,
});
const cs = (answer: string): ReasoningCase => ({
  source: "COMPSEC",
  id: "t",
  domain: "",
  title: "",
  question: "",
  answer,
});

const open = (
  kind: "rational" | "sequence" | "text",
  answer: string,
  aliases?: string[],
): ReasoningCase => ({
  source: "OlympiadBench",
  id: "t",
  domain: "",
  title: "",
  question: "",
  answer,
  kind,
  ...(aliases ? { aliases } : {}),
});

// Ported from ds4-eval's extractor self-tests.
const cases: Array<[string, ReasoningCase, string, string]> = [
  [
    "MC prefers final answer marker",
    mc("F"),
    "</think>So answer is 0.716 H+/O2. That corresponds to option F.\nThus final answer: F.</think>The visible explanation repeats the calculation.\nAnswer: F",
    "F",
  ],
  [
    "MC prefers Answer-colon over later prose",
    mc("F"),
    "</think>Answer: F\nThis answer is final; option H is a tempting distractor.",
    "F",
  ],
  [
    "MC loose-answer fallback",
    mc("F"),
    "</think>The answer is F. This answer is final; option H is tempting.",
    "F",
  ],
  ["MC bold marker", mc("C"), "**Answer:** C", "C"],
  [
    "integer prefers marker",
    int("82"),
    "</think>I first thought the answer was 80.\nFinal answer: 082",
    "82",
  ],
  [
    "integer loose fallback",
    int("82"),
    "</think>The answer is 082. This answer comes from AIME 2025.",
    "82",
  ],
  [
    "integer sum line grades total",
    int("293"),
    "</think>Answer: m+n = 256+37 = 293",
    "293",
  ],
  [
    "integer ignores digits on later lines",
    int("293"),
    "Answer: 293\nSee 2025 problem 4.",
    "293",
  ],
  [
    "COMPSEC prefers final marker",
    cs("9-10"),
    "</think>I think the answer should be line 10, because CWE-122 may apply.\n**Answer:** 10</think>The primary write is at line 10.\nAnswer: 10",
    "10",
  ],
  ["COMPSEC range and list", cs("3,13-15"), "Answer: 3, 14-15", "3,14-15"],
  [
    "MC pronoun I does not shadow",
    mc("C"),
    "</think>Answer: I think it is C",
    "C",
  ],
  [
    "MC contraction I'll does not shadow",
    mc("C"),
    "</think>Answer: I'll go with C.",
    "C",
  ],
  [
    "MC article A does not shadow",
    mc("C"),
    "</think>Answer: A careful reading shows C.",
    "C",
  ],
  ["MC standalone I is picked", mc("I"), "</think>Answer: I.", "I"],
  [
    "MC out-of-range pronoun harmless",
    mc("D", 4),
    "</think>Answer: I think it is D",
    "D",
  ],
  [
    "MC 'not B' before pick",
    mc("D"),
    "</think>Answer: It is not B, the answer is D",
    "D",
  ],
  [
    "MC 'rules out C, leaving D'",
    mc("D"),
    "</think>Answer: rules out C, leaving D",
    "D",
  ],
  ["MC isn't B before pick", mc("D"), "</think>Answer: It isn't B, so D", "D"],
  ["MC pick then 'not B'", mc("D"), "</think>Answer: D, not B", "D"],
];

describe("reasoning grader", () => {
  test.each(cases)("%s", (_name, tc, generated, expected) => {
    const got = extractAnswer(tc, generated);
    expect(got).toBe(expected);
    expect(answerMatches(tc, got)).toBe(true);
  });

  test("COMPSEC rejects a line outside the accepted set", () => {
    expect(answerMatches(cs("9-10"), "10,12")).toBe(false);
    expect(answerMatches(cs("9-10"), "?")).toBe(false);
  });

  test("no answer yields ? and fails", () => {
    expect(extractAnswer(mc("A"), "")).toBe("?");
    expect(extractAnswer(int("5"), "no digits here")).toBe("?");
    expect(answerMatches(int("5"), "?")).toBe(false);
  });

  test("open answers: rational, ordered sequence, exact text, aliases", () => {
    const rat = open("rational", "25/2", ["12.5"]);
    expect(extractAnswer(rat, "Answer: $\\frac{25}{2}$")).toBe("25/2");
    expect(answerMatches(rat, "25/2")).toBe(true);
    expect(answerMatches(rat, extractAnswer(rat, "Answer: 12.5"))).toBe(true);
    expect(answerMatches(rat, "25/3")).toBe(false);

    const seq = open("sequence", "satire, martial-arts, horror, 2");
    expect(
      extractAnswer(seq, "Answer: **Satire, Martial-Arts, Horror, 2.**"),
    ).toBe("satire,martial-arts,horror,2");
    expect(answerMatches(seq, "satire,martial-arts,horror,2")).toBe(true);
    expect(answerMatches(seq, "horror,satire,martial-arts,2")).toBe(false);

    const tup = open("sequence", "(1,8,19),(2,7,13),(4,5,7)", [
      "(4,5,7),(2,7,13),(1,8,19)",
    ]);
    expect(
      answerMatches(
        tup,
        extractAnswer(tup, "Answer: (4, 5, 7), (2, 7, 13), (1, 8, 19)"),
      ),
    ).toBe(true);

    const txt = open("text", "2n-2", ["2(n-1)"]);
    expect(extractAnswer(txt, "Answer: $\\boxed{2n - 2}$")).toBe("2n-2");
    expect(answerMatches(txt, extractAnswer(txt, "Answer: 2(n-1)"))).toBe(true);
    expect(answerMatches(txt, "2n")).toBe(false);

    // No Answer: line means no payload; unlike integers there is no trailing fallback.
    expect(extractAnswer(seq, "probably satire, horror")).toBe("?");
    expect(extractAnswerDetailed(rat, "Answer: 25/2").anchored).toBe(true);
  });

  test("plural 'answers' is not an answer marker", () => {
    expect(
      extractAnswer(
        mc("D"),
        "Wrong answers include B. The correct choice is D",
      ),
    ).toBe("D");
  });

  test("marker answers are anchored, trailing fallbacks are not", () => {
    const anchored = (tc: ReasoningCase, text: string) =>
      extractAnswerDetailed(tc, text);
    expect(anchored(mc("C"), "Answer: C")).toEqual({
      got: "C",
      anchored: true,
    });
    expect(anchored(mc("C"), "probably C")).toEqual({
      got: "C",
      anchored: false,
    });
    expect(anchored(int("42"), "Answer: 42")).toEqual({
      got: "42",
      anchored: true,
    });
    expect(anchored(int("42"), "we get 42")).toEqual({
      got: "42",
      anchored: false,
    });
    expect(anchored(cs("3"), "Answer: line 3")).toEqual({
      got: "3",
      anchored: true,
    });
    expect(anchored(cs("3"), "the bug is at 3")).toEqual({
      got: "3",
      anchored: false,
    });
  });
});
