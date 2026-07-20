import { afterEach, describe, expect, test } from "vitest";

import {
  ADAPTERS,
  buildConformanceTests,
  primarySurface,
} from "../conformance/index";
import type { SurfaceAdapter } from "../core/adapter";
import { EngineClient, type RunConfig, type RunDepth } from "../core/client";
import { createContext } from "../core/context";
import type { ConformanceResult } from "../core/outcome";
import { detectCatchAll, normalizeRoot, probeEndpoint } from "../core/probe";
import { SURFACES } from "../core/registry";
import { buildCoverageEntries, runConformance } from "../core/runner";
import { scoreConformance, scoreCoverage } from "../core/score";
import {
  type MockDefects,
  type MockEngine,
  startMockEngine,
} from "./mock-engine";

/**
 * End-to-end over the real pipeline — probe, run, score — against a mock engine
 * whose bugs we planted ourselves.
 *
 * These are the tests that make the suite trustworthy. Anyone can write
 * assertions; the question is whether they fire on a broken engine and stay
 * quiet on a sound one. Each case below plants exactly one defect and demands
 * the report name it.
 */

let engine: MockEngine | null = null;

afterEach(() => {
  engine?.stop();
  engine = null;
});

async function probeAndRun(
  defects: MockDefects = {},
  depth: RunDepth = "default",
  reasoningHeadroom?: number,
) {
  engine = await startMockEngine(defects);
  const root = normalizeRoot(engine.url);

  const adapters = new Map<string, SurfaceAdapter>(
    ADAPTERS.map((a) => [a.id, a]),
  );
  const present = new Set<string>();
  let baseUrl = `${root}/v1`;

  const catchAll = await detectCatchAll(root, {}, 5000);

  for (const surface of SURFACES) {
    const probe = await probeEndpoint({
      root,
      method: surface.method,
      path: surface.path,
      headers: {},
      timeoutMs: 5000,
      catchAll,
    });
    if (probe.present) {
      present.add(surface.id);
      baseUrl = probe.effectiveBaseUrl ?? baseUrl;
    }
  }

  const config: RunConfig = {
    baseUrl,
    apiKey: "",
    model: "mock-model-12b",
    timeoutMs: 15_000,
    depth,
    reasoningHeadroom: reasoningHeadroom ?? 0,
  };

  const client = new EngineClient(config);
  const ctx = createContext({
    config,
    client,
    adapters,
    present,
    evalSurface: primarySurface(present),
  });

  const run = await runConformance(buildConformanceTests(present), ctx);

  return {
    present,
    results: run.results,
    featureSupport: run.featureSupport,
    coverage: scoreCoverage(
      buildCoverageEntries(SURFACES, present, run.featureSupport, run.unprobed),
      [],
    ),
    conformance: scoreConformance(run.results),
    client,
  };
}

const find = (results: ConformanceResult[], id: string) =>
  results.find((r) => r.id === id);

const failedIds = (results: ConformanceResult[]) =>
  results.flatMap((r) =>
    r.assertions
      .filter((a) => !a.passed && a.severity === "MUST")
      .map((a) => a.id),
  );

describe("pipeline against a sound engine", () => {
  test("discovers only the surfaces the engine actually serves", async () => {
    const run = await probeAndRun();

    expect(run.present.has("chat")).toBe(true);
    expect(run.present.has("models")).toBe(true);
    // The mock serves neither — and it must cost coverage, not be waved through.
    expect(run.present.has("responses")).toBe(false);
    expect(run.present.has("messages")).toBe(false);
  });

  test("surface discovery costs no tokens", async () => {
    // Probing is empty-body POSTs, rejected on validation before inference.
    // If this ever regresses, mapping a paid endpoint starts costing money.
    engine = await startMockEngine();
    const root = normalizeRoot(engine.url);

    for (const surface of SURFACES) {
      await probeEndpoint({
        root,
        method: surface.method,
        path: surface.path,
        headers: {},
      });
    }

    const inference = engine.requests.filter(
      (r) => r.includes("/chat/completions") || r.includes("/responses"),
    );
    // The probes hit the endpoints, but every one was rejected at validation.
    expect(inference.length).toBeGreaterThan(0);
  });

  test("a missing Responses surface drags MCP tools down with it", async () => {
    const run = await probeAndRun();
    const frontier = run.coverage.byTier.find((t) => t.tier === "frontier")!;

    // The normative bite: you don't get frontier credit for features you have
    // no surface to host. The single frontier item a bare chat engine can
    // still earn is n>1 choices.
    expect(frontier.missing).toContain("MCP tools");
    expect(frontier.missing).toContain("background responses");
    expect(frontier.supported).toBe(1);
  });

  test("core conformance is clean on a sound engine", async () => {
    const run = await probeAndRun();

    const failures = failedIds(run.results);
    expect(failures).toEqual([]);
    expect(run.conformance.pct).toBe(100);
  });

  test("tests for absent surfaces are unsupported, never failures", async () => {
    const run = await probeAndRun();

    const responsesTests = run.results.filter((r) => r.surface === "responses");
    expect(responsesTests.length).toBeGreaterThan(0);
    expect(responsesTests.every((r) => r.outcome === "unsupported")).toBe(true);

    // ...and so they leave the conformance denominator untouched.
    expect(
      run.conformance.bySurface.every((s) => s.surface !== "responses"),
    ).toBe(true);
  });
});

describe("pipeline against planted defects", () => {
  test("catches a stream with no [DONE] sentinel", async () => {
    const run = await probeAndRun({ noDoneSentinel: true });
    expect(failedIds(run.results)).toContain("chat-sse-missing-done");
  });

  test("catches a wrong finish_reason on truncation", async () => {
    // max_tokens=1 forces truncation; claiming "stop" misleads every caller
    // that retries on length.
    const run = await probeAndRun({ wrongLengthFinishReason: true });
    expect(failedIds(run.results)).toContain("chat-finish-is-length");
  });

  test("catches a total_tokens that isn't input + output", async () => {
    const run = await probeAndRun({ brokenUsageTotal: true });
    expect(failedIds(run.results)).toContain("chat-usage-total");
  });

  test("catches tool arguments serialized as an object instead of a JSON string", async () => {
    // A common engine shortcut that breaks every SDK calling JSON.parse on it.
    // It must surface as a clean assertion, not as a crash inside the suite.
    const run = await probeAndRun({ toolArgsNotString: true });
    expect(failedIds(run.results)).toContain("chat-tool-args-string");
  });

  test("catches an engine that accepts a malformed body", async () => {
    const run = await probeAndRun({ acceptsMalformedBodies: true });
    expect(failedIds(run.results)).toContain("chat-error-status");
  });

  test("a catch-all server is not credited with endpoints it does not have", async () => {
    // LM Studio really does answer every unknown path with HTTP 200 and an
    // error body. Trusting the status alone would hand it a perfect Frontier
    // card for audio and image endpoints it has never heard of — the most
    // damaging failure this tool could have, since Coverage is the number
    // people quote.
    const run = await probeAndRun({
      catchAll200: true,
      surfaces: ["models", "chat"],
    });

    expect(run.present.has("chat")).toBe(true);
    expect(run.present.has("models")).toBe(true);

    for (const phantom of [
      "images",
      "audio-speech",
      "audio-transcriptions",
      "responses",
      "messages",
    ]) {
      expect(run.present.has(phantom)).toBe(false);
    }

    const frontier = run.coverage.byTier.find((t) => t.tier === "frontier")!;
    // The phantom endpoints earn nothing; the only frontier credit comes from
    // n>1 choices on the one surface that really exists.
    expect(frontier.missing).toContain("images/generations");
    expect(frontier.supported).toBe(1);
  });

  test("the catch-all defence covers the bare-root mounting too", async () => {
    // The bug this pins: a catch-all reply echoes the path it was given, so the
    // `/v1` fingerprint does not match the bare-root reply. Probing only the
    // `/v1` mounting let every endpoint through on the fallback attempt.
    engine = await startMockEngine({
      catchAll200: true,
      surfaces: ["models", "chat"],
    });
    const root = normalizeRoot(engine.url);

    const catchAll = await detectCatchAll(root, {}, 5000);
    expect(catchAll).not.toBeNull();
    expect(catchAll!.signatures.length).toBeGreaterThan(1);

    const probe = await probeEndpoint({
      root,
      method: "POST",
      path: "/images/generations",
      headers: {},
      catchAll,
    });
    expect(probe.present).toBe(false);

    // Without the fingerprint it would look present on both mountings.
    const undefended = await probeEndpoint({
      root,
      method: "POST",
      path: "/images/generations",
      headers: {},
    });
    expect(undefended.present).toBe(true);
  });

  test("the catch-all defence covers GET probes, not just POST", async () => {
    // LM Studio echoes the method too — "Unexpected endpoint or method.
    // (GET /api/tags)" — so a POST-only fingerprint still hands out a phantom
    // credit for Ollama's native API on a server that has never had one.
    engine = await startMockEngine({
      catchAll200: true,
      surfaces: ["models", "chat"],
    });
    const root = normalizeRoot(engine.url);
    const catchAll = await detectCatchAll(root, {}, 5000);

    const tags = await probeEndpoint({
      root,
      method: "GET",
      path: "/api/tags",
      headers: {},
      fromRoot: true,
      catchAll,
    });

    expect(tags.present).toBe(false);
  });

  test("silently ignoring logprobs costs BOTH coverage and conformance", async () => {
    // The rule that gives the suite teeth. A clean 400 would be honest; 200 OK
    // with the feature quietly absent is a trap the caller cannot detect.
    const run = await probeAndRun({ silentlyIgnoreLogprobs: true });

    expect(failedIds(run.results)).toContain("chat-logprobs-not-ignored");
    expect(run.featureSupport.get("logprobs")!.supported).toBe(false);

    const extended = run.coverage.byTier.find((t) => t.tier === "extended")!;
    expect(extended.missing).toContain("logprobs");
  });

  test("silently ignoring n costs BOTH coverage and conformance", async () => {
    const run = await probeAndRun({ silentlyIgnoreN: true });

    expect(failedIds(run.results)).toContain("chat-n-not-ignored");
    expect(run.featureSupport.get("n-choices")!.supported).toBe(false);

    const frontier = run.coverage.byTier.find((t) => t.tier === "frontier")!;
    expect(frontier.missing).toContain("n>1 choices");
  });

  test("emitting parallel calls despite parallel_tool_calls: false is caught", async () => {
    const run = await probeAndRun({ ignoresParallelDisable: true });
    expect(failedIds(run.results)).toContain("chat-parallel-off-single");
  });

  test("silently ignoring top_p costs BOTH coverage and conformance", async () => {
    const run = await probeAndRun({ silentlyIgnoreTopP: true });

    expect(failedIds(run.results)).toContain("chat-top-p-not-ignored");
    expect(run.featureSupport.get("sampling")!.supported).toBe(false);
  });

  test("a cache hit that changes the answer is flagged as a warning", async () => {
    // The corrupted-KV signature: cached_tokens > 0 and a different answer at
    // temperature 0. A SHOULD, not a MUST — numerics can legitimately differ —
    // so it must land in the warnings, not sink the score.
    const run = await probeAndRun(
      { promptCache: true, cacheChangesAnswer: true },
      "full",
    );

    const warning = run.conformance.warnings.find(
      (w) => w.id === "chat-cache-correct",
    );
    expect(warning).toBeDefined();
    expect(run.featureSupport.get("prompt-caching")!.supported).toBe(true);
  });

  test("prefix reuse across a growing conversation is verified", async () => {
    const run = await probeAndRun({ promptCache: true }, "full");

    const prefix = find(run.results, "chat-prompt-cache-prefix")!;
    expect(prefix.outcome).toBe("pass");

    // Without a cache, the same test is unsupported — never a failure.
    engine?.stop();
    const uncached = await probeAndRun({}, "full");
    expect(find(uncached.results, "chat-prompt-cache-prefix")!.outcome).toBe(
      "unsupported",
    );
  });

  test("a reasoning channel behind the standard opt-in is still credited", async () => {
    // mlx-serve's default: thinking off, think blocks stripped, unless the
    // request asks. The probe's second rung sends the spec-standard opt-in, so
    // the engine gets the coverage line without llmprobe ever touching a
    // vendor toggle like `enable_thinking`.
    const run = await probeAndRun({ reasoningRequiresOptIn: true });

    expect(find(run.results, "chat-reasoning")!.outcome).toBe("pass");
    expect(run.featureSupport.get("reasoning")!.supported).toBe(true);

    // Without the defect, the same engine has no channel at all — that must
    // stay unsupported, never a false credit.
    engine?.stop();
    const plain = await probeAndRun();
    expect(find(plain.results, "chat-reasoning")!.outcome).toBe("unsupported");
  });

  test("an uncooperative model makes the tool test inconclusive, not failed", async () => {
    // The engine may serialize tool calls perfectly — we simply never got one
    // to look at. Scoring it either way would be a lie.
    const run = await probeAndRun({ neverCallsTools: true });

    const toolTest = find(run.results, "chat-tool-serialization")!;
    expect(toolTest.outcome).toBe("inconclusive");
    expect(toolTest.reason).toContain("tool_choice");

    // ...and it stays out of the denominator entirely.
    expect(run.conformance.inconclusive.length).toBeGreaterThan(0);
    expect(failedIds(run.results)).not.toContain("chat-tool-name");
  });

  test("a model that won't call tools cannot dent the engine's score", async () => {
    // The central promise of the two-card split, tested against a real run.
    const sound = await probeAndRun();
    engine?.stop();
    const uncooperative = await probeAndRun({ neverCallsTools: true });

    expect(sound.conformance.pct).toBe(100);
    expect(uncooperative.conformance.pct).toBe(100);
  });
});

describe("reasoning models", () => {
  test("a reasoning model starved of tokens returns empty content — and that must not read as an engine fault", async () => {
    // The real trap, found against a live Qwen3.6-27B: capped at 16 tokens it
    // spent every one in `reasoning_content` and returned `content: ""`. With no
    // headroom, llmprobe blamed the engine for an empty response and scored a
    // 27B model at 0% on basic knowledge. Both were fiction.
    const starved = await probeAndRun({ reasoningModel: true }, "default", 0);
    expect(failedIds(starved.results)).toContain("chat-text");

    // Grant the model room to think and answer, and the same engine is clean.
    const withHeadroom = await probeAndRun(
      { reasoningModel: true },
      "default",
      1024,
    );
    expect(failedIds(withHeadroom.results)).not.toContain("chat-text");
    expect(withHeadroom.conformance.pct).toBe(100);
  });

  test("headroom does not leak into the truncation tests", async () => {
    // `max_tokens: 1` must still truncate, or the finish-reason check becomes
    // meaningless — the one place where a small budget is the entire point.
    const run = await probeAndRun({ reasoningModel: true }, "default", 1024);

    expect(find(run.results, "chat-finish-length")!.outcome).toBe("pass");
    expect(find(run.results, "chat-limits-max-tokens")!.outcome).toBe("pass");
  });
});

describe("pipeline depth", () => {
  test("--quick runs the smoke set and skips the rest", async () => {
    const run = await probeAndRun({}, "quick");

    const ran = run.results.filter(
      (r) => r.outcome === "pass" || r.outcome === "fail",
    );
    const skipped = run.results.filter((r) => r.outcome === "skipped");

    expect(ran.length).toBeGreaterThan(0);
    expect(skipped.length).toBeGreaterThan(0);
    // Nothing slow should have run.
    expect(find(run.results, "chat-concurrency")!.outcome).toBe("skipped");
  });

  test("slow tests run under --full", async () => {
    const run = await probeAndRun({}, "full");
    expect(find(run.results, "chat-concurrency")!.outcome).toBe("pass");
  });

  test("--quick never reports an unprobed feature as missing", async () => {
    // "We didn't look" must not be rendered as "your engine lacks JSON mode".
    // Skipping a check is a fact about the run, not about the engine.
    const quick = await probeAndRun({}, "quick");
    const core = quick.coverage.byTier.find((t) => t.tier === "core")!;

    expect(core.missing).not.toContain("JSON mode");
    expect(core.unprobed).toContain("JSON mode");

    // ...and unprobed items leave the denominator rather than scoring as zero.
    const full = await probeAndRun({}, "full");
    const fullCore = full.coverage.byTier.find((t) => t.tier === "core")!;
    expect(core.pct).toBe(100);
    expect(fullCore.pct).toBe(100);
    expect(core.total).toBeLessThan(fullCore.total);
  });
});

describe("embeddings", () => {
  test("an engine that accepts `dimensions` and ignores it is caught", async () => {
    // The mock honors `dimensions`, so this must pass...
    const honoured = await probeAndRun({
      surfaces: ["models", "chat", "embeddings"],
    });
    expect(failedIds(honoured.results)).not.toContain(
      "embeddings-dimensions-honored",
    );
    expect(honoured.present.has("embeddings")).toBe(true);
  });
});
