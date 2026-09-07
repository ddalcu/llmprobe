import { afterEach, describe, expect, test } from "vitest";

import { ADAPTERS } from "../conformance/index";
import type { ChatRequest, SurfaceAdapter } from "../core/adapter";
import {
  BudgetExceededError,
  EngineClient,
  type RunConfig,
  TargetUnreachableError,
} from "../core/client";
import { createContext } from "../core/context";
import { normalizeRoot } from "../core/probe";
import { type MockEngine, startMockEngine } from "../fixtures/mock-engine";
import {
  HARD_CASES,
  REASONING_CASES,
  runReasoning,
  selectCases,
} from "./index";

let engine: MockEngine | null = null;
afterEach(() => {
  engine?.stop();
  engine = null;
});

describe("runReasoning against the mock", () => {
  test("grades every selected case and sums by source", async () => {
    engine = await startMockEngine();
    const config: RunConfig = {
      baseUrl: `${normalizeRoot(engine.url)}/v1`,
      apiKey: "",
      model: "mock-model-12b",
      timeoutMs: 15_000,
      depth: "default",
      reasoningHeadroom: 0,
    };
    const ctx = createContext({
      config,
      client: new EngineClient(config),
      adapters: new Map<string, SurfaceAdapter>(ADAPTERS.map((a) => [a.id, a])),
      present: new Set(["chat"]),
      evalSurface: "chat",
    });

    // First GPQA case (answer B), first AIME case, first COMPSEC case.
    const aime = REASONING_CASES.findIndex((c) => c.source === "AIME2025") + 1;
    const compsec =
      REASONING_CASES.findIndex((c) => c.source === "COMPSEC") + 1;
    const report = await runReasoning(ctx, {
      maxTokens: 64,
      temperature: 0,
      sequence: `1,${aime},${compsec}`,
    });

    expect(report.total).toBe(3);
    expect(report.scopeNote).toMatch(/3 of/);
    // The mock answers "Answer: B" to multiple choice, "Answer: 0" otherwise.
    expect(report.cases.map((c) => c.status)).toEqual([
      "passed",
      "failed",
      "failed",
    ]);
    expect(report.passed).toBe(1);
    expect(
      report.bySource.map((s) => `${s.source}:${s.passed}/${s.total}`),
    ).toEqual(["GPQA Diamond:1/1", "AIME2025:0/1", "COMPSEC:0/1"]);
  });
});

describe("runReasoning partial results", () => {
  test("keeps completed cases when the budget dies mid-run", async () => {
    engine = await startMockEngine();
    const config: RunConfig = {
      baseUrl: `${normalizeRoot(engine.url)}/v1`,
      apiKey: "",
      model: "mock-model-12b",
      timeoutMs: 15_000,
      depth: "default",
      reasoningHeadroom: 0,
      budgetTokens: 1,
    };
    const ctx = createContext({
      config,
      client: new EngineClient(config),
      adapters: new Map<string, SurfaceAdapter>(ADAPTERS.map((a) => [a.id, a])),
      present: new Set(["chat"]),
      evalSurface: "chat",
    });

    const report = await runReasoning(ctx, {
      maxTokens: 64,
      temperature: 0,
      sequence: "1,2",
    });

    expect(report.total).toBe(1);
    expect(report.aborted?.reason).toBe("budget");
    expect(report.scopeNote).toMatch(/1 of 2/);
  });
});

describe("runReasoning transport blips", () => {
  const build = async () => {
    engine = await startMockEngine();
    const config: RunConfig = {
      baseUrl: `${normalizeRoot(engine.url)}/v1`,
      apiKey: "",
      model: "mock-model-12b",
      timeoutMs: 15_000,
      depth: "default",
      reasoningHeadroom: 0,
    };
    const ctx = createContext({
      config,
      client: new EngineClient(config),
      adapters: new Map<string, SurfaceAdapter>(ADAPTERS.map((a) => [a.id, a])),
      present: new Set(["chat"]),
      evalSurface: "chat",
    });
    return ctx;
  };

  test("one dropped socket mid-eval is retried, not fatal", async () => {
    const ctx = await build();
    const real = ctx.send.bind(ctx);
    let calls = 0;
    ctx.send = async (surface, request, options) => {
      calls += 1;
      if (calls === 1)
        throw new TargetUnreachableError("/chat/completions", {
          name: "TypeError",
          message: "fetch failed",
        });
      return real(surface, request, options);
    };

    const report = await runReasoning(ctx, {
      maxTokens: 64,
      temperature: 0,
      sequence: "1,2",
    });

    expect(report.total).toBe(2);
    expect(report.aborted).toBeNull();
  });

  test("a dead target is declared after three tries, keeping answered cases", async () => {
    const ctx = await build();
    const real = ctx.send.bind(ctx);
    let calls = 0;
    ctx.send = async (surface, request, options) => {
      calls += 1;
      if (calls === 1) return real(surface, request, options);
      throw new TargetUnreachableError("/chat/completions", {
        name: "TypeError",
        message: "fetch failed",
      });
    };

    const report = await runReasoning(ctx, {
      maxTokens: 64,
      temperature: 0,
      sequence: "1,2",
    });

    expect(report.total).toBe(1);
    expect(report.aborted?.reason).toBe("unreachable");
    expect(report.scopeNote).toMatch(/1 of 2/);
  });
});

describe("runReasoning concurrency", () => {
  const build = async () => {
    engine = await startMockEngine();
    const config: RunConfig = {
      baseUrl: `${normalizeRoot(engine.url)}/v1`,
      apiKey: "",
      model: "mock-model-12b",
      timeoutMs: 15_000,
      depth: "default",
      reasoningHeadroom: 0,
    };
    const ctx = createContext({
      config,
      client: new EngineClient(config),
      adapters: new Map<string, SurfaceAdapter>(ADAPTERS.map((a) => [a.id, a])),
      present: new Set(["chat"]),
      evalSurface: "chat",
    });
    const selected = selectCases(REASONING_CASES, { sequence: "1,2,3" });
    /** Which selected case a stubbed request belongs to, by its prompt. */
    const idxOf = (request: ChatRequest): number => {
      const first = request.turns[0];
      const text = first?.type === "user" ? first.text : "";
      return selected.findIndex((c) => text.startsWith(c.question));
    };
    return { ctx, selected, idxOf };
  };

  test("parallel cases finish out of order but the report stays in deck order", async () => {
    const { ctx, idxOf } = await build();
    const real = ctx.send.bind(ctx);
    const completions: number[] = [];
    ctx.send = async (surface, request, options) => {
      const idx = idxOf(request);
      // The first-dispatched question is the slowest to answer.
      await new Promise((r) => setTimeout(r, [120, 10, 50][idx] ?? 0));
      const res = await real(surface, request, options);
      completions.push(idx);
      return res;
    };
    const seen: number[] = [];
    const report = await runReasoning(ctx, {
      maxTokens: 64,
      temperature: 0,
      sequence: "1,2,3",
      concurrency: 3,
      onCase: (_r, i) => seen.push(i),
    });

    expect(completions).toEqual([1, 2, 0]);
    expect(seen).toEqual([1, 2, 0]);
    expect(report.cases.map((c) => c.id)).toEqual(
      selectCases(REASONING_CASES, { sequence: "1,2,3" }).map((c) => c.id),
    );
    expect(report.aborted).toBeNull();
  });

  test("a budget death in parallel stops dispatch and keeps in-flight answers", async () => {
    const { ctx, idxOf } = await build();
    const real = ctx.send.bind(ctx);
    let sends = 0;
    ctx.send = async (surface, request, options) => {
      sends += 1;
      const idx = idxOf(request);
      // The budget dies the moment question 2 is asked; question 1 is still
      // in flight and must survive into the report.
      if (idx === 1) throw new BudgetExceededError(1000, 999);
      if (idx === 0) await new Promise((r) => setTimeout(r, 100));
      return real(surface, request, options);
    };

    const report = await runReasoning(ctx, {
      maxTokens: 64,
      temperature: 0,
      sequence: "1,2,3",
      concurrency: 2,
    });

    expect(report.aborted?.reason).toBe("budget");
    expect(sends).toBe(2);
    expect(report.total).toBe(1);
    expect(report.scopeNote).toMatch(/1 of 3/);
  });

  test("a corpse in parallel keeps the answers already in flight", async () => {
    const { ctx, idxOf, selected } = await build();
    const real = ctx.send.bind(ctx);
    ctx.send = async (surface, request, options) => {
      if (idxOf(request) === 1)
        throw new TargetUnreachableError("/chat/completions", {
          name: "TypeError",
          message: "fetch failed",
        });
      return real(surface, request, options);
    };

    const report = await runReasoning(ctx, {
      maxTokens: 64,
      temperature: 0,
      sequence: "1,2,3",
      concurrency: 3,
    });

    expect(report.aborted?.reason).toBe("unreachable");
    expect(report.cases.map((c) => c.id)).toEqual([
      selected[0]!.id,
      selected[2]!.id,
    ]);
    expect(report.scopeNote).toMatch(/2 of 3/);
  });
});

describe("runReasoning over real HTTP", () => {
  // Every chat request stalls a second, so a client that fans out holds
  // several requests in the engine at once and a sequential one never holds
  // more than one — exactly what chatPeakInFlight measures.
  const stalled = async () => {
    engine = await startMockEngine({ stallAbovePromptBytes: 1 });
    const config: RunConfig = {
      baseUrl: `${normalizeRoot(engine.url)}/v1`,
      apiKey: "",
      model: "mock-model-12b",
      timeoutMs: 15_000,
      depth: "default",
      reasoningHeadroom: 0,
    };
    return createContext({
      config,
      client: new EngineClient(config),
      adapters: new Map<string, SurfaceAdapter>(ADAPTERS.map((a) => [a.id, a])),
      present: new Set(["chat"]),
      evalSurface: "chat",
    });
  };

  test("concurrency 3 holds 3 questions in the engine at once", async () => {
    const ctx = await stalled();
    const expected = selectCases(REASONING_CASES, { sequence: "1,2,3" });

    const report = await runReasoning(ctx, {
      maxTokens: 64,
      temperature: 0,
      sequence: "1,2,3",
      concurrency: 3,
    });

    expect(engine!.chatPeakInFlight).toBe(3);
    expect(report.aborted).toBeNull();
    expect(report.total).toBe(3);
    expect(report.cases.map((c) => c.id)).toEqual(expected.map((c) => c.id));
  });

  test("the default still asks one question at a time", async () => {
    const ctx = await stalled();

    const report = await runReasoning(ctx, {
      maxTokens: 64,
      temperature: 0,
      sequence: "1,2",
    });

    expect(engine!.chatPeakInFlight).toBe(1);
    expect(report.aborted).toBeNull();
    expect(report.total).toBe(2);
  });
});

describe("hard suite", () => {
  test("per-case token cap applies unless --eval-max-tokens overrides it", async () => {
    engine = await startMockEngine();
    const config: RunConfig = {
      baseUrl: `${normalizeRoot(engine.url)}/v1`,
      apiKey: "",
      model: "mock-model-12b",
      timeoutMs: 15_000,
      depth: "default",
      reasoningHeadroom: 0,
    };
    const ctx = createContext({
      config,
      client: new EngineClient(config),
      adapters: new Map<string, SurfaceAdapter>(ADAPTERS.map((a) => [a.id, a])),
      present: new Set(["chat"]),
      evalSurface: "chat",
    });
    const real = ctx.send.bind(ctx);
    const caps: (number | undefined)[] = [];
    ctx.send = async (surface, request, options) => {
      caps.push(request.maxTokens);
      return real(surface, request, options);
    };

    const first = HARD_CASES[0]!;
    expect(first.maxTokens).toBe(16384);
    const report = await runReasoning(ctx, {
      suite: "hard",
      temperature: 0,
      sequence: first.id,
    });
    expect(report.suite).toBe("hard");
    expect(report.cases[0]!.source).toBe("MMLU-Pro");
    expect(report.scopeNote).toMatch(new RegExp(`1 of ${HARD_CASES.length}`));

    await runReasoning(ctx, {
      suite: "hard",
      maxTokens: 64,
      temperature: 0,
      sequence: first.id,
    });
    expect(caps).toEqual([16384, 64]);
  });
});

describe("case deck", () => {
  test("COMPSEC is spread through the deck, not parked at the tail", () => {
    const total = REASONING_CASES.length;
    const share =
      REASONING_CASES.filter((c) => c.source === "COMPSEC").length / total;
    let seen = 0;
    REASONING_CASES.forEach((c, i) => {
      if (c.source === "COMPSEC") seen++;
      expect(Math.abs(seen - (i + 1) * share)).toBeLessThanOrEqual(1);
    });
  });
});

describe("selectCases", () => {
  test("limit and sequence", () => {
    expect(selectCases(REASONING_CASES, { limit: 2 })).toHaveLength(2);
    expect(
      selectCases(REASONING_CASES, { sequence: "3,1" }).map((c) => c.id),
    ).toEqual([REASONING_CASES[2]!.id, REASONING_CASES[0]!.id]);
    expect(
      selectCases(REASONING_CASES, { sequence: "aime" }).every(
        (c) => c.source === "AIME2025",
      ),
    ).toBe(true);
    expect(
      selectCases(REASONING_CASES, { sequence: "GPQA Diamond" }),
    ).toHaveLength(25);
    expect(() => selectCases(REASONING_CASES, { sequence: "999" })).toThrow();
    // Sources and ids reach across suites; numbers stay relative to the deck.
    const mixed = selectCases(REASONING_CASES, { sequence: "gpqa,mmlupro" });
    expect(mixed).toHaveLength(25 + 30);
    expect(mixed.at(-1)!.source).toBe("MMLU-Pro");
    expect(selectCases(REASONING_CASES, { sequence: "2826" })[0]!.source).toBe(
      "MMLU-Pro",
    );
    expect(selectCases(HARD_CASES, { sequence: "aime" })).toHaveLength(25);
  });
});

describe("reasoning effort", () => {
  function contextFor(url: string) {
    const config: RunConfig = {
      baseUrl: `${normalizeRoot(url)}/v1`,
      apiKey: "",
      model: "mock-model-12b",
      timeoutMs: 15_000,
      depth: "default",
      reasoningHeadroom: 0,
    };
    return createContext({
      config,
      client: new EngineClient(config),
      adapters: new Map<string, SurfaceAdapter>(ADAPTERS.map((a) => [a.id, a])),
      present: new Set(["chat"]),
      evalSurface: "chat",
    });
  }

  test("sends reasoning_effort on every question and reports it", async () => {
    engine = await startMockEngine();
    const report = await runReasoning(contextFor(engine.url), {
      maxTokens: 64,
      temperature: 0,
      sequence: "1,2",
      reasoningEffort: "medium",
    });
    expect(engine.chatBodies.map((b) => b.reasoning_effort)).toEqual([
      "medium",
      "medium",
    ]);
    expect(report.reasoningEffort).toBe("medium");
    expect(report.reasoningEffortRejected).toBe(false);
  });

  test("drops the param after a 400 and flags the report", async () => {
    engine = await startMockEngine({ rejectsReasoningEffort: true });
    const report = await runReasoning(contextFor(engine.url), {
      maxTokens: 64,
      temperature: 0,
      sequence: "1,2",
      reasoningEffort: "medium",
    });
    // Rejected once, retried bare, then bare for the rest of the run.
    expect(engine.chatBodies.map((b) => b.reasoning_effort)).toEqual([
      "medium",
      undefined,
      undefined,
    ]);
    expect(report.cases[0]!.status).toBe("passed");
    expect(report.reasoningEffort).toBe("medium");
    expect(report.reasoningEffortRejected).toBe(true);
  });
});
