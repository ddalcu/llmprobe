import { describe, expect, test } from "vitest";

import { detectReasoningLeak } from "./assert";

describe("detectReasoningLeak", () => {
  test("a plain answer is not a leak", () => {
    expect(detectReasoningLeak("51")).toEqual({ tag: null, opener: null });
    expect(detectReasoningLeak("Hi! How can I help you today?")).toEqual({
      tag: null,
      opener: null,
    });
  });

  test("finds every thinking wrapper an engine should have stripped", () => {
    for (const [text, expected] of [
      ["<think>17 times 3</think> 51", "<think>"],
      ["<|thinking|>carry the one<|thinking|> 51", "<thinking>"],
      ["<thought>hmm</thought> 51", "<thought>"],
      ["[THINKING] hmm [/THINKING] 51", "[thinking]"],
      ["◁think▷hmm◁/think▷ 51", "◁think▷"],
      ["<|channel|>analysis the user wants", "<|channel|>analysis"],
    ] as const) {
      expect(detectReasoningLeak(text).tag).toBe(expected);
    }
  });

  test("catches untagged deliberation, which wears no markers at all", () => {
    // The mtplx shape: chain-of-thought straight into content, no wrapper and
    // no reasoning_content field, so a tag-only check sails right past it.
    const leak = detectReasoningLeak(
      `Here's a thinking process:\n\n1.  **Analyze User Input:** The user said "Say hi."\n2.  **Identify Intent:**\n\n\n---\n`,
    );
    expect(leak.tag).toBeNull();
    expect(leak.opener).toMatch(/here's a thinking process/i);
  });

  test("recognises the common untagged openers", () => {
    for (const text of [
      "Okay, the user is asking for 17 times 3.",
      "Thinking: I should multiply.",
      "Let's break this down step by step.",
      "First, I need to multiply 17 by 3.",
      "I need to figure out what 17 * 3 is.",
      "**Analyze the request:** the user wants a product.",
    ]) {
      expect(detectReasoningLeak(text).opener).not.toBeNull();
    }
  });

  test("does not fire on an answer that merely discusses thinking", () => {
    // Only an opener counts. A reply that mentions reasoning halfway through is
    // answering, not narrating itself.
    expect(
      detectReasoningLeak(
        "51. I got there by thinking of 17 * 3 as 17 * 2 plus 17.",
      ).opener,
    ).toBeNull();
    expect(
      detectReasoningLeak("The user manual explains the thought process.")
        .opener,
    ).toBeNull();
  });
});
