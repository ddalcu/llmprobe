import { afterEach, describe, expect, test } from "bun:test";

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
    engine = startMockEngine();
    const root = normalizeRoot(engine.url);

    const adapters = new Map<string, SurfaceAdapter>(
      ADAPTERS.map((a) => [a.id, a]),
    );
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
      adapters,
      present: new Set(["models", "chat"]),
      evalSurface: primarySurface(new Set(["chat"])),
    });

    const report = await runBenchmark(ctx, false);
    expect(report).not.toBeNull();

    coherent(report!.decodeTokPerSec);
    coherent(report!.ttftMs);
    coherent(report!.prefillTokPerSec);

    if (report!.speculative) {
      expect(["effective", "marginal", "none"]).toContain(
        report!.speculative.verdict,
      );
      // The mock has no real speculative path, so predictable and novel run at
      // the same speed — it must not be reported as effective.
      expect(report!.speculative.verdict).not.toBe("effective");
    }

    // Context ladder: one point per rung, each coherent.
    expect(report!.contextScaling).not.toBeNull();
    expect(report!.contextScaling!.map((p) => p.targetTokens)).toEqual([
      512, 4096, 8192, 16384,
    ]);
    for (const point of report!.contextScaling!) {
      if (point.decodeTokPerSec !== null) {
        expect(point.decodeTokPerSec).toBeGreaterThan(0);
      }
      if (point.ttftMs !== null) expect(point.ttftMs).toBeGreaterThanOrEqual(0);
    }
  });

  test("returns null when there is no chat-shaped surface to benchmark", async () => {
    engine = startMockEngine();
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
