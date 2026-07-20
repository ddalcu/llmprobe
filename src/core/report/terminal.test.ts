import { describe, expect, test } from "bun:test";

import type { RunReport } from "../outcome";
import { renderReport } from "./terminal";

/**
 * A llama.cpp-shaped report: strong Core, patchy Extended, no Frontier — the
 * exact story the tiering exists to tell.
 */
function fixture(overrides: Partial<RunReport> = {}): RunReport {
  return {
    target: {
      baseUrl: "http://localhost:8080/v1",
      model: "gemma-3-12b-it",
      engine: "llama.cpp",
    },
    coverage: {
      byTier: [
        {
          tier: "core",
          supported: 8,
          total: 8,
          pct: 100,
          missing: [],
          unprobed: [],
        },
        {
          tier: "extended",
          supported: 5,
          total: 7,
          pct: 71.4,
          missing: ["logprobs", "reasoning items"],
          unprobed: [],
        },
        {
          tier: "frontier",
          supported: 0,
          total: 4,
          pct: 0,
          missing: ["audio", "images", "MCP tools", "rate limiting"],
          unprobed: [],
        },
      ],
      credits: [
        {
          id: "ollama-native",
          label: "Ollama native /api/chat",
          detail: "detected",
        },
      ],
    },
    conformance: {
      bySurface: [
        { surface: "chat/completions", passed: 142, total: 142, pct: 100 },
        { surface: "responses", passed: 97, total: 99, pct: 98 },
      ],
      passed: 239,
      total: 241,
      pct: 99.2,
      inconclusive: [
        {
          id: "tool-serialization",
          name: "tool_calls serialization",
          surface: "chat/completions",
          outcome: "inconclusive",
          assertions: [],
          reason: "model never emitted a tool call",
        },
      ],
      warnings: [
        {
          id: "system-fingerprint",
          label: "system_fingerprint present",
          severity: "SHOULD",
          passed: false,
          message: "field absent",
        },
      ],
      nits: [],
    },
    capability: {
      categories: [
        { category: "tool-selection", passed: 8, total: 10, pct: 80 },
        { category: "tool-restraint", passed: 6, total: 10, pct: 60 },
        { category: "json-discipline", passed: 10, total: 10, pct: 100 },
      ],
      passed: 24,
      total: 30,
      pct: 80,
      verdict: "capable",
      weakCategories: [],
      unmeasured: [],
    },
    usage: { inputTokens: 120_000, outputTokens: 8_500 },
    durationMs: 252_000,
    ...overrides,
  };
}

const render = (r: RunReport) => renderReport(r, { color: false });

describe("renderReport", () => {
  test("names the target so a pasted report is self-describing", () => {
    const out = render(fixture());
    expect(out).toContain("http://localhost:8080/v1");
    expect(out).toContain("gemma-3-12b-it");
    expect(out).toContain("llama.cpp");
  });

  test("reports coverage per tier and names what is missing", () => {
    const out = render(fixture());
    expect(out).toMatch(/CORE\s+8\/8\s+100%/);
    expect(out).toMatch(/EXTENDED\s+5\/7\s+71\.4%/);
    expect(out).toMatch(/FRONTIER\s+0\/4\s+0%/);
    // Naming names is the whole point — this is the pressure on the engine.
    expect(out).toContain("logprobs");
    expect(out).toContain("reasoning items");
  });

  test("shows detected-but-unscored surfaces as credit, never as points", () => {
    const out = render(fixture());
    expect(out).toContain("Ollama native /api/chat");
    expect(out).toContain("not scored");
  });

  test("keeps the engine and model cards visually separate", () => {
    const out = render(fixture());
    const engineAt = out.indexOf("ENGINE CONFORMANCE");
    const modelAt = out.indexOf("MODEL CAPABILITY");
    expect(engineAt).toBeGreaterThan(-1);
    expect(modelAt).toBeGreaterThan(engineAt);
  });

  test("prints inconclusive results loudly, with the reason", () => {
    const out = render(fixture());
    expect(out).toContain("1 inconclusive");
    expect(out).toContain("model never emitted a tool call");
  });

  test("keeps SHOULD warnings below the score, not inside it", () => {
    const out = render(fixture());
    expect(out).toContain("99.2%");
    expect(out).toContain("system_fingerprint");
    expect(out).toContain("SHOULD");
  });

  test("renders the graded verdict", () => {
    expect(render(fixture())).toContain("capable ✓");
    const strong = fixture();
    strong.capability.verdict = "strong";
    expect(render(strong)).toContain("strong ✓");
  });

  test("a weak model names the category that sank it", () => {
    const weak = fixture({
      capability: {
        categories: [
          { category: "tool-selection", passed: 9, total: 10, pct: 90 },
          { category: "tool-restraint", passed: 2, total: 10, pct: 20 },
        ],
        passed: 11,
        total: 20,
        pct: 55,
        verdict: "below-floor",
        weakCategories: ["tool-restraint"],
        unmeasured: [],
      },
    });
    const out = render(weak);
    expect(out).toContain("Tool restraint");
    expect(out).toContain("below floor ✗");
  });

  test("a weak model leaves the engine card untouched", () => {
    // The core promise of the two-card split: model quality cannot move the
    // engine score.
    const strong = render(fixture());
    const weak = render(
      fixture({
        capability: {
          categories: [
            { category: "tool-selection", passed: 1, total: 10, pct: 10 },
          ],
          passed: 1,
          total: 10,
          pct: 10,
          verdict: "below-floor",
          weakCategories: ["tool-selection"],
          unmeasured: [],
        },
      }),
    );

    const engineSection = (s: string) =>
      s.slice(s.indexOf("ENGINE CONFORMANCE"), s.indexOf("MODEL CAPABILITY"));

    expect(engineSection(weak)).toBe(engineSection(strong));
  });

  test("handles an engine where nothing was exercised without printing NaN", () => {
    const empty = fixture({
      conformance: {
        bySurface: [],
        passed: 0,
        total: 0,
        pct: 0,
        inconclusive: [],
        warnings: [],
        nits: [],
      },
      capability: {
        categories: [],
        passed: 0,
        total: 0,
        pct: 0,
        verdict: "below-floor",
        weakCategories: [],
        unmeasured: [],
      },
    });
    const out = render(empty);
    expect(out).not.toContain("NaN");
    expect(out).toContain("nothing exercised");
  });

  test("emits no ANSI escapes when color is off", () => {
    // eslint-disable-next-line no-control-regex
    expect(render(fixture())).not.toMatch(/\x1b\[/);
  });
});
