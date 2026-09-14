import { afterEach, describe, expect, test } from "vitest";

import {
  type MockDefects,
  type MockEngine,
  startMockEngine,
} from "../fixtures/mock-engine";
import { chatAdapter } from "../surfaces/chat/adapter";
import { EngineClient, type RunConfig } from "./client";
import type { ReasoningEffort } from "./adapter";
import {
  detectReasoning,
  type ReasoningSetup,
  resolveReasoning,
} from "./reasoning";

/**
 * The detector decides the token headroom for the WHOLE run, so a miss here is
 * not a small error: it re-prices every capped request and turns a capable
 * model into a failing card. Both cases below were live misses.
 */

let engine: MockEngine | null = null;

afterEach(() => {
  engine?.stop();
  engine = null;
});

async function detect(defects: MockDefects): Promise<boolean> {
  engine = await startMockEngine(defects);
  const config: RunConfig = {
    baseUrl: `${engine.url}/v1`,
    apiKey: "",
    model: "mock-model-12b",
    timeoutMs: 15_000,
    depth: "default",
    reasoningHeadroom: 0,
  };
  return detectReasoning(new EngineClient(config), chatAdapter, config);
}

describe("detectReasoning", () => {
  test("a model that never thinks is not a reasoning model", async () => {
    expect(await detect({})).toBe(false);
  });

  test("a model that thinks on a plain request is detected", async () => {
    expect(await detect({ reasoningModel: true })).toBe(true);
  });

  // The probe used to send a plain, tool-less, opt-in-less body — so a model
  // whose channel only appears when asked read as "not a reasoning model",
  // while the suite's own reasoning tests (which DO opt in) saw it think.
  test("a model that only thinks when the request opts in is detected", async () => {
    expect(await detect({ reasoningRequiresOptIn: true })).toBe(true);
  });

  // Muse-Glimmer, live 2026-08-11: thinking defaults ON with tools and OFF
  // without, so a tool-less probe missed it and every 64/128-token tool test
  // then starved on reasoning it was never budgeted for.
  test("a model whose thinking default is gated on tool presence is detected", async () => {
    expect(await detect({ reasoningWithTools: true })).toBe(true);
  });
});

/**
 * `--reasoning` is resolved once, up front, for the whole run: a strict engine
 * 400s the param and every stage must then run bare (and say so); an engine
 * that accepts `none` but keeps thinking needs the vendor toggle. Both were
 * live misses that silently compared a thinking run against a non-thinking one.
 */
describe("resolveReasoning", () => {
  async function resolve(
    effort: ReasoningEffort,
    defects: MockDefects,
  ): Promise<ReasoningSetup> {
    engine = await startMockEngine(defects);
    const config: RunConfig = {
      baseUrl: `${engine.url}/v1`,
      apiKey: "",
      model: "mock-model-12b",
      timeoutMs: 15_000,
      depth: "default",
      reasoningHeadroom: 0,
      reasoningEffort: effort,
    };
    return resolveReasoning(new EngineClient(config), chatAdapter, config);
  }

  test("an engine that accepts the effort keeps it", async () => {
    expect(await resolve("medium", {})).toEqual({
      reasoningEffort: "medium",
      reasoningEffortRejected: false,
    });
  });

  test("an engine that 400s the effort runs bare and says so", async () => {
    expect(await resolve("medium", { rejectsReasoningEffort: true })).toEqual({
      reasoningEffortRejected: true,
    });
  });

  test("an engine that honours reasoning_effort none needs nothing else", async () => {
    expect(await resolve("none", { reasoningModel: true })).toEqual({
      reasoningEffort: "none",
      reasoningEffortRejected: false,
      thinkingOff: "spec",
    });
  });

  // mlx-serve / MTPLX, live 2026-09: `reasoning_effort: "none"` is accepted
  // with 200 and ignored; only `chat_template_kwargs.enable_thinking` works.
  test("an engine that ignores none but honours the vendor toggle uses it", async () => {
    const setup = await resolve("none", {
      reasoningModel: true,
      ignoresReasoningNone: true,
    });
    expect(setup.thinkingOff).toBe("vendor");
  });

  test("an engine that ignores both is reported stuck", async () => {
    const setup = await resolve("none", {
      reasoningModel: true,
      ignoresReasoningNone: true,
      ignoresEnableThinking: true,
    });
    expect(setup.thinkingOff).toBe("stuck");
  });
});
