import { describe, expect, test } from "vitest";

import { Asserter, Inconclusive } from "../core/assert";
import type { ChatReply } from "../core/adapter";
import type { RunContext } from "../core/context";
import { messagesOnlyTests } from "./surfaces";

const stopEcho = messagesOnlyTests.find(
  (t) => t.id === "messages-stop-sequence-echo",
)!;

/** A context whose only job is to hand the test one canned reply. */
function ctxReplying(reply: Partial<ChatReply>, raw: unknown = {}): RunContext {
  return {
    config: { model: "m" },
    send: async () => ({
      status: 200,
      reply: { text: "", finishReason: null, ...reply } as ChatReply,
      headers: new Headers(),
      raw,
      text: "",
      durationMs: 1,
    }),
  } as unknown as RunContext;
}

describe("messages: stop_sequence echo", () => {
  test("a model that talks about alpha but never reaches beta is inconclusive", async () => {
    // Llama-3.2-3B and Mistral-7B do exactly this: "Alpha is a Greek letter
    // often used to denote..." until max_tokens. The stop sequence was never
    // emitted, so the engine's stop handling was never exercised — scoring it
    // as a MUST failure blames the engine for the model rambling.
    const a = new Asserter();
    await expect(
      stopEcho.run(
        ctxReplying({
          text: "Alpha is a Greek letter often used to denote the first item in",
          finishReason: "max_tokens",
        }),
        a,
      ),
    ).rejects.toBeInstanceOf(Inconclusive);
  });

  test("an engine that ignores the stop sequence still fails", async () => {
    const a = new Asserter();
    await stopEcho.run(
      ctxReplying({ text: "alpha beta gamma", finishReason: "end_turn" }),
      a,
    );

    expect(a.failedMust).toBe(true);
  });

  test("a cut that reports the wrong stop_reason is still caught", async () => {
    // The text stops exactly where the stop sequence was, so the engine did
    // the cut and mislabelled it — the guard must not swallow this one.
    const a = new Asserter();
    await stopEcho.run(
      ctxReplying({ text: "alpha", finishReason: "end_turn" }, {}),
      a,
    );

    expect(a.failedMust).toBe(true);
  });

  test("a clean cut passes", async () => {
    const a = new Asserter();
    await stopEcho.run(
      ctxReplying(
        { text: "alpha ", finishReason: "stop_sequence" },
        { stop_sequence: "beta" },
      ),
      a,
    );

    expect(a.failedMust).toBe(false);
    expect(a.results.every((r) => r.passed)).toBe(true);
  });
});
