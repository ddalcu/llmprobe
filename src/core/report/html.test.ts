import { describe, expect, test } from "vitest";

import type { JsonReport } from "./json";
import { renderHtml } from "./html";

function sampleReport(): JsonReport {
  return {
    version: 1,
    target: {
      baseUrl: "http://localhost:8080/v1",
      model: "test-model </script><b>",
      engine: "llama.cpp",
    },
    coverage: {
      byTier: [
        {
          tier: "core",
          supported: 2,
          total: 2,
          pct: 100,
          missing: [],
          unprobed: [],
        },
        {
          tier: "extended",
          supported: 1,
          total: 4,
          pct: 25,
          missing: ["responses", "logprobs"],
          unprobed: [],
        },
      ],
      credits: [{ id: "ollama-chat", label: "Ollama native /api/chat" }],
      entries: [
        {
          id: "chat",
          label: "chat/completions",
          kind: "surface",
          tier: "core",
          supported: true,
        },
      ],
    },
    conformance: {
      pct: 96,
      passed: 48,
      total: 50,
      bySurface: [{ surface: "chat", passed: 48, total: 50, pct: 96 }],
      results: [
        {
          id: "chat-basic",
          name: "chat basic",
          surface: "chat",
          outcome: "pass",
          failures: [],
        },
        {
          id: "chat-fail",
          name: "chat fail",
          surface: "chat",
          outcome: "fail",
          failures: [
            {
              id: "must-1",
              label: "must assert",
              severity: "MUST",
              message: "broken",
            },
          ],
        },
      ],
    },
    capability: {
      pct: 78,
      verdict: "capable",
      categories: [
        { category: "tool-selection", passed: 6, total: 6, pct: 100 },
        { category: "json-discipline", passed: 4, total: 6, pct: 67 },
      ],
      weakCategories: [],
      evals: [
        {
          id: "eval-tool-select-weather",
          name: "picks weather tool",
          category: "tool-selection",
          passed: 3,
          total: 3,
          failures: [],
        },
      ],
    },
    agentic: {
      tasks: [
        {
          id: "agentic-read",
          name: "reads the config",
          passed: true,
          steps: 3,
        },
      ],
      passed: 1,
      total: 1,
      pct: 100,
    },
    usage: { inputTokens: 90_000, outputTokens: 10_000 },
    durationMs: 123_456,
  };
}

describe("renderHtml", () => {
  test("renders the intent-based report card with overview and drill-downs", () => {
    const html = renderHtml(sampleReport());

    expect(html).toContain("data-theme-select");
    expect(html).toContain("Surface coverage");
    expect(html).toContain("Engine conformance");
    expect(html).toContain("Model capability");
    expect(html).toContain("capable");
    expect(html).toContain("✗ responses");
    expect(html).toContain("conf-tbody");
    expect(html).toContain("data-surface-filter");
    expect(html).toContain("Three independent scores");
    // Offline — no CDN.
    expect(html).not.toContain("cdn.jsdelivr");
  });

  test("a hostile model name cannot break out of markup or scripts", () => {
    const html = renderHtml(sampleReport());
    expect(html).not.toContain("</script><b>");
    // Escaped in HTML text content (not raw tag breakout).
    expect(html).toContain("&lt;/script&gt;");
  });

  test("includes library link when libraryHref is provided", () => {
    const html = renderHtml(sampleReport(), { libraryHref: "index.html" });
    expect(html).toContain('href="index.html"');
    expect(html).toContain("Library");
  });

  test("keeps unmeasured categories explicit", () => {
    const report = benchOnlyReport();
    // The evals were attempted and produced nothing — an engine that refuses
    // every tool call. Unlike --bench-only, that is a result worth showing.
    report.run!.phases.capability = {
      status: "unavailable",
      reason: "no capability evals",
    };
    report.capability = {
      ...report.capability,
      categories: [],
      unmeasured: ["tool-selection", "tool-restraint"],
      verdict: "below-floor",
      pct: 0,
    };
    const html = renderHtml(report);
    expect(html).toContain("never measured");
    expect(html).toContain("Tool selection");
  });
});

/** A --bench-only save: surfaces discovered, every scored phase skipped. */
function benchOnlyReport(): JsonReport {
  const report = sampleReport();
  report.version = 2;
  report.run = {
    depth: "quick",
    mode: "bench-only",
    startedAt: "2026-08-11T22:40:09.006Z",
    phases: {
      coverage: { status: "measured" },
      conformance: { status: "not-run", reason: "benchmark-only run" },
      capability: { status: "not-run", reason: "benchmark-only run" },
      agentic: { status: "not-run", reason: "benchmark-only run" },
      fidelity: { status: "not-run", reason: "benchmark-only run" },
      performance: { status: "measured" },
    },
    budget: { exhausted: false },
  };
  report.conformance = { pct: 0, passed: 0, total: 0, bySurface: [], results: [] };
  report.capability = {
    pct: 0,
    verdict: "below-floor",
    categories: [],
    weakCategories: [],
    evals: [],
  };
  delete report.agentic;
  report.bench = {
    decodeTokPerSec: { median: 82.4, min: 80, max: 85, samples: [80, 82.4, 85] },
    streamCaveat: null,
    ttftMs: { median: 240, min: 220, max: 260, samples: [220, 240, 260] },
    prefillTokPerSec: { median: 1900, min: 1800, max: 2000, samples: [1800, 1900, 2000] },
    prefillPromptTokens: 4096,
    speculative: {
      predictableTokPerSec: 140,
      novelTokPerSec: 82,
      ratio: 1.7,
      verdict: "effective",
      tokensPerStep: 2.4,
      tokensPerStepNote: null,
      reasoningCaveat: false,
    },
    prefixCache: {
      coldTtftMs: 900,
      warmTtftMs: 120,
      speedup: 7.5,
      cachedTokens: 4000,
      promptTokens: 4096,
      verdict: "active",
    },
    batching: {
      streams: 4,
      singleTokPerSec: 82,
      aggregateTokPerSec: 260,
      efficiency: 0.79,
      worstTtftMs: 1400,
      verdict: "batched",
    },
    loadDrift: {
      firstTokPerSec: 84,
      lastTokPerSec: 81,
      driftPct: -3.6,
      elapsedMs: 180_000,
      verdict: "steady",
    },
    machine: { platform: "darwin", arch: "arm64", cpu: "Apple M3 Max", memGB: 64 },
    contextScaling: [
      {
        targetTokens: 512,
        inputTokens: 530,
        decodeTokPerSec: 84,
        ttftMs: 180,
        prefillTokPerSec: 2900,
        speculative: null,
        runs: 1,
        note: null,
      },
      {
        targetTokens: 32_768,
        inputTokens: null,
        decodeTokPerSec: null,
        ttftMs: null,
        prefillTokPerSec: null,
        speculative: null,
        runs: 0,
        note: "context window exceeded",
      },
    ],
  };
  return report;
}

describe("renderHtml — benchmark runs", () => {
  test("renders the performance section from bench data", () => {
    const html = renderHtml(benchOnlyReport());

    expect(html).toContain("Performance");
    expect(html).toContain("82.4");
    expect(html).toContain("Apple M3 Max");
    expect(html).toContain("Prefix cache");
    expect(html).toContain("Concurrency");
    expect(html).toContain("context window exceeded");
  });

  test("draws an svg chart when context scaling has two measured rungs", () => {
    const report = benchOnlyReport();
    report.bench!.contextScaling!.splice(1, 0, {
      targetTokens: 4096,
      inputTokens: 4100,
      decodeTokPerSec: 61,
      ttftMs: 420,
      prefillTokPerSec: 2400,
      speculative: null,
      runs: 1,
      note: null,
    });
    const html = renderHtml(report);
    expect(html).toContain('class="ctx-chart"');
  });

  test("one measured rung is not a curve — no svg chart", () => {
    const html = renderHtml(benchOnlyReport());
    expect(html).not.toContain('class="ctx-chart"');
  });

  test("a bench-only run does not show unrun phases as failures", () => {
    const html = renderHtml(benchOnlyReport());

    // The scored cards never ran — showing 0% / below-floor reads as an
    // engine that failed everything rather than one nobody measured.
    expect(html).not.toContain("below-floor");
    expect(html).not.toContain('id="conformance"');
    expect(html).not.toContain('id="capability"');
    expect(html).not.toContain('id="agentic"');
    expect(html).not.toContain('id="fidelity"');
    // ...and it says so, rather than leaving the reader to notice.
    expect(html).toContain("benchmark-only run");
  });

  test("a full run keeps every measured section", () => {
    const html = renderHtml(sampleReport());

    expect(html).toContain('id="conformance"');
    expect(html).toContain('id="capability"');
    expect(html).toContain('id="agentic"');
    expect(html).not.toContain('id="performance"');
  });
});
