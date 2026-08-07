import { describe, expect, test } from "vitest";

import {
  renderBenchmarkComparisonHtml,
  renderComparisonHtml,
} from "./compare";
import type { JsonReport } from "./json";

function report(over: Partial<JsonReport> = {}): JsonReport {
  return {
    version: 1,
    target: { baseUrl: "http://localhost:1234/v1", model: "m", engine: "e" },
    coverage: {
      byTier: [
        { tier: "core", supported: 9, total: 9, pct: 100, missing: [] },
        { tier: "extended", supported: 7, total: 14, pct: 50, missing: [] },
      ],
      credits: [],
      entries: [],
    },
    conformance: {
      pct: 100,
      passed: 10,
      total: 10,
      bySurface: [],
      results: [],
    },
    capability: {
      pct: 90,
      verdict: "capable",
      categories: [{ category: "reasoning", passed: 3, total: 3, pct: 100 }],
      weakCategories: [],
      evals: [],
    },
    usage: { inputTokens: 1, outputTokens: 1 },
    durationMs: 1000,
    ...over,
  } as JsonReport;
}

const bench = (
  points: Array<[number, number]>,
  cpu = "Apple M4 Max",
): JsonReport["bench"] =>
  ({
    decodeTokPerSec: { median: 44, min: 43, max: 45, samples: [44] },
    ttftMs: { median: 255, min: 254, max: 258, samples: [255] },
    prefillTokPerSec: { median: 236, min: 235, max: 241, samples: [236] },
    prefillPromptTokens: 2042,
    speculative: null,
    prefixCache: null,
    batching: null,
    loadDrift: null,
    machine: { platform: "darwin", arch: "arm64", cpu, memGB: 128 },
    contextScaling: points.map(([inputTokens, decodeTokPerSec]) => ({
      targetTokens: inputTokens,
      inputTokens,
      decodeTokPerSec,
      ttftMs: 100,
      prefillTokPerSec: 200,
      speculative: null,
      runs: 1,
      note: null,
    })),
  }) as JsonReport["bench"];

describe("renderComparisonHtml", () => {
  test("renders the interactive model-picker workbench", () => {
    const html = renderComparisonHtml([
      { label: "alpha", report: report({ target: { baseUrl: "http://a", model: "alpha-model" } }) },
      { label: "beta", report: report({ target: { baseUrl: "http://b", model: "beta-model" } }) },
    ]);

    expect(html).toContain("compare-pickers");
    expect(html).toContain("compare-sticky");
    expect(html).toContain("__COMPARE__");
    expect(html).toContain("data-theme-select");
    expect(html).toContain('href="index.html"');
    expect(html).toContain("Library");
    expect(html).toContain("alpha-model");
    expect(html).toContain("beta-model");
    expect(html).toContain("Select model A");
  });
});

describe("renderBenchmarkComparisonHtml", () => {
  test("overlays one series per run and keeps every rung's own token count", () => {
    // Two runs that never land on the same x. A category axis would stack them
    // as if 506 and 540 were the same size; the numeric log axis keeps them apart.
    const html = renderBenchmarkComparisonHtml([
      { label: "A", report: report({ bench: bench([[506, 53.8]]) }) },
      { label: "B", report: report({ bench: bench([[540, 31.2]]) }) },
    ]);

    expect(html).toContain('id="cmp-decode"');
    expect(html).toContain("logarithmic");
    expect(html).toContain('{"x":506,"y":53.8}');
    expect(html).toContain('{"x":540,"y":31.2}');
    // Distinct colours, not one hue: these are separate series.
    expect(html).toContain("#0072B2");
    expect(html).toContain("#E69F00");
  });

  test("a rung only one run reached shows as missing, never as zero", () => {
    const html = renderBenchmarkComparisonHtml([
      {
        label: "A",
        report: report({
          bench: bench([
            [512, 50],
            [65536, 28],
          ]),
        }),
      },
      { label: "B", report: report({ bench: bench([[512, 40]]) }) },
    ]);

    // The 64k row exists (A reached it) with B absent rather than plotted at 0.
    expect(html).toContain("~65.5k");
    expect(html).toContain("n/a");
    expect(html).not.toContain('{"x":65536,"y":0}');
  });

  test("different machines invalidate the timings, and the page says so", () => {
    const html = renderBenchmarkComparisonHtml([
      { label: "A", report: report({ bench: bench([[512, 50]]) }) },
      {
        label: "B",
        report: report({ bench: bench([[512, 40]], "AMD EPYC 9354") }),
      },
    ]);
    expect(html).toMatch(/different machines/i);
  });

  test("one machine throughout is stated rather than left to be assumed", () => {
    const html = renderBenchmarkComparisonHtml([
      { label: "A", report: report({ bench: bench([[512, 50]]) }) },
      { label: "B", report: report({ bench: bench([[512, 40]]) }) },
    ]);
    expect(html).toMatch(/All runs measured on Apple M4 Max/);
    expect(html).not.toMatch(/different machines/i);
  });

  test("runs with no benchmark still compare on the scored cards", () => {
    // --compare must not require --bench: coverage and conformance are the
    // hardware-independent half and are worth comparing on their own.
    const html = renderBenchmarkComparisonHtml([
      { label: "A", report: report() },
      { label: "B", report: report() },
    ]);
    expect(html).toContain("Scorecard");
    expect(html).toMatch(/re-run with/i);
    expect(html).not.toContain('id="cmp-decode"');
  });

  test("ranks each row, and never on colour alone", () => {
    const html = renderBenchmarkComparisonHtml([
      { label: "A", report: report({ bench: bench([[512, 50]]) }) },
      {
        label: "B",
        report: report({
          conformance: {
            pct: 91,
            passed: 9,
            total: 10,
            bySurface: [],
            results: [],
          },
          bench: bench([[512, 40]]),
        }),
      },
    ]);

    expect(html).toContain('class="cell best"');
    expect(html).toContain('class="cell worst"');
    // A glyph accompanies every marked cell, so rank survives greyscale
    // printing and the two hues being indistinguishable to the reader.
    expect(html).toContain("▲");
    expect(html).toContain("▼");
  });

  test("rows where every run agrees read as tied, not as a winner", () => {
    const html = renderBenchmarkComparisonHtml([
      { label: "A", report: report({ bench: bench([[512, 44]]) }) },
      { label: "B", report: report({ bench: bench([[512, 44]]) }) },
    ]);
    expect(html).toContain('class="cell tied"');
    expect(html).toContain("tied at");
    expect(html).not.toContain('class="cell best"');
  });

  test("lower-is-better rows rank the other way round", () => {
    // TTFT: the smaller number wins, and the gap reads as "slower".
    const fast = report({ bench: bench([[512, 44]]) });
    const slow = report({ bench: bench([[512, 44]]) });
    slow.bench!.ttftMs = { median: 510, min: 500, max: 520, samples: [510] };

    const html = renderBenchmarkComparisonHtml([
      { label: "A", report: fast },
      { label: "B", report: slow },
    ]);
    expect(html).toMatch(/510 ms vs best 255 ms[^"]*100% slower/);
  });

  test("a hover on every score says why, and on every label says what", () => {
    const html = renderBenchmarkComparisonHtml([
      { label: "A", report: report({ bench: bench([[512, 50]]) }) },
      { label: "B", report: report({ bench: bench([[512, 40]]) }) },
    ]);
    // What the metric is...
    expect(html).toMatch(/data-tip="[^"]*MUST assertions passed/);
    // ...and the evidence behind this run's number.
    expect(html).toMatch(/data-tip="[^"]*median of 1 runs/);
  });

  test("verdict rows are ranked but never given an invented percentage", () => {
    // "none" scores 1 and "active" scores 2 only so they sort. Reporting that
    // as "50% lower" would be a number nobody measured.
    const a = report({ bench: bench([[512, 44]]) });
    const b = report({ bench: bench([[512, 44]]) });
    a.bench!.prefixCache = {
      coldTtftMs: 7124,
      warmTtftMs: 247,
      speedup: 28.8,
      cachedTokens: 1510,
      promptTokens: 1541,
      verdict: "active",
    };
    b.bench!.prefixCache = {
      coldTtftMs: 6900,
      warmTtftMs: 6710,
      speedup: 1,
      cachedTokens: 0,
      promptTokens: 1541,
      verdict: "none",
    };

    const html = renderBenchmarkComparisonHtml([
      { label: "A", report: a },
      { label: "B", report: b },
    ]);
    expect(html).toMatch(/none vs best active/);
    expect(html).not.toMatch(/none vs best active[^"]*% lower/);
  });

  test("a --bench-only report reads as unmeasured, never as 0% conformance", () => {
    // Those phases were skipped, not failed. Ranking a skipped card against a
    // real one would hand the win to whoever happened to run more of the suite.
    const benchOnly = report({ bench: bench([[512, 44]]) });
    benchOnly.conformance = {
      pct: 0,
      passed: 0,
      total: 0,
      bySurface: [],
      results: [],
    };
    benchOnly.capability = {
      pct: 0,
      verdict: "below-floor",
      categories: [],
      weakCategories: [],
      evals: [],
    } as JsonReport["capability"];

    const html = renderBenchmarkComparisonHtml([
      { label: "full", report: report({ bench: bench([[512, 50]]) }) },
      { label: "bench-only", report: benchOnly },
    ]);

    expect(html).toMatch(/not run — this report has no conformance phase/);
    // The full run is not crowned over a card the other never attempted.
    expect(html).not.toMatch(/0% vs best 100%/);
  });

  test("a hostile model name cannot break out of the markup", () => {
    const html = renderBenchmarkComparisonHtml([
      { label: "</script><b>bad", report: report() },
      { label: "B", report: report() },
    ]);
    expect(html).not.toContain("</script><b>bad");
  });
});
