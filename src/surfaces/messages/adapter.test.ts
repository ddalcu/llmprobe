import { describe, expect, test } from "vitest";

import { chatAdapter } from "../chat/adapter";
import { responsesAdapter } from "../responses/adapter";
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

describe("reasoning effort none", () => {
  const config = {
    baseUrl: "http://x",
    apiKey: "",
    model: "m",
    timeoutMs: 1,
    depth: "quick" as const,
    reasoningHeadroom: 0,
  };
  const request = {
    turns: [{ type: "user" as const, text: "hi" }],
    maxTokens: 4096,
    reasoningEffort: "none" as const,
  };

  test("messages sends thinking disabled", () => {
    expect(messagesAdapter.buildBody(request, config).thinking).toEqual({
      type: "disabled",
    });
  });

  test("chat and responses send the spec's none value", () => {
    expect(chatAdapter.buildBody(request, config).reasoning_effort).toBe(
      "none",
    );
    expect(responsesAdapter.buildBody(request, config).reasoning).toEqual({
      effort: "none",
    });
  });
});

// Vendors keep adding effort levels (xhigh on Qwen Flash), so the value is a
// pass-through on chat/responses; messages only has a budget, so an unknown
// level gets the high share rather than being refused.
describe("non-standard reasoning effort", () => {
  const config = {
    baseUrl: "http://x/v1",
    apiKey: "",
    model: "m",
    timeoutMs: 1,
    depth: "quick" as const,
    reasoningHeadroom: 0,
  };
  const request = {
    turns: [{ type: "user" as const, text: "hi" }],
    maxTokens: 4096,
    reasoningEffort: "xhigh",
  };

  test("chat and responses pass the value through", () => {
    expect(chatAdapter.buildBody(request, config).reasoning_effort).toBe(
      "xhigh",
    );
    expect(responsesAdapter.buildBody(request, config).reasoning).toEqual({
      effort: "xhigh",
    });
  });

  test("messages spends the high share on an unknown level", () => {
    expect(messagesAdapter.buildBody(request, config).thinking).toEqual({
      type: "enabled",
      budget_tokens: 3072,
    });
  });
});

test("thinking opt-in clears Anthropic's 1024-token budget floor", () => {
  const optIn = messagesAdapter.reasoningOptIn as {
    thinking: { budget_tokens: number };
  };
  expect(optIn.thinking.budget_tokens).toBeGreaterThanOrEqual(1024);
});
