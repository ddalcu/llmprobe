import type {
  ConformanceResult,
  CoverageEntry,
  EvalResult,
  RunReport,
} from "../outcome";

/**
 * The stable machine-readable shape. This doubles as the baseline format, so
 * changing it breaks regression diffing against previously committed runs —
 * treat it as an interface, not an implementation detail.
 */
export interface JsonReport {
  version: 1;
  target: RunReport["target"];
  coverage: {
    byTier: RunReport["coverage"]["byTier"];
    credits: RunReport["coverage"]["credits"];
    entries: Array<{
      id: string;
      tier: string;
      supported: boolean;
      detail?: string;
    }>;
  };
  conformance: {
    pct: number;
    passed: number;
    total: number;
    bySurface: RunReport["conformance"]["bySurface"];
    results: Array<{
      id: string;
      surface: string;
      outcome: string;
      reason?: string;
      failures: Array<{ id: string; severity: string; message?: string }>;
    }>;
  };
  capability: {
    pct: number;
    verdict: RunReport["capability"]["verdict"];
    categories: RunReport["capability"]["categories"];
    weakCategories: RunReport["capability"]["weakCategories"];
    evals: Array<{
      id: string;
      category: string;
      passed: number;
      total: number;
      outcome?: string;
    }>;
  };
  /** Engine-fidelity card; present unless the run was --quick. */
  fidelity?: RunReport["fidelity"];
  /** Informational performance numbers; present only when --bench ran. */
  bench?: RunReport["bench"];
  usage?: RunReport["usage"];
  durationMs: number;
}

export function buildJsonReport(
  report: RunReport,
  details: {
    entries: CoverageEntry[];
    conformance: ConformanceResult[];
    evals: EvalResult[];
  },
): JsonReport {
  return {
    version: 1,
    target: report.target,
    coverage: {
      byTier: report.coverage.byTier,
      credits: report.coverage.credits,
      entries: details.entries.map((e) => ({
        id: e.item.id,
        tier: e.item.tier,
        supported: e.supported,
        detail: e.detail,
      })),
    },
    conformance: {
      pct: report.conformance.pct,
      passed: report.conformance.passed,
      total: report.conformance.total,
      bySurface: report.conformance.bySurface,
      results: details.conformance.map((r) => ({
        id: r.id,
        surface: r.surface,
        outcome: r.outcome,
        reason: r.reason,
        failures: r.assertions
          .filter((a) => !a.passed)
          .map((a) => ({ id: a.id, severity: a.severity, message: a.message })),
      })),
    },
    capability: {
      pct: report.capability.pct,
      verdict: report.capability.verdict,
      categories: report.capability.categories,
      weakCategories: report.capability.weakCategories,
      evals: details.evals.map((e) => ({
        id: e.id,
        category: e.category,
        passed: e.samples.filter((s) => s.passed).length,
        total: e.samples.length,
        outcome: e.outcome,
      })),
    },
    fidelity: report.fidelity,
    bench: report.bench,
    usage: report.usage,
    durationMs: report.durationMs,
  };
}

export interface Regression {
  kind: "coverage" | "conformance";
  id: string;
  before: string;
  after: string;
}

/**
 * Diff a run against a committed baseline. This is what turns llmprobe from a
 * snapshot into a ratchet: "llama.cpp regressed on finish_reason since b4321".
 */
export function diffBaseline(
  baseline: JsonReport,
  current: JsonReport,
): { regressions: Regression[]; improvements: Regression[] } {
  const regressions: Regression[] = [];
  const improvements: Regression[] = [];

  const beforeCoverage = new Map(
    baseline.coverage.entries.map((e) => [e.id, e]),
  );
  for (const entry of current.coverage.entries) {
    const before = beforeCoverage.get(entry.id);
    if (!before) continue;
    if (before.supported && !entry.supported) {
      regressions.push({
        kind: "coverage",
        id: entry.id,
        before: "supported",
        after: entry.detail ?? "unsupported",
      });
    } else if (!before.supported && entry.supported) {
      improvements.push({
        kind: "coverage",
        id: entry.id,
        before: "unsupported",
        after: "supported",
      });
    }
  }

  const beforeTests = new Map(
    baseline.conformance.results.map((r) => [r.id, r]),
  );
  for (const result of current.conformance.results) {
    const before = beforeTests.get(result.id);
    if (!before) continue;
    if (before.outcome === "pass" && result.outcome === "fail") {
      regressions.push({
        kind: "conformance",
        id: result.id,
        before: "pass",
        after: result.failures[0]?.message ?? "fail",
      });
    } else if (before.outcome === "fail" && result.outcome === "pass") {
      improvements.push({
        kind: "conformance",
        id: result.id,
        before: "fail",
        after: "pass",
      });
    }
  }

  return { regressions, improvements };
}
