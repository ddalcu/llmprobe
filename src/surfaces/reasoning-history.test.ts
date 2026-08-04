import { describe, expect, it } from "vitest";

import type { RunConfig } from "../core/client";
import { chatAdapter } from "./chat/adapter";
import { messagesAdapter } from "./messages/adapter";

/**
 * Assistant-history reasoning round-trip: an `assistant-text` turn can carry
 * the reasoning the engine previously emitted, and each surface adapter must
 * render it in that surface's wire shape (chat: `reasoning_content`; messages:
 * a `thinking` content block). Engines whose chat templates persist reasoning
 * across turns (GLM family, poolside Laguna) starve into nothink when a
 * middleman drops the field — the conformance check built on this mapping is
 * what catches that class.
 */

const config: RunConfig = {
  baseUrl: "http://127.0.0.1:9999/v1",
  apiKey: "test",
  model: "test-model",
  timeoutMs: 1000,
  depth: "default",
} as RunConfig;

const REASONING = "The user asked for 2 + 2; basic arithmetic gives 4.";

describe("chat adapter: assistant-history reasoning", () => {
  it("renders reasoning as reasoning_content on the assistant message", () => {
    const body = chatAdapter.buildBody(
      {
        turns: [
          { type: "user", text: "What is 2 + 2?" },
          { type: "assistant-text", text: "4", reasoning: REASONING },
          { type: "user", text: "Add 3 to that." },
        ],
      },
      config,
    );
    const messages = body.messages as Array<Record<string, unknown>>;
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe("4");
    expect(messages[1].reasoning_content).toBe(REASONING);
  });

  it("omits the key entirely when the turn has no reasoning", () => {
    const body = chatAdapter.buildBody(
      { turns: [{ type: "assistant-text", text: "4" }] },
      config,
    );
    const messages = body.messages as Array<Record<string, unknown>>;
    // Templates gate on `is string` — an explicit null/undefined key would
    // still trip `is defined`-style checks in some templates.
    expect("reasoning_content" in messages[0]).toBe(false);
  });
});

describe("messages adapter: assistant-history reasoning", () => {
  it("renders reasoning as a thinking block ahead of the text block", () => {
    const body = messagesAdapter.buildBody(
      {
        turns: [
          { type: "user", text: "What is 2 + 2?" },
          { type: "assistant-text", text: "4", reasoning: REASONING },
        ],
      },
      config,
    );
    const messages = body.messages as Array<Record<string, unknown>>;
    expect(messages[1].role).toBe("assistant");
    const blocks = messages[1].content as Array<Record<string, unknown>>;
    expect(blocks[0].type).toBe("thinking");
    expect(blocks[0].thinking).toBe(REASONING);
    expect(blocks[1]).toEqual({ type: "text", text: "4" });
  });

  it("keeps plain string content when the turn has no reasoning", () => {
    const body = messagesAdapter.buildBody(
      { turns: [{ type: "assistant-text", text: "4" }] },
      config,
    );
    const messages = body.messages as Array<Record<string, unknown>>;
    expect(messages[0].content).toBe("4");
  });
});

describe("surface capability flag", () => {
  it("chat and messages can express history reasoning; responses cannot", async () => {
    const { responsesAdapter } = await import("./responses/adapter");
    expect(chatAdapter.reasoningHistory).toBe(true);
    expect(messagesAdapter.reasoningHistory).toBe(true);
    expect(responsesAdapter.reasoningHistory ?? false).toBe(false);
  });
});
