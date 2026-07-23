import { afterEach, describe, expect, test } from "vitest";

import { ADAPTERS, primarySurface } from "../conformance/index";
import type { SurfaceAdapter } from "../core/adapter";
import { EngineClient, type RunConfig } from "../core/client";
import { createContext } from "../core/context";
import type { BenchStat } from "../core/outcome";
import { normalizeRoot } from "../core/probe";
import { type MockEngine, startMockEngine } from "../fixtures/mock-engine";
import { runBenchmark } from "./index";

/**
 * Wiring test: streamTimed → parseStream → frameText → stats, end to end.
 *
 * The mock answers instantly, so real speeds aren't meaningful here — the
 * numbers are validated by stats.test.ts and by the live runs. What this pins is
 * that the benchmark plumbing produces *coherent* shapes and never throws, and
 * that (with no real speculation behind the mock) it doesn't hallucinate an
 * "effective" MTP verdict.
 */

let engine: MockEngine | null = null;

afterEach(() => {
  engine?.stop();
  engine = null;
});

function coherent(stat: BenchStat | null): void {
  if (stat === null) return; // sub-ms timing can legitimately yield no sample
  expect(stat.min).toBeLessThanOrEqual(stat.median);
  expect(stat.median).toBeLessThanOrEqual(stat.max);
  expect(stat.samples.length).toBeGreaterThan(0);
  for (const s of stat.samples) expect(s).toBeGreaterThanOrEqual(0);
}

describe("runBenchmark against the mock", () => {
  test("produces a coherent, non-throwing report", async () => {
    engine = await startMockEngine();
    const root = normalizeRoot(engine.url);

    const adapters = new Map<string, SurfaceAdapter>(
      ADAPTERS.map((a) => [a.id, a]),
    );
    const config: RunConfig = {
      baseUrl: `${root}/v1`,
      apiKey: "",
      model: "mock-model-12b",
      timeoutMs: 15_000,
      depth: "default",
      reasoningHeadroom: 0,
    };
    const client = new EngineClient(config);
    const ctx = createContext({
      config,
      client,
      adapters,
      present: new Set(["models", "chat"]),
      evalSurface: primarySurface(new Set(["chat"])),
    });

    const report = await runBenchmark(ctx, false);
    expect(report).not.toBeNull();

    coherent(report!.decodeTokPerSec);
    coherent(report!.ttftMs);
    coherent(report!.prefillTokPerSec);

    // The "same machine only" caveat is checkable: the report records where
    // it ran.
    expect(report!.machine.platform.length).toBeGreaterThan(0);
    expect(report!.machine.arch.length).toBeGreaterThan(0);
    expect(report!.machine.memGB).toBeGreaterThan(0);

    if (report!.speculative) {
      expect(["effective", "marginal", "none"]).toContain(
        report!.speculative.verdict,
      );
      // The mock has no real speculative path, so predictable and novel run at
      // the same speed — it must not be reported as effective.
      expect(report!.speculative.verdict).not.toBe("effective");
    }

    // Context ladder: one point per rung at the default depth, each coherent.
    expect(report!.contextScaling).not.toBeNull();
    expect(report!.contextScaling!.map((p) => p.targetTokens)).toEqual([
      512, 4096, 8192, 16384,
    ]);
    for (const point of report!.contextScaling!) {
      expect(point.runs).toBe(1);
      expect(point.note).toBeNull();
      if (point.decodeTokPerSec !== null) {
        expect(point.decodeTokPerSec).toBeGreaterThan(0);
      }
      if (point.ttftMs !== null) expect(point.ttftMs).toBeGreaterThanOrEqual(0);
    }
  });

  test("--full climbs to 64k and takes the median of 3 runs per rung", async () => {
    engine = await startMockEngine();
    const root = normalizeRoot(engine.url);

    const config: RunConfig = {
      baseUrl: `${root}/v1`,
      apiKey: "",
      model: "mock-model-12b",
      timeoutMs: 15_000,
      depth: "full",
      reasoningHeadroom: 0,
    };
    const client = new EngineClient(config);
    const ctx = createContext({
      config,
      client,
      adapters: new Map<string, SurfaceAdapter>(ADAPTERS.map((a) => [a.id, a])),
      present: new Set(["models", "chat"]),
      evalSurface: primarySurface(new Set(["chat"])),
    });

    const report = await runBenchmark(ctx, false);
    const points = report!.contextScaling!;
    expect(points.map((p) => p.targetTokens)).toEqual([
      512, 4096, 8192, 16384, 32768, 65536,
    ]);
    for (const point of points) {
      expect(point.runs).toBe(3);
      expect(point.note).toBeNull();
    }
  });

  test("never sends the same prompt twice, nor two prompts sharing a head", async () => {
    // Engines cache prompt KV by prefix (llama.cpp slots, vLLM APC, LM Studio,
    // Ollama). A measured run whose prompt the warmup already ingested gets a
    // cache-hit TTFT, and prefill = inputTokens / TTFT then reports tens of
    // thousands of tok/s. Every request must therefore be unique — and unique
    // from the very first tokens, because prefix caches match from position 0.
    engine = await startMockEngine();
    const root = normalizeRoot(engine.url);

    const config: RunConfig = {
      baseUrl: `${root}/v1`,
      apiKey: "",
      model: "mock-model-12b",
      timeoutMs: 15_000,
      depth: "full",
      reasoningHeadroom: 0,
    };
    const client = new EngineClient(config);
    const ctx = createContext({
      config,
      client,
      adapters: new Map<string, SurfaceAdapter>(ADAPTERS.map((a) => [a.id, a])),
      present: new Set(["models", "chat"]),
      evalSurface: primarySurface(new Set(["chat"])),
    });

    await runBenchmark(ctx, false);

    const texts = engine.chatBodies.map((body) => {
      const messages = body.messages as Array<{ content: string }>;
      return messages.at(-1)!.content;
    });
    expect(texts.length).toBeGreaterThan(0);

    expect(new Set(texts).size).toBe(texts.length);

    const heads = texts.map((t) => t.slice(0, 24));
    expect(new Set(heads).size).toBe(heads.length);
  });

  test("a rung that outlasts the request timeout ends the ladder with a note", async () => {
    // Honest (uncached) prefill can push a big context rung past the
    // per-request timeout on slow hardware. That must yield a named failure on
    // that rung — never a dead PERFORMANCE section — and stop the climb:
    // larger rungs can only fail the same way.
    engine = await startMockEngine({ stallAbovePromptBytes: 20_000 });
    const root = normalizeRoot(engine.url);

    const config: RunConfig = {
      baseUrl: `${root}/v1`,
      apiKey: "",
      model: "mock-model-12b",
      timeoutMs: 200,
      depth: "default",
      reasoningHeadroom: 0,
    };
    const client = new EngineClient(config);
    const ctx = createContext({
      config,
      client,
      adapters: new Map<string, SurfaceAdapter>(ADAPTERS.map((a) => [a.id, a])),
      present: new Set(["models", "chat"]),
      evalSurface: primarySurface(new Set(["chat"])),
    });

    const report = await runBenchmark(ctx, false);
    expect(report).not.toBeNull();
    coherent(report!.decodeTokPerSec);

    // 512/4096-token rungs (≤16 KB prompts) fit under the stall threshold; the
    // 8192 rung stalls past even the stretched context timeout (3 × 200 ms),
    // so 16384 is never attempted.
    const points = report!.contextScaling!;
    expect(points.map((p) => p.targetTokens)).toEqual([512, 4096, 8192]);
    expect(points[1]!.ttftMs).not.toBeNull();
    expect(points[2]!.ttftMs).toBeNull();
    expect(points[2]!.decodeTokPerSec).toBeNull();
    expect(points[2]!.runs).toBe(0);
    expect(points[2]!.note).toMatch(/timed out/);
  });

  test("context rungs get 3× the request timeout — big uncached prefills are the slowest thing we do", async () => {
    // A slow model that answers small prompts inside the timeout but needs
    // longer than `--timeout` for a big prefill. The flat timeout would kill
    // the rung; the context ladder must stretch it 3× before giving up.
    engine = await startMockEngine({ stallAbovePromptBytes: 20_000 });
    const root = normalizeRoot(engine.url);

    const config: RunConfig = {
      baseUrl: `${root}/v1`,
      apiKey: "",
      model: "mock-model-12b",
      timeoutMs: 500, // < the mock's 1s stall, but 3× = 1.5s clears it
      depth: "default",
      reasoningHeadroom: 0,
    };
    const client = new EngineClient(config);
    const ctx = createContext({
      config,
      client,
      adapters: new Map<string, SurfaceAdapter>(ADAPTERS.map((a) => [a.id, a])),
      present: new Set(["models", "chat"]),
      evalSurface: primarySurface(new Set(["chat"])),
    });

    const report = await runBenchmark(ctx, false);
    const points = report!.contextScaling!;

    // Every rung completes: the stalled 8192/16384 prompts finish within the
    // stretched window instead of ending the ladder.
    expect(points.map((p) => p.targetTokens)).toEqual([512, 4096, 8192, 16384]);
    for (const point of points) {
      expect(point.note).toBeNull();
      expect(point.runs).toBe(1);
    }
  });

  test("returns null when there is no chat-shaped surface to benchmark", async () => {
    engine = await startMockEngine();
    const root = normalizeRoot(engine.url);
    const config: RunConfig = {
      baseUrl: `${root}/v1`,
      apiKey: "",
      model: "mock-model-12b",
      timeoutMs: 15_000,
      depth: "full",
      reasoningHeadroom: 0,
    };
    const client = new EngineClient(config);
    const ctx = createContext({
      config,
      client,
      adapters: new Map(ADAPTERS.map((a) => [a.id, a])),
      present: new Set(["models"]),
      evalSurface: null,
    });

    expect(await runBenchmark(ctx, false)).toBeNull();
  });
});
