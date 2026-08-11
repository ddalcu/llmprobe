import { Asserter, Inconclusive, Unsupported } from "./assert";
import { BudgetExceededError, TargetUnreachableError } from "./client";
import type { ConformanceTest, EvalDef, RunContext } from "./context";
import type {
  ConformanceResult,
  CoverageEntry,
  EvalResult,
  EvalSample,
} from "./outcome";
import { FEATURES, type SurfaceDef } from "./registry";

/** Feature support as discovered by the tests that exercise each feature. */
export type FeatureSupport = Map<
  string,
  { supported: boolean; detail?: string }
>;

/**
 * How many transport failures in a row mean the target is gone rather than
 * flaky. Two is a blip on a busy box; three is a corpse.
 */
const UNREACHABLE_LIMIT = 3;

export interface UnreachableRun {
  /** The last check the target actually answered. */
  after: string;
  /** Checks abandoned when the run stopped. */
  notRun: number;
  reason: string;
}

export interface ConformanceRun {
  results: ConformanceResult[];
  featureSupport: FeatureSupport;
  /**
   * Set when the run stopped because the target stopped answering. Everything
   * below is partial by definition, and the caller must not chart it as a
   * measurement — the checks after this point never ran.
   */
  unreachable?: UnreachableRun;
  /**
   * Features whose only tests were skipped at this depth. They are *unknown*,
   * not absent — `--quick` must not report an engine as lacking JSON mode
   * merely because it didn't look.
   */
  unprobed: Set<string>;
}

function shouldRun(test: ConformanceTest, depth: RunContext["depth"]): boolean {
  if (depth === "quick") return test.quick === true;
  if (depth === "default") return test.slow !== true;
  return true;
}

export async function runConformance(
  tests: ConformanceTest[],
  ctx: RunContext,
  onProgress?: (result: ConformanceResult) => void,
): Promise<ConformanceRun> {
  const results: ConformanceResult[] = [];
  const featureSupport: FeatureSupport = new Map();
  const skippedFeatures = new Set<string>();
  let consecutiveUnreachable = 0;
  let lastAnswered = "the run start";
  let unreachable: UnreachableRun | undefined;

  const note = (
    feature: string | undefined,
    supported: boolean,
    detail?: string,
  ) => {
    if (!feature) return;
    // First writer wins for a negative: if one test already established the
    // feature is missing, a later test shouldn't quietly upgrade it.
    const existing = featureSupport.get(feature);
    if (existing && !existing.supported) return;
    featureSupport.set(feature, { supported, detail });
  };

  for (const [index, test] of tests.entries()) {
    const started = Date.now();

    const emit = (result: ConformanceResult) => {
      results.push(result);
      onProgress?.(result);
    };

    // The surface itself is missing — the test never runs, and its feature is
    // unsupported by construction. This is the normative bite: no Responses
    // surface means no MCP tools, and both cost Coverage.
    if (!ctx.present.has(test.surface)) {
      note(test.feature, false, `${test.surface} not implemented`);
      emit({
        id: test.id,
        name: test.name,
        surface: test.surface,
        outcome: "unsupported",
        assertions: [],
        reason: `${test.surface} not implemented`,
        durationMs: 0,
      });
      continue;
    }

    if (!shouldRun(test, ctx.depth)) {
      // Record, but do NOT call note() — a skipped test proves nothing either
      // way, and marking the feature unsupported here would turn "we ran in
      // quick mode" into "your engine is missing JSON mode".
      if (test.feature) skippedFeatures.add(test.feature);
      emit({
        id: test.id,
        name: test.name,
        surface: test.surface,
        outcome: "skipped",
        assertions: [],
        reason: `not run at depth "${ctx.depth}"`,
        durationMs: 0,
      });
      continue;
    }

    const asserter = new Asserter();

    // The target answered this one, whatever it said — a run only aborts on
    // failures that are *consecutive*.
    const answered = () => {
      consecutiveUnreachable = 0;
      lastAnswered = test.name;
    };

    try {
      const verdict = (await test.run(ctx, asserter)) ?? {};
      answered();

      // A test may report the feature missing *and* record MUST failures. That
      // is exactly the "accepted the param, silently ignored it" case: it costs
      // Coverage (the feature isn't really there) and Conformance (pretending
      // it is, is a trap for callers).
      if (verdict.featureSupported === false) {
        note(test.feature, false, verdict.unsupportedDetail);
      } else {
        note(test.feature, true);
      }

      const assertions = asserter.results;

      // A clean "we don't support that" with nothing asserted is unsupported,
      // not a failure. Honest rejection is not a conformance bug.
      if (verdict.featureSupported === false && assertions.length === 0) {
        emit({
          id: test.id,
          name: test.name,
          surface: test.surface,
          outcome: "unsupported",
          assertions: [],
          reason: verdict.unsupportedDetail,
          durationMs: Date.now() - started,
        });
        continue;
      }

      emit({
        id: test.id,
        name: test.name,
        surface: test.surface,
        outcome: asserter.failedMust ? "fail" : "pass",
        assertions,
        durationMs: Date.now() - started,
      });
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;

      if (err instanceof Unsupported) {
        answered();
        note(test.feature, false, err.message);
        emit({
          id: test.id,
          name: test.name,
          surface: test.surface,
          outcome: "unsupported",
          assertions: [],
          reason: err.message,
          durationMs: Date.now() - started,
        });
        continue;
      }

      // The engine was never exercised because the model wouldn't cooperate.
      // Scoring this either way would be a lie, so it leaves the denominator.
      if (err instanceof Inconclusive) {
        answered();
        note(test.feature, true);
        emit({
          id: test.id,
          name: test.name,
          surface: test.surface,
          outcome: "inconclusive",
          assertions: asserter.results,
          reason: err.message,
          durationMs: Date.now() - started,
        });
        continue;
      }

      // Nobody answered. Not the engine's verdict and not the model's — there
      // is no measurement here at all, so it scores nothing and the feature is
      // left exactly as unknown as it was.
      if (err instanceof TargetUnreachableError) {
        consecutiveUnreachable += 1;
        // Nothing was learned about this feature. Leaving it out of
        // `featureSupport` is not enough — coverage would then report it as
        // absent, which is the same slander in a different card.
        if (test.feature) skippedFeatures.add(test.feature);
        emit({
          id: test.id,
          name: test.name,
          surface: test.surface,
          outcome: "unreachable",
          assertions: [],
          reason: err.message,
          durationMs: Date.now() - started,
        });

        if (consecutiveUnreachable >= UNREACHABLE_LIMIT) {
          unreachable = {
            after: lastAnswered,
            notRun: tests.length - index - 1,
            reason: err.message,
          };
          for (const remaining of tests.slice(index + 1)) {
            if (remaining.feature) skippedFeatures.add(remaining.feature);
          }
          break;
        }
        continue;
      }

      // Anything else — a throw, a timeout, a malformed body — is on the engine.
      answered();
      asserter.must(
        `${test.id}-threw`,
        test.name,
        false,
        err instanceof Error ? err.message : String(err),
      );
      emit({
        id: test.id,
        name: test.name,
        surface: test.surface,
        outcome: "fail",
        assertions: asserter.results,
        durationMs: Date.now() - started,
      });
    }
  }

  // A feature is only "unprobed" if *no* test resolved it — one surface's test
  // being skipped doesn't matter if another surface's test answered the
  // question.
  const unprobed = new Set(
    [...skippedFeatures].filter((feature) => !featureSupport.has(feature)),
  );

  return { results, featureSupport, unprobed, unreachable };
}

export async function runEvals(
  evals: EvalDef[],
  ctx: RunContext,
  featureSupport: FeatureSupport,
  onProgress?: (result: EvalResult) => void,
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];

  for (const def of evals) {
    const emit = (result: EvalResult) => {
      results.push(result);
      onProgress?.(result);
    };

    // An eval the engine can't host says nothing about the model, so it is
    // excluded rather than counted as a model failure.
    const needed = def.requiresFeature;
    if (needed && featureSupport.get(needed)?.supported !== true) {
      emit({
        id: def.id,
        name: def.name,
        category: def.category,
        samples: [],
        outcome: "unsupported",
      });
      continue;
    }

    if (!ctx.evalSurface) {
      emit({
        id: def.id,
        name: def.name,
        category: def.category,
        samples: [],
        outcome: "unsupported",
      });
      continue;
    }

    if (def.slow && ctx.depth !== "full") {
      emit({
        id: def.id,
        name: def.name,
        category: def.category,
        samples: [],
        outcome: "skipped",
      });
      continue;
    }

    const k = def.k ?? 1;
    const samples: EvalSample[] = [];

    for (let i = 0; i < k; i += 1) {
      try {
        samples.push(await def.run(ctx));
      } catch (err) {
        if (err instanceof BudgetExceededError) throw err;
        // A dead target says nothing about the model. Grading it would print
        // "below floor" for a model that was never asked anything.
        if (err instanceof TargetUnreachableError) throw err;
        // An engine error during an eval is a failed sample for the model's
        // purposes; the engine's own card records the fault separately.
        samples.push({
          passed: false,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    emit({
      id: def.id,
      name: def.name,
      category: def.category,
      samples,
    });
  }

  return results;
}

/**
 * Fold surface probes and discovered feature support into the coverage matrix.
 *
 * A feature whose test never got the chance to run (because its surface is
 * missing) is unsupported — that is the whole normative point.
 */
export function buildCoverageEntries(
  surfaces: SurfaceDef[],
  present: Set<string>,
  featureSupport: FeatureSupport,
  unprobed: Set<string> = new Set(),
): CoverageEntry[] {
  // Surfaces are always probed — discovery runs at every depth, and it's free.
  const entries: CoverageEntry[] = surfaces.map((surface) => ({
    item: {
      id: surface.id,
      label: surface.label,
      kind: "surface" as const,
      tier: surface.tier,
    },
    supported: present.has(surface.id),
    detail: present.has(surface.id) ? undefined : "not implemented",
  }));

  for (const feature of FEATURES) {
    const found = featureSupport.get(feature.id);
    const supported = found?.supported === true;
    const probed = !unprobed.has(feature.id);

    entries.push({
      item: {
        id: feature.id,
        label: feature.label,
        kind: "feature",
        tier: feature.tier,
      },
      supported,
      probed,
      // Nothing ran, so nothing is known: a detail here would read as a
      // finding ("not detected") for a check that was never made.
      detail:
        supported || !probed
          ? undefined
          : (found?.detail ??
            (present.has(feature.surface)
              ? "not detected"
              : `${feature.surface} not implemented`)),
    });
  }

  return entries;
}
