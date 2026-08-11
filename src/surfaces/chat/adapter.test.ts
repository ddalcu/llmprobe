import { describe, expect, test } from "vitest";

import { chatAdapter } from "./adapter";

/**
 * Ollama's OpenAI-compat layer streams thinking as `delta.reasoning` and sets
 * `delta.content` to "" on those frames. Reading `content` first and returning
 * it makes every reasoning frame invisible: the bench then divides ALL output
 * tokens by the window of the visible answer alone and reports a decode rate
 * two to three times the truth.
 */
describe("chat adapter · Ollama reasoning channel", () => {
  test("frameText reads delta.reasoning past an empty content", () => {
    const frame = {
      choices: [{ index: 0, delta: { content: "", reasoning: "thinking" } }],
    };
    expect(chatAdapter.frameText(frame)).toBe("thinking");
  });

  test("frameText still prefers real content over reasoning", () => {
    const frame = {
      choices: [{ index: 0, delta: { content: "answer", reasoning: "x" } }],
    };
    expect(chatAdapter.frameText(frame)).toBe("answer");
  });

  test("parseStream accumulates delta.reasoning", () => {
    const deltas = [
      { content: "", reasoning: "think " },
      { content: "", reasoning: "harder" },
      { content: "4" },
    ];
    const frames = deltas.map((delta, index) => {
      const data = JSON.stringify({ choices: [{ index: 0, delta }] });
      return { index, data, raw: `data: ${data}` };
    });

    const reply = chatAdapter.parseStream(frames);
    expect(reply.text).toBe("4");
    expect(reply.reasoningText).toBe("think harder");
  });

  test("parse reads message.reasoning", () => {
    const reply = chatAdapter.parse({
      choices: [
        { message: { role: "assistant", content: "4", reasoning: "r" } },
      ],
    });
    expect(reply.text).toBe("4");
    expect(reply.reasoningText).toBe("r");
  });
});
