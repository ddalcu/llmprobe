import {
  type CapabilityScore,
  type CategoryScore,
  type ConformanceResult,
  type ConformanceScore,
  type CoverageEntry,
  type CoverageScore,
  type CreditEntry,
  type EvalCategory,
  type EvalResult,
  REQUIRED_EVAL_CATEGORIES,
  SEMI_CAPABLE_CATEGORY_FLOOR_PCT,
  SEMI_CAPABLE_OVERALL_PCT,
  type SurfaceConformance,
  type TierCoverage,
  TIERS,
} from "./outcome";

/** Percentage to one decimal. An empty denominator is 0, never NaN. */
function pct(passed: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((passed / total) * 1000) / 10;
}

/**
 * Coverage — how much of the standard surface exists. Scored per tier and
 * never blended: "Core 100% / Extended 40% / Frontier 0%" is the true story
 * about llama.cpp, and a single averaged number would hide it.
 */
export function scoreCoverage(
  entries: CoverageEntry[],
  credits: CreditEntry[],
): CoverageScore {
  const byTier: TierCoverage[] = TIERS.map((tier) => {
    const inTier = entries.filter((e) => e.item.tier === tier);

    // "We didn't look" is not "it isn't there". Anything this run never checked
    // leaves the denominator rather than being scored as absent.
    const probed = inTier.filter((e) => e.probed !== false);
    const supported = probed.filter((e) => e.supported);

    return {
      tier,
      supported: supported.length,
      total: probed.length,
      pct: pct(supported.length, probed.length),
      missing: probed.filter((e) => !e.supported).map((e) => e.item.label),
      unprobed: inTier
        .filter((e) => e.probed === false)
        .map((e) => e.item.label),
    };
  });

  return { byTier, credits };
}

/**
 * Conformance — of what's implemented, how correct is it?
 *
 * Only MUST assertions score. `unsupported` and `skipped` results never ran, so
 * they leave the denominator alone (they cost Coverage instead). `inconclusive`
 * results are the load-bearing case: the engine path was never exercised
 * because the model wouldn't cooperate, so counting them either way would be a
 * lie. They come out of the denominator and get reported on their own.
 */
export function scoreConformance(
  results: ConformanceResult[],
): ConformanceScore {
  const exercised = results.filter(
    (r) => r.outcome === "pass" || r.outcome === "fail",
  );

  const bySurfaceMap = new Map<string, { passed: number; total: number }>();
  let passed = 0;
  let total = 0;

  for (const result of exercised) {
    const tally = bySurfaceMap.get(result.surface) ?? { passed: 0, total: 0 };

    for (const a of result.assertions) {
      if (a.severity !== "MUST") continue;
      tally.total += 1;
      total += 1;
      if (a.passed) {
        tally.passed += 1;
        passed += 1;
      }
    }

    bySurfaceMap.set(result.surface, tally);
  }

  const bySurface: SurfaceConformance[] = [...bySurfaceMap].map(
    ([surface, t]) => ({
      surface,
      passed: t.passed,
      total: t.total,
      pct: pct(t.passed, t.total),
    }),
  );

  const failedOfSeverity = (severity: "SHOULD" | "MAY") =>
    exercised.flatMap((r) =>
      r.assertions.filter((a) => a.severity === severity && !a.passed),
    );

  return {
    bySurface,
    passed,
    total,
    pct: pct(passed, total),
    inconclusive: results.filter((r) => r.outcome === "inconclusive"),
    warnings: failedOfSeverity("SHOULD"),
    nits: failedOfSeverity("MAY"),
  };
}

/**
 * Capability — is the model semi-capable? A floor check, not an intelligence
 * benchmark.
 *
 * Scores *samples*, not items. Tool and JSON evals run at k=3, so a model that
 * picks the right tool two times in three scores 66.7% rather than a misleading
 * pass or fail — that flakiness is the most useful single fact about a local
 * model, and item-level scoring would erase it.
 */
export function scoreCapability(results: EvalResult[]): CapabilityScore {
  // An eval that never ran (its surface isn't implemented) says nothing about
  // the model, so it is excluded rather than counted as a failure.
  const ran = results.filter((r) => !r.outcome && r.samples.length > 0);

  const byCategory = new Map<EvalCategory, { passed: number; total: number }>();
  for (const result of ran) {
    const tally = byCategory.get(result.category) ?? { passed: 0, total: 0 };
    tally.passed += result.samples.filter((s) => s.passed).length;
    tally.total += result.samples.length;
    byCategory.set(result.category, tally);
  }

  const categories: CategoryScore[] = [...byCategory].map(([category, t]) => ({
    category,
    passed: t.passed,
    total: t.total,
    pct: pct(t.passed, t.total),
  }));

  const passed = categories.reduce((acc, c) => acc + c.passed, 0);
  const total = categories.reduce((acc, c) => acc + c.total, 0);
  const overallPct = pct(passed, total);

  const weakCategories = categories
    .filter((c) => c.pct < SEMI_CAPABLE_CATEGORY_FLOOR_PCT)
    .map((c) => c.category);

  // A required category that produced no samples was never measured — usually
  // because the engine refused the request (a model whose chat template cannot
  // do tools makes every tool call 400). Dropping it silently would *reward*
  // the model for being unable to try, which is precisely backwards.
  const measured = new Set(categories.map((c) => c.category));
  const unmeasured = REQUIRED_EVAL_CATEGORIES.filter((c) => !measured.has(c));

  return {
    categories,
    passed,
    total,
    pct: overallPct,
    // Three gates. A high overall cannot buy its way past a floored category —
    // a model that calls tools when it shouldn't is disqualifying however good
    // the rest looks — nor past a category we never got to measure at all.
    semiCapable:
      total > 0 &&
      overallPct >= SEMI_CAPABLE_OVERALL_PCT &&
      weakCategories.length === 0 &&
      unmeasured.length === 0,
    weakCategories,
    unmeasured,
  };
}
