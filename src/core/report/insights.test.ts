import { describe, expect, test } from "vitest";

import type { JsonReport } from "./json";
import { buildPerspectiveInsights } from "./insights";

const report = (over: Partial<JsonReport> = {}): JsonReport => ({
  version: 2,
  run: {
    depth: "default",
    mode: "probe",
    startedAt: "2026-08-06T12:00:00.000Z",
    phases: {
      coverage: { status: "measured" },
      conformance: { status: "measured" },
      capability: { status: "measured" },
      agentic: { status: "measured" },
      fidelity: { status: "measured" },
      performance: { status: "not-run", reason: "not requested" },
    },
  },
  target: { baseUrl: "http://localhost/v1", model: "m" },
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
        total: 2,
        pct: 50,
        missing: ["logprobs"],
        unprobed: [],
      },
    ],
    credits: [],
    entries: [],
  },
  conformance: {
    pct: 90,
    passed: 9,
    total: 10,
    bySurface: [],
    inconclusive: [],
    results: [
      {
        id: "chat-logprobs",
        name: "chat logprobs",
        surface: "chat",
        outcome: "fail",
        failures: [
          {
            id: "silent",
            label: "logprobs are not ignored",
            severity: "MUST",
            message: "returned no logprobs",
          },
        ],
      },
    ],
  },
  capability: {
    pct: 78,
    verdict: "capable",
    categories: [{ category: "tool-selection", passed: 6, total: 6, pct: 100 }],
    weakCategories: [],
    unmeasured: ["tool-restraint"],
    evals: [],
  },
  agentic: { tasks: [], passed: 0, total: 0, pct: 0 },
  durationMs: 1,
  ...over,
});

describe("buildPerspectiveInsights", () => {
  test("keeps model, deployment, and engine questions distinct", () => {
    const value = report();
    expect(buildPerspectiveInsights(value, "model").conclusion).toContain(
      "capable",
    );
    expect(buildPerspectiveInsights(value, "deploy").conclusion).toContain(
      "90% of exercised MUST assertions",
    );
    expect(buildPerspectiveInsights(value, "engine").conclusion).toContain(
      "1 exercised MUST violation",
    );
  });

  test("names unmeasured evidence instead of treating it as a failure", () => {
    const findings = buildPerspectiveInsights(report(), "model").findings;
    expect(
      findings.some(
        (finding) => finding.label === "Model categories not measured",
      ),
    ).toBe(true);
    expect(
      findings.some((finding) => finding.label === "Extended coverage gaps"),
    ).toBe(true);
  });
});
