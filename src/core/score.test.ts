import { describe, expect, test } from "vitest";

import type {
  AssertionResult,
  CapabilityItem,
  ConformanceResult,
  CoverageEntry,
  EvalResult,
  Severity,
  Tier,
} from "./outcome";
import { scoreCapability, scoreConformance, scoreCoverage } from "./score";

// ── builders ────────────────────────────────────────────────────────────────

function item(id: string, tier: Tier): CapabilityItem {
  return { id, label: id, kind: "feature", tier };
}

function entry(id: string, tier: Tier, supported: boolean): CoverageEntry {
  return { item: item(id, tier), supported };
}

function assertion(
  severity: Severity,
  passed: boolean,
  id = `${severity}-${passed}`,
): AssertionResult {
  return { id, label: id, severity, passed };
}

function conformance(
  surface: string,
  outcome: ConformanceResult["outcome"],
  assertions: AssertionResult[],
  id = `${surface}-${outcome}`,
): ConformanceResult {
  return { id, name: id, surface, outcome, assertions };
}

function evalResult(
  category: EvalResult["category"],
  samples: boolean[],
  id: string = category,
): EvalResult {
  return {
    id,
    name: id,
    category,
    samples: samples.map((passed) => ({ passed })),
  };
}

// ── coverage ────────────────────────────────────────────────────────────────

describe("scoreCoverage", () => {
  test("scores each tier independently and never blends them", () => {
    const score = scoreCoverage(
      [
        entry("models", "core", true),
        entry("chat", "core", true),
        entry("responses", "extended", true),
        entry("messages", "extended", false),
        entry("logprobs", "extended", false),
        entry("audio", "frontier", false),
      ],
      [],
    );

    const core = score.byTier.find((t) => t.tier === "core")!;
    const extended = score.byTier.find((t) => t.tier === "extended")!;
    const frontier = score.byTier.find((t) => t.tier === "frontier")!;

    expect(core).toMatchObject({ supported: 2, total: 2, pct: 100 });
    expect(extended).toMatchObject({ supported: 1, total: 3, pct: 33.3 });
    expect(frontier).toMatchObject({ supported: 0, total: 1, pct: 0 });
  });

  test("lists what's missing, so the report can name names", () => {
    const score = scoreCoverage(
      [
        entry("responses", "extended", true),
        entry("logprobs", "extended", false),
        entry("reasoning", "extended", false),
      ],
      [],
    );

    const extended = score.byTier.find((t) => t.tier === "extended")!;
    expect(extended.missing).toEqual(["logprobs", "reasoning"]);
  });

  test("always emits all three tiers, even when a tier has no entries", () => {
    const score = scoreCoverage([entry("chat", "core", true)], []);
    expect(score.byTier.map((t) => t.tier)).toEqual([
      "core",
      "extended",
      "frontier",
    ]);
  });

  test("passes credits through unscored — Ollama's native API earns zero points", () => {
    const score = scoreCoverage(
      [entry("chat", "core", true)],
      [{ id: "ollama-native", label: "Ollama native /api/chat" }],
    );

    expect(score.credits).toHaveLength(1);
    const core = score.byTier.find((t) => t.tier === "core")!;
    expect(core).toMatchObject({ supported: 1, total: 1 });
  });
});

// ── conformance ─────────────────────────────────────────────────────────────

describe("scoreConformance", () => {
  test("scores MUST assertions only; SHOULD and MAY fall out to warnings/nits", () => {
    const score = scoreConformance([
      conformance("chat", "fail", [
        assertion("MUST", true, "must-ok"),
        assertion("MUST", false, "must-bad"),
        assertion("SHOULD", false, "should-bad"),
        assertion("MAY", false, "may-bad"),
      ]),
    ]);

    expect(score).toMatchObject({ passed: 1, total: 2, pct: 50 });
    expect(score.warnings.map((w) => w.id)).toEqual(["should-bad"]);
    expect(score.nits.map((n) => n.id)).toEqual(["may-bad"]);
  });

  test("a passing SHOULD is not a warning", () => {
    const score = scoreConformance([
      conformance("chat", "pass", [
        assertion("MUST", true),
        assertion("SHOULD", true),
      ]),
    ]);

    expect(score.warnings).toHaveLength(0);
    expect(score).toMatchObject({ passed: 1, total: 1, pct: 100 });
  });

  test("unsupported and skipped results leave the conformance denominator untouched", () => {
    const score = scoreConformance([
      conformance("chat", "pass", [assertion("MUST", true)]),
      conformance("audio", "unsupported", []),
      conformance("images", "skipped", []),
    ]);

    expect(score).toMatchObject({ passed: 1, total: 1, pct: 100 });
  });

  test("inconclusive results are excluded from the score and surfaced separately", () => {
    // The whole point: a model that won't emit a tool call must not be able to
    // fail the engine, nor silently pass it.
    const score = scoreConformance([
      conformance("chat", "pass", [assertion("MUST", true)]),
      {
        id: "tool-serialization",
        name: "tool_calls serialization",
        surface: "chat",
        outcome: "inconclusive",
        assertions: [assertion("MUST", false, "never-ran")],
        reason: "model never emitted a tool call",
      },
    ]);

    expect(score).toMatchObject({ passed: 1, total: 1, pct: 100 });
    expect(score.inconclusive).toHaveLength(1);
    expect(score.inconclusive[0]!.reason).toBe(
      "model never emitted a tool call",
    );
  });

  test("breaks the score down per surface", () => {
    const score = scoreConformance([
      conformance("chat", "pass", [assertion("MUST", true)], "chat-1"),
      conformance("chat", "pass", [assertion("MUST", true)], "chat-2"),
      conformance("responses", "fail", [assertion("MUST", false)], "resp-1"),
    ]);

    expect(score.bySurface).toEqual([
      { surface: "chat", passed: 2, total: 2, pct: 100 },
      { surface: "responses", passed: 0, total: 1, pct: 0 },
    ]);
  });

  test("an engine with nothing exercised scores 0, not NaN", () => {
    const score = scoreConformance([conformance("audio", "unsupported", [])]);
    expect(score).toMatchObject({ passed: 0, total: 0, pct: 0 });
  });
});

// ── capability ──────────────────────────────────────────────────────────────

describe("scoreCapability", () => {
  test("scores samples, not items — flaky tool calling gets partial credit", () => {
    // Two items at k=3: one perfect, one that works 1 time in 3.
    const score = scoreCapability([
      evalResult("tool-selection", [true, true, true], "a"),
      evalResult("tool-selection", [true, false, false], "b"),
    ]);

    const tools = score.categories.find(
      (c) => c.category === "tool-selection",
    )!;
    expect(tools).toMatchObject({ passed: 4, total: 6, pct: 66.7 });
  });

  test(">=90% overall with every gate cleared grades strong", () => {
    const score = scoreCapability([
      evalResult("tool-selection", [true, true, true]),
      evalResult("tool-restraint", [true, true, true]),
      evalResult("tool-args", [true, true, true]),
      evalResult("multiturn", [true, true]),
      evalResult("instructions", [true, true, true]),
      evalResult("json-discipline", [true, true, true]),
      evalResult("reasoning", [true, true, true]),
      evalResult("knowledge", [true, false]),
    ]);

    expect(score.pct).toBeGreaterThanOrEqual(90);
    expect(score.verdict).toBe("strong");
    expect(score.weakCategories).toEqual([]);
    expect(score.unmeasured).toEqual([]);
  });

  test("70–90% overall with every gate cleared grades capable, not strong", () => {
    const score = scoreCapability([
      evalResult("tool-selection", [true, true, true]),
      evalResult("tool-restraint", [true, true, false]),
      evalResult("tool-args", [true, true, false]),
      evalResult("multiturn", [true, true]),
      evalResult("instructions", [true, true, false]),
      evalResult("json-discipline", [true, true, true]),
      evalResult("reasoning", [true, true, false]),
    ]);

    expect(score.pct).toBeGreaterThanOrEqual(70);
    expect(score.pct).toBeLessThan(90);
    expect(score.verdict).toBe("capable");
  });

  test("a single category below the floor grades below-floor, even at a high overall", () => {
    const score = scoreCapability([
      evalResult("tool-selection", [true, true, true, true, true, true, true]),
      evalResult("json-discipline", [true, true, true]),
      // Small models routinely call a tool when they shouldn't. That's
      // disqualifying no matter how good the rest of the card looks.
      evalResult("tool-restraint", [false, false, true]),
    ]);

    expect(score.pct).toBeGreaterThanOrEqual(70);
    expect(score.weakCategories).toEqual(["tool-restraint"]);
    expect(score.verdict).toBe("below-floor");
  });

  test("a decent-but-not-good card below 70% overall grades below-floor", () => {
    const score = scoreCapability([
      evalResult("tool-selection", [true, false]),
      evalResult("json-discipline", [true, false]),
      evalResult("reasoning", [true, false]),
    ]);

    expect(score.pct).toBe(50);
    expect(score.verdict).toBe("below-floor");
  });

  test("unsupported evals are excluded rather than counted as failures", () => {
    // Vision evals against an engine with no vision support say nothing about
    // the model.
    const score = scoreCapability([
      evalResult("tool-selection", [true, true]),
      { ...evalResult("multiturn", []), outcome: "unsupported" },
    ]);

    expect(score.categories.map((c) => c.category)).toEqual(["tool-selection"]);
    expect(score).toMatchObject({ passed: 2, total: 2, pct: 100 });
  });

  test("no evals at all scores 0 and grades below-floor", () => {
    const score = scoreCapability([]);
    expect(score).toMatchObject({ passed: 0, total: 0, pct: 0 });
    expect(score.verdict).toBe("below-floor");
  });
});

describe("scoreCapability — unmeasured categories", () => {
  test("a model whose tool evals never ran is NOT certified, however well it did elsewhere", () => {
    // Found against a real 2B: its chat template couldn't do tools, so the
    // engine 400'd every tool request, all three tool categories silently
    // vanished from the card, and the model was certified capable at 100% on
    // the easy half. Being unable to attempt a category must never score
    // better than attempting it badly.
    const score = scoreCapability([
      { ...evalResult("multiturn", [true, true]), id: "m" },
      { ...evalResult("instructions", [true, true, true]), id: "i" },
      { ...evalResult("json-discipline", [true, true, true]), id: "j" },
      { ...evalResult("reasoning", [true, true, true]), id: "r" },
      // The engine refused these outright.
      { ...evalResult("tool-selection", []), outcome: "unsupported" as const },
      { ...evalResult("tool-restraint", []), outcome: "unsupported" as const },
      { ...evalResult("tool-args", []), outcome: "unsupported" as const },
    ]);

    expect(score.pct).toBe(100);
    expect(score.weakCategories).toEqual([]);
    expect(score.unmeasured).toEqual([
      "tool-selection",
      "tool-restraint",
      "tool-args",
    ]);
    // 100% and still not certified — because we never saw it try.
    expect(score.verdict).toBe("below-floor");
  });

  test("a full card with every required category measured is certified", () => {
    const score = scoreCapability([
      evalResult("tool-selection", [true, true, true]),
      evalResult("tool-restraint", [true, true, true]),
      evalResult("tool-args", [true, true, true]),
      evalResult("multiturn", [true, true]),
      evalResult("instructions", [true, true, true]),
      evalResult("json-discipline", [true, true, true]),
      evalResult("reasoning", [true, true, true]),
    ]);

    expect(score.unmeasured).toEqual([]);
    expect(score.verdict).not.toBe("below-floor");
  });

  test("long-context and knowledge are not required — --full gates the first", () => {
    const score = scoreCapability([
      evalResult("tool-selection", [true, true, true]),
      evalResult("tool-restraint", [true, true, true]),
      evalResult("tool-args", [true, true, true]),
      evalResult("multiturn", [true, true]),
      evalResult("instructions", [true, true, true]),
      evalResult("json-discipline", [true, true, true]),
      evalResult("reasoning", [true, true, true]),
    ]);

    expect(score.unmeasured).not.toContain("long-context");
    expect(score.unmeasured).not.toContain("knowledge");
    expect(score.verdict).not.toBe("below-floor");
  });
});
