import { describe, expect, test } from "vitest";

import { messagesAdapter } from "./adapter";

// These two mappings silently regressed to null once — the thinking-budget
// assertion downstream was unreachable for as long as nobody noticed.
describe("messages usage mapping", () => {
  test("parse maps thinking tokens and both cache counters", () => {
    const reply = messagesAdapter.parse({
      content: [{ type: "text", text: "hi" }],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 1200,
        cache_read_input_tokens: 0,
        output_tokens_details: { thinking_tokens: 3 },
      },
    });

    expect(reply.usage.reasoningTokens).toBe(3);
    expect(reply.usage.cacheCreationInputTokens).toBe(1200);
    expect(reply.usage.cachedInputTokens).toBe(0);
  });

  test("parseStream picks the same fields off message_start and message_delta", () => {
    const frame = (payload: unknown) => ({ data: JSON.stringify(payload) });
    const reply = messagesAdapter.parseStream([
      frame({
        type: "message_start",
        message: {
          id: "msg_1",
          usage: {
            input_tokens: 10,
            cache_creation_input_tokens: 1200,
            cache_read_input_tokens: 0,
          },
        },
      }),
      frame({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: {
          output_tokens: 5,
          output_tokens_details: { thinking_tokens: 3 },
        },
      }),
      frame({ type: "message_stop" }),
    ] as never);

    expect(reply.usage.reasoningTokens).toBe(3);
    expect(reply.usage.cacheCreationInputTokens).toBe(1200);
  });
});
