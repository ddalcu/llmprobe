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
      entries: [],
    },
    conformance: {
      pct: 96,
      passed: 48,
      total: 50,
      bySurface: [{ surface: "chat", passed: 48, total: 50, pct: 96 }],
      results: [],
    },
    capability: {
      pct: 78,
      verdict: "capable",
      categories: [
        { category: "tool-selection", passed: 6, total: 6, pct: 100 },
        { category: "json-discipline", passed: 4, total: 6, pct: 67 },
      ],
      weakCategories: [],
      evals: [],
    },
    bench: {
      decodeTokPerSec: {
        median: 42.3,
        min: 39.1,
        max: 44,
        samples: [39.1, 42.3, 44],
      },
      ttftMs: { median: 380, min: 310, max: 520, samples: [310, 380, 520] },
      prefillTokPerSec: {
        median: 910,
        min: 890,
        max: 930,
        samples: [890, 910, 930],
      },
      prefillPromptTokens: 2048,
      speculative: {
        predictableTokPerSec: 71.2,
        novelTokPerSec: 39.4,
        ratio: 1.81,
        verdict: "effective",
        tokensPerStep: 2.4,
        tokensPerStepNote: null,
        reasoningCaveat: false,
      },
      prefixCache: {
        coldTtftMs: 3410,
        warmTtftMs: 190,
        speedup: 17.9,
        cachedTokens: 1536,
        promptTokens: 1624,
        verdict: "active",
      },
      batching: {
        streams: 4,
        singleTokPerSec: 45.9,
        aggregateTokPerSec: 168,
        efficiency: 0.92,
        worstTtftMs: 310,
        verdict: "batched",
      },
      loadDrift: {
        firstTokPerSec: 42.3,
        lastTokPerSec: 36.1,
        driftPct: -14.7,
        elapsedMs: 237_000,
        verdict: "degraded",
      },
      machine: {
        platform: "darwin",
        arch: "arm64",
        cpu: "Apple M3",
        memGB: 64,
      },
      contextScaling: [
        {
          targetTokens: 512,
          inputTokens: 540,
          decodeTokPerSec: 41.9,
          ttftMs: 90,
          prefillTokPerSec: 6000,
          speculative: {
            predictableTokPerSec: 74.1,
            predictableTokensPerStep: 4.1,
            ratio: 1.77,
            verdict: "effective",
            tokensPerStep: 2.3,
            note: null,
          },
          runs: 3,
          note: null,
        },
        {
          targetTokens: 32768,
          inputTokens: null,
          decodeTokPerSec: null,
          ttftMs: null,
          prefillTokPerSec: null,
          speculative: null,
          runs: 0,
          note: "HTTP 400 — context window exceeded",
        },
      ],
    },
    usage: { inputTokens: 90_000, outputTokens: 10_000 },
    durationMs: 123_456,
  };
}

describe("renderHtml", () => {
  test("renders a self-contained page with all sections and charts", () => {
    const html = renderHtml(sampleReport());

    // Chart.js inlined — the page must work offline, no CDN.
    expect(html).toContain("Chart");
    expect(html).not.toContain("cdn.jsdelivr");
    expect(html.length).toBeGreaterThan(100_000);

    for (const id of [
      "capability-chart",
      "context-decode-chart",
      "context-ttft-chart",
      "context-prefill-chart",
      "context-step-chart",
      "speculative-chart",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }

    // The data is present as text too, never chart-only.
    expect(html).toContain("Tool selection");
    expect(html).toContain("Apple M3");
    expect(html).toContain("context window exceeded");
    expect(html).toContain("✗ responses");
    expect(html).toContain("✓ capable");
    expect(html).toContain("Model evaluation");
    expect(html).toContain("Deployment readiness");
    expect(html).toContain("Engine diagnostics");
    expect(html).toContain("Engine conformance");
    expect(html).toContain('href="#model"');
  });

  test("a hostile model name cannot break out of markup or scripts", () => {
    const html = renderHtml(sampleReport());
    expect(html).not.toContain("</script><b>");
  });

  test("omits bench markup when the benchmark did not run", () => {
    const report = { ...sampleReport(), bench: undefined };
    const html = renderHtml(report);
    // The chart script always names the ids (it no-ops on a missing canvas);
    // what must disappear is the canvas markup itself.
    expect(html).not.toContain('id="context-decode-chart"');
    expect(html).not.toContain('id="speculative-chart"');
    expect(html).toContain('id="capability-chart"');
  });

  test("keeps an unmeasured quick-style report explicit", () => {
    const report = sampleReport();
    report.version = 2;
    report.capability = {
      ...report.capability,
      pct: 0,
      verdict: "below-floor",
      categories: [],
      unmeasured: ["tool-selection", "tool-restraint"],
    };
    report.run = {
      depth: "quick",
      mode: "probe",
      startedAt: "2026-08-06T12:00:00.000Z",
      phases: {
        coverage: { status: "partial", reason: "quick depth" },
        conformance: { status: "partial", reason: "quick depth" },
        capability: { status: "not-run", reason: "quick depth" },
        agentic: { status: "not-run", reason: "quick depth" },
        fidelity: { status: "not-run", reason: "quick depth" },
        performance: { status: "not-run", reason: "not requested" },
      },
    };
    const html = renderHtml(report);
    expect(html).toContain("Model evidence was not-run");
    expect(html).toContain("quick depth");
    expect(html).not.toContain("Model evidence was 0%");
  });
});
