import type {
  ConformanceResult,
  CoverageEntry,
  EvalResult,
  EvalCategory,
  RunReport,
} from "../outcome";

export type ReportPhase =
  | "measured"
  | "partial"
  | "not-run"
  | "unavailable"
  | "interrupted"
  | "failed";

export interface ReportRunScope {
  depth: "quick" | "default" | "full";
  mode: "probe" | "bench-only";
  startedAt: string;
  phases: Record<
    | "coverage"
    | "conformance"
    | "capability"
    | "agentic"
    | "fidelity"
    | "performance",
    { status: ReportPhase; reason?: string }
  >;
  budget?: { limitTokens?: number; exhausted: boolean };
}

/**
 * The stable machine-readable shape. This doubles as the baseline format, so
 * changing it breaks regression diffing against previously committed runs —
 * treat it as an interface, not an implementation detail.
 */
export interface JsonReport {
  /** v1 reports remain readable; writers emit v2. */
  version: 1 | 2;
  run?: ReportRunScope;
  target: RunReport["target"];
  /** Set when the target died mid-run; every score below is partial. */
  incomplete?: string;
  coverage: {
    byTier: RunReport["coverage"]["byTier"];
    credits: RunReport["coverage"]["credits"];
    entries: Array<{
      id: string;
      label?: string;
      kind?: string;
      tier: string;
      supported: boolean;
      probed?: boolean;
      detail?: string;
    }>;
  };
  conformance: {
    pct: number;
    passed: number;
    total: number;
    bySurface: RunReport["conformance"]["bySurface"];
    inconclusive?: Array<{ id: string; name?: string; reason?: string }>;
    warnings?: Array<{ id: string; label?: string; message?: string }>;
    nits?: Array<{ id: string; label?: string; message?: string }>;
    results: Array<{
      id: string;
      name?: string;
      surface: string;
      outcome: string;
      reason?: string;
      /** Wall clock for this test, so a slow one is findable after the fact. */
      durationMs?: number;
      failures: Array<{
        id: string;
        label?: string;
        severity: string;
        message?: string;
      }>;
    }>;
  };
  capability: {
    pct: number;
    verdict: RunReport["capability"]["verdict"];
    categories: RunReport["capability"]["categories"];
    weakCategories: RunReport["capability"]["weakCategories"];
    unmeasured?: EvalCategory[];
    evals: Array<{
      id: string;
      name?: string;
      category: string;
      passed: number;
      total: number;
      outcome?: string;
      failures?: string[];
    }>;
  };
  /** Agentic card; present unless --quick, no tools, or the budget ran out. */
  agentic?: RunReport["agentic"];
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
    run?: ReportRunScope;
  },
): JsonReport {
  return {
    version: 2,
    run: details.run,
    target: report.target,
    ...(report.incomplete ? { incomplete: report.incomplete } : {}),
    coverage: {
      byTier: report.coverage.byTier,
      credits: report.coverage.credits,
      entries: details.entries.map((e) => ({
        id: e.item.id,
        label: e.item.label,
        kind: e.item.kind,
        tier: e.item.tier,
        supported: e.supported,
        probed: e.probed,
        detail: e.detail,
      })),
    },
    conformance: {
      pct: report.conformance.pct,
      passed: report.conformance.passed,
      total: report.conformance.total,
      bySurface: report.conformance.bySurface,
      inconclusive: report.conformance.inconclusive.map((result) => ({
        id: result.id,
        name: result.name,
        reason: result.reason,
      })),
      warnings: report.conformance.warnings.map((assertion) => ({
        id: assertion.id,
        label: assertion.label,
        message: assertion.message,
      })),
      nits: report.conformance.nits.map((assertion) => ({
        id: assertion.id,
        label: assertion.label,
        message: assertion.message,
      })),
      results: details.conformance.map((r) => ({
        id: r.id,
        name: r.name,
        surface: r.surface,
        outcome: r.outcome,
        reason: r.reason,
        durationMs: r.durationMs,
        failures: r.assertions
          .filter((a) => !a.passed)
          .map((a) => ({
            id: a.id,
            label: a.label,
            severity: a.severity,
            message: a.message,
          })),
      })),
    },
    capability: {
      pct: report.capability.pct,
      verdict: report.capability.verdict,
      categories: report.capability.categories,
      weakCategories: report.capability.weakCategories,
      unmeasured: report.capability.unmeasured,
      evals: details.evals.map((e) => ({
        id: e.id,
        name: e.name,
        category: e.category,
        passed: e.samples.filter((s) => s.passed).length,
        total: e.samples.length,
        outcome: e.outcome,
        failures: e.samples
          .filter((s) => !s.passed && s.message)
          .map((s) => s.message!),
      })),
    },
    agentic: report.agentic,
    fidelity: report.fidelity,
    bench: report.bench,
    usage: report.usage,
    durationMs: report.durationMs,
  };
}

/**
 * Normalize reports written before the dashboard scope metadata existed.
 * Unknown v1 facts stay unknown; they are never promoted to "measured".
 */
export function normalizeJsonReport(input: JsonReport): JsonReport {
  if (input.version === 2 && input.run) return input;

  const hasCapability = input.capability.categories.length > 0;
  const hasConformance = input.conformance.total > 0;
  const hasBench = Boolean(input.bench);
  const startedAt = new Date().toISOString();
  const phase = (
    status: ReportPhase,
    reason?: string,
  ): { status: ReportPhase; reason?: string } => ({ status, reason });

  return {
    ...input,
    version: 2,
    run: {
      depth: "default",
      mode: "probe",
      startedAt,
      phases: {
        coverage: phase("measured", "v1 did not record probe depth"),
        conformance: phase(
          hasConformance ? "measured" : "not-run",
          hasConformance
            ? "v1 did not record probe depth"
            : "no conformance results",
        ),
        capability: phase(
          hasCapability ? "measured" : "not-run",
          hasCapability
            ? "v1 did not record probe depth"
            : "no capability evals",
        ),
        agentic: phase(
          input.agentic ? "measured" : "not-run",
          input.agentic ? undefined : "not present in v1 report",
        ),
        fidelity: phase(
          input.fidelity ? "measured" : "not-run",
          input.fidelity ? undefined : "not present in v1 report",
        ),
        performance: phase(
          hasBench ? "measured" : "not-run",
          hasBench ? undefined : "benchmark not run",
        ),
      },
    },
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
