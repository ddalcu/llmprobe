import { describe, expect, test } from "vitest";

import { chatAdapter } from "../surfaces/chat/adapter";
import type { EngineClient, RunConfig } from "./client";
import { createContext } from "./context";

/**
 * The run-wide effort rides on every request through ctx.send, so that
 * conformance, capability, agentic and fidelity all measure the model at the
 * same thinking setting as the bench and eval — not at each engine's default.
 */
function contextWith(config: Partial<RunConfig>) {
  const bodies: Record<string, unknown>[] = [];
  const client = {
    request: async (_m: string, _p: string, o: { body: unknown }) => {
      bodies.push(o.body as Record<string, unknown>);
      return {
        status: 200,
        json: { choices: [{ message: { content: "4" } }] },
        text: "",
        headers: new Headers(),
        durationMs: 1,
      };
    },
    recordUsage: () => {},
  } as unknown as EngineClient;
  const ctx = createContext({
    config: {
      baseUrl: "http://x/v1",
      apiKey: "",
      model: "m",
      timeoutMs: 1,
      depth: "default",
      reasoningHeadroom: 0,
      ...config,
    },
    client,
    adapters: new Map([["chat", chatAdapter]]),
    present: new Set(["chat"]),
    evalSurface: "chat",
  });
  return { ctx, bodies };
}
const turns = [{ type: "user" as const, text: "2+2?" }];

describe("ctx.send reasoning effort", () => {
  test("sends the run-wide effort on a plain request", async () => {
    const { ctx, bodies } = contextWith({ reasoningEffort: "medium" });
    await ctx.send("chat", { turns, maxTokens: 64 });
    expect(bodies[0]!.reasoning_effort).toBe("medium");
  });

  test("a request that controls its own thinking is left alone", async () => {
    const { ctx, bodies } = contextWith({ reasoningEffort: "medium" });
    await ctx.send("chat", { turns, maxTokens: 64, reasoningEffort: null });
    await ctx.send("chat", { turns, maxTokens: 64, reasoningEffort: "low" });
    expect(bodies[0]!.reasoning_effort).toBeUndefined();
    expect(bodies[1]!.reasoning_effort).toBe("low");
  });

  test("no effort configured sends nothing", async () => {
    const { ctx, bodies } = contextWith({});
    await ctx.send("chat", { turns, maxTokens: 64 });
    expect(bodies[0]!.reasoning_effort).toBeUndefined();
  });
});
