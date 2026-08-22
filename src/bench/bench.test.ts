import { afterEach, describe, expect, test } from "vitest";

import { ADAPTERS, primarySurface } from "../conformance/index";
import type { SurfaceAdapter } from "../core/adapter";
import { EngineClient, type RunConfig } from "../core/client";
import { createContext } from "../core/context";
import type { BenchStat } from "../core/outcome";
import { normalizeRoot } from "../core/probe";
import { type MockEngine, startMockEngine } from "../fixtures/mock-engine";
import {
  CODE_INSTRUCTION,
  COUNT_INSTRUCTION,
  PREFIX_CACHE_SEED,
  parseRungs,
  runBenchmark,
} from "./index";

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

    // Server features are cheap yes/no checks, and the mock answers instantly
    // from no cache at all — neither may invent a capability it hasn't seen.
    expect(report!.prefixCache).not.toBeNull();
    expect(report!.prefixCache!.verdict).not.toBe("active");
    expect(report!.batching).not.toBeNull();
    expect(report!.batching!.streams).toBe(4);
    expect(["batched", "partial", "serialized", "unknown"]).toContain(
      report!.batching!.verdict,
    );

    // The drift check bookends the run: it compares the opening decode figure
    // against one taken after every other probe has loaded the box.
    expect(report!.loadDrift).not.toBeNull();
    expect(report!.loadDrift!.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(["steady", "degraded", "improved", "unknown"]).toContain(
      report!.loadDrift!.verdict,
    );
    if (report!.loadDrift!.driftPct !== null) {
      expect(report!.loadDrift!.firstTokPerSec).not.toBeNull();
      expect(report!.loadDrift!.lastTokPerSec).not.toBeNull();
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

      // Every rung carries a speculation probe, so "does MTP survive at 16k?"
      // is answerable per rung rather than only at the short top-level probe.
      expect(point.speculative).not.toBeNull();
      // The mock writes the whole SSE body in one call, so no step boundary is
      // observable. That must read as "cannot tell", never as a token count.
      expect(point.speculative!.tokensPerStep).toBeNull();
      expect(point.speculative!.note).toBeTruthy();
    }
  });

  test("a rung whose answer never touched the context says so", async () => {
    // The coding task has to use a constant planted mid-corpus. A model that
    // ignores it is being timed on generation with a large irrelevant prefix,
    // which is not long-context work and must not be reported as though it is.
    engine = await startMockEngine();
    const root = normalizeRoot(engine.url);

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
      adapters: new Map<string, SurfaceAdapter>(ADAPTERS.map((a) => [a.id, a])),
      present: new Set(["models", "chat"]),
      evalSurface: primarySurface(new Set(["chat"])),
    });

    const report = await runBenchmark(ctx, false);
    // The mock answers with canned text, never the planted constant.
    for (const point of report!.contextScaling!) {
      expect(point.speculative!.note).toMatch(/RETRY_BUDGET_MS/);
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
      expect(point.speculative).not.toBeNull();
    }
  });

  test("--rungs and --runs override the ladder and the repetition count", async () => {
    engine = await startMockEngine();
    const root = normalizeRoot(engine.url);

    const config: RunConfig = {
      baseUrl: `${root}/v1`,
      apiKey: "",
      model: "mock-model-12b",
      timeoutMs: 15_000,
      depth: "default",
      reasoningHeadroom: 0,
      benchRungs: [8192, 16384],
      benchRuns: 2,
    };
    const client = new EngineClient(config);
    const ctx = createContext({
      config,
      client,
      adapters: new Map<string, SurfaceAdapter>(ADAPTERS.map((a) => [a.id, a])),
      present: new Set(["models", "chat"]),
      evalSurface: primarySurface(new Set(["chat"])),
    });

    const labels: string[] = [];
    const report = await runBenchmark(ctx, false, undefined, undefined, (s) => {
      if (!s.warmup) labels.push(s.label);
    });
    const points = report!.contextScaling!;
    expect(points.map((p) => p.targetTokens)).toEqual([8192, 16384]);
    for (const point of points) expect(point.runs).toBe(2);
    expect(labels.filter((l) => l.startsWith("decode "))).toEqual([
      "decode 1/2",
      "decode 2/2",
    ]);
    expect(labels.filter((l) => l.startsWith("prefill "))).toHaveLength(2);
    expect(report!.runsNote).toMatch(/2 runs/);
    expect(report!.runsNote).toMatch(/8k, 16k/);
  });

  test("parseRungs accepts k-suffixed and bare sizes, rejects unknown ones", () => {
    expect(parseRungs("64k,32k")).toEqual([32768, 65536]);
    expect(parseRungs("8,16")).toEqual([8192, 16384]);
    expect(parseRungs("0.5k,4096")).toEqual([512, 4096]);
    expect(() => parseRungs("24k")).toThrow(/512, 4k, 8k, 16k, 32k, 64k/);
    expect(() => parseRungs("")).toThrow();
  });

  test("every rung runs the realistic task and the ceiling, and nothing else", async () => {
    // Two generations per run: the coding task that is the headline, and the
    // maximally-predictable ceiling it is measured against. The echo variant
    // this replaced came back flat at every rung of a real 64k run, so its
    // request budget went to the one that discriminates.
    const asking = (
      bodies: Array<Record<string, unknown>>,
      instruction: string,
    ): number =>
      bodies.filter((body) => {
        const messages = body.messages as Array<{ content: string }>;
        return messages.at(-1)!.content.includes(instruction);
      }).length;

    engine = await startMockEngine();
    const root = normalizeRoot(engine.url);
    const base = {
      baseUrl: `${normalizeRoot(engine.url)}/v1`,
      apiKey: "",
      model: "mock-model-12b",
      timeoutMs: 15_000,
      reasoningHeadroom: 0,
    };
    const makeCtx = (config: RunConfig) =>
      createContext({
        config,
        client: new EngineClient(config),
        adapters: new Map<string, SurfaceAdapter>(
          ADAPTERS.map((a) => [a.id, a]),
        ),
        present: new Set(["models", "chat"]),
        evalSurface: primarySurface(new Set(["chat"])),
      });
    expect(root).toBeTruthy();

    await runBenchmark(makeCtx({ ...base, depth: "default" }), false);
    // 4 rungs × 1 run, one of each, plus the one-token calibration probe.
    expect(asking(engine.chatBodies, COUNT_INSTRUCTION)).toBe(4);
    expect(asking(engine.chatBodies, CODE_INSTRUCTION)).toBe(5);

    engine.chatBodies.length = 0;
    await runBenchmark(makeCtx({ ...base, depth: "full" }), false);
    // 6 rungs × 3 runs, still one of each per run.
    expect(asking(engine.chatBodies, COUNT_INSTRUCTION)).toBe(18);
    expect(asking(engine.chatBodies, CODE_INSTRUCTION)).toBe(19);
  });

  test("no two latency-reporting prompts share a head; only decode-only variants do", async () => {
    // Engines cache prompt KV by prefix (llama.cpp slots, vLLM APC, LM Studio,
    // Ollama). A measured run whose prompt the warmup already ingested gets a
    // cache-hit TTFT, and prefill = inputTokens / TTFT then reports tens of
    // thousands of tok/s. So every prompt we take a *latency* number from must
    // be unique from the very first tokens, because prefix caches match from
    // position 0.
    //
    // The rung's speculation variants are the deliberate exception: they reuse
    // their run's prefix precisely so a warm KV serves them, which costs
    // nothing because only their decode rate is read. Encoding that here keeps
    // it a design decision rather than an accident waiting to be reintroduced.
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

    // The prefix-cache probe is the one place that repeats a prompt on
    // purpose — it exists to measure the cache rather than defeat it. Exactly
    // one identical pair, and it is busted so it stays cold across runs.
    const cacheProbe = texts.filter((t) => t.includes(PREFIX_CACHE_SEED));
    expect(cacheProbe).toHaveLength(2);
    expect(cacheProbe[0]).toBe(cacheProbe[1]);

    // Everything else is byte-unique, variants included.
    const rest = texts.filter((t) => !t.includes(PREFIX_CACHE_SEED));
    expect(new Set(rest).size).toBe(rest.length);

    // Only the ceiling variant may share a head with its rung, and it is timed
    // for decode alone.
    const decodeOnly = rest.filter((t) => t.includes(COUNT_INSTRUCTION));
    const timed = rest.filter((t) => !decodeOnly.includes(t));
    const heads = timed.map((t) => t.slice(0, 24));
    expect(new Set(heads).size).toBe(heads.length);

    // And each shared head is shared with exactly one latency-reporting
    // prompt — its own rung run — never across rungs or runs.
    for (const variant of decodeOnly) {
      const head = variant.slice(0, 24);
      expect(timed.filter((t) => t.startsWith(head))).toHaveLength(1);
    }
    expect(decodeOnly.length).toBeGreaterThan(0);
  });

  test("a slow prefill is waited out, however slow — the benchmark sets no timeout", async () => {
    // How long an honest uncached prefill takes is a fact about the model and
    // the machine, and neither is predictable from here. A per-request timeout
    // just converts "this box is slow" into a fabricated rung failure, so the
    // benchmark has none: the stalled rungs must all complete.
    engine = await startMockEngine({ stallAbovePromptBytes: 20_000 });
    const root = normalizeRoot(engine.url);

    const config: RunConfig = {
      baseUrl: `${root}/v1`,
      apiKey: "",
      model: "mock-model-12b",
      timeoutMs: 50, // far under the mock's 1s stall, and irrelevant here
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

    const points = report!.contextScaling!;
    expect(points.map((p) => p.targetTokens)).toEqual([512, 4096, 8192, 16384]);
    for (const point of points) {
      expect(point.note).toBeNull();
      expect(point.runs).toBe(1);
    }
    // Every stalled request costs a real second, which is the point.
  }, 60_000);

  test("a rung the engine rejects ends the ladder with the engine's own error", async () => {
    // The real reason a rung dies is a context-window overflow, and that must
    // read as a named failure on the point — never a dead PERFORMANCE section.
    // Larger rungs can only fail the same way, so the climb stops.
    engine = await startMockEngine({ rejectAbovePromptBytes: 30_000 });
    const root = normalizeRoot(engine.url);

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
      adapters: new Map<string, SurfaceAdapter>(ADAPTERS.map((a) => [a.id, a])),
      present: new Set(["models", "chat"]),
      evalSurface: primarySurface(new Set(["chat"])),
    });

    const report = await runBenchmark(ctx, false);
    const points = report!.contextScaling!;
    const dead = points.at(-1)!;

    expect(points.length).toBeLessThan(4);
    expect(dead.ttftMs).toBeNull();
    expect(dead.decodeTokPerSec).toBeNull();
    expect(dead.speculative).toBeNull();
    expect(dead.runs).toBe(0);
    expect(dead.note).toMatch(/context window exceeded/);
  });

  test("sizes each rung against what the engine actually counted, not a byte guess", async () => {
    // English runs ~4.4 bytes/token, so a flat 4-bytes-per-token estimate lands
    // every rung ~10% short and the x-axis reads 3.7k where it says 4k. The
    // ladder must re-fit against the token counts usage reports.
    engine = await startMockEngine({ bytesPerToken: 4.4 });
    const root = normalizeRoot(engine.url);

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
      adapters: new Map<string, SurfaceAdapter>(ADAPTERS.map((a) => [a.id, a])),
      present: new Set(["models", "chat"]),
      evalSurface: primarySurface(new Set(["chat"])),
    });

    const report = await runBenchmark(ctx, false);
    for (const point of report!.contextScaling!) {
      const off = Math.abs(point.inputTokens! - point.targetTokens);
      expect(off / point.targetTokens).toBeLessThan(0.05);
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
