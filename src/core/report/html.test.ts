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
    const report = sampleReport();
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
