import { describe, expect, test } from "bun:test";

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
        reasoningCaveat: false,
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
          runs: 3,
          note: null,
        },
        {
          targetTokens: 32768,
          inputTokens: null,
          decodeTokPerSec: null,
          ttftMs: null,
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
});
