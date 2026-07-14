/**
 * Core result vocabulary for llmprobe.
 *
 * The suite answers two independent questions in one run — "how complete and
 * correct is this engine?" and "is this model semi-capable?" — and the types
 * here keep those axes from contaminating each other. A weak model must never
 * be able to move the engine score, and a strong one must never rescue it.
 */

/**
 * Standards tiers. Coverage is scored per-tier and never blended into a single
 * number: an engine that nails Core but ships no Responses/Messages should read
 * as exactly that, not as a mushy 60%.
 */
export type Tier = "core" | "extended" | "frontier";

export const TIERS: Tier[] = ["core", "extended", "frontier"];

/**
 * Assertion severity. Only MUST failures drive the conformance score — a
 * missing `system_fingerprint` breaks nobody, a corrupted tool-call argument
 * breaks everybody, and one number cannot represent both.
 */
export type Severity = "MUST" | "SHOULD" | "MAY";

export type Outcome =
  | "pass"
  | "fail"
  /** Not implemented. Costs Coverage; excluded from the Conformance denominator. */
  | "unsupported"
  /**
   * The engine path was never exercised because the model wouldn't cooperate
   * (e.g. we cannot check `tool_calls` serialization if the model never emitted
   * a tool call). Excluded from Conformance and printed loudly — never a silent
   * pass, never an unfair fail.
   */
  | "inconclusive"
  /** Not run at this depth (--quick skips the slow tests). */
  | "skipped";

export type CapabilityKind = "surface" | "feature";

/** One scoreable line in the coverage matrix — an endpoint or a feature. */
export interface CapabilityItem {
  id: string;
  label: string;
  kind: CapabilityKind;
  tier: Tier;
}

export interface CoverageEntry {
  item: CapabilityItem;
  supported: boolean;
  /** e.g. "404 at /v1/audio/speech", or "accepted `logprobs` but returned none". */
  detail?: string;
  /**
   * False when this run never checked (e.g. `--quick` skips the test that would
   * have detected it). Unprobed items leave the Coverage denominator entirely:
   * "we didn't look" is not the same claim as "it isn't there", and reporting
   * the second when we mean the first would slander a perfectly good engine.
   */
  probed?: boolean;
}

/**
 * Detected, shown, and deliberately worth zero points — Ollama's native
 * `/api/chat`. The report stays honest about what the server does without
 * rewarding a non-standard surface.
 */
export interface CreditEntry {
  id: string;
  label: string;
  detail?: string;
}

export interface AssertionResult {
  id: string;
  label: string;
  severity: Severity;
  passed: boolean;
  message?: string;
}

export interface ConformanceResult {
  id: string;
  name: string;
  /** Surface id — conformance is reported per surface. */
  surface: string;
  outcome: Outcome;
  assertions: AssertionResult[];
  /** Why the path was never exercised, when `outcome` is "inconclusive". */
  reason?: string;
  durationMs?: number;
}

export type EvalCategory =
  | "tool-selection"
  | "tool-restraint"
  | "tool-args"
  | "multiturn"
  | "instructions"
  | "json-discipline"
  | "long-context"
  | "reasoning"
  | "knowledge";

export interface EvalSample {
  passed: boolean;
  message?: string;
}

/**
 * One eval item, run `k` times. Tool and JSON items use k=3: a model that gets
 * tool calls right 60% of the time is the single most useful fact about it, and
 * a single sample hides that entirely.
 */
export interface EvalResult {
  id: string;
  name: string;
  category: EvalCategory;
  samples: EvalSample[];
  /** Set when the surface/feature the eval needs isn't implemented. */
  outcome?: Extract<Outcome, "unsupported" | "skipped">;
}

// ── Scores ──────────────────────────────────────────────────────────────────

export interface TierCoverage {
  tier: Tier;
  supported: number;
  /** Probed items only — never counts things this run didn't look at. */
  total: number;
  pct: number;
  /** Labels of the unsupported items, for the "✗ logprobs ✗ reasoning" line. */
  missing: string[];
  /** Labels of items this run never checked (see `CoverageEntry.probed`). */
  unprobed: string[];
}

export interface CoverageScore {
  byTier: TierCoverage[];
  credits: CreditEntry[];
}

export interface SurfaceConformance {
  surface: string;
  passed: number;
  total: number;
  pct: number;
}

export interface ConformanceScore {
  bySurface: SurfaceConformance[];
  /** MUST assertions only, across surfaces that were actually exercised. */
  passed: number;
  total: number;
  pct: number;
  inconclusive: ConformanceResult[];
  /** Failed SHOULD assertions — printed below the score, not counted in it. */
  warnings: AssertionResult[];
  /** Failed MAY assertions — nits. */
  nits: AssertionResult[];
}

export interface CategoryScore {
  category: EvalCategory;
  /** Passing samples, not passing items — flaky tool calling scores partially. */
  passed: number;
  total: number;
  pct: number;
}

export interface CapabilityScore {
  categories: CategoryScore[];
  passed: number;
  total: number;
  pct: number;
  semiCapable: boolean;
  /** Categories below the floor — one reason `semiCapable` is false. */
  weakCategories: EvalCategory[];
  /**
   * Required categories that never ran at all — the other reason.
   *
   * Found the hard way: a 2B model whose chat template cannot do tools made the
   * engine reject every tool request, so all three tool categories silently
   * *vanished* from the card and the model was certified "semi-capable" at 100%
   * on the easy half. A category we could not measure must never be scored as
   * absent-and-therefore-fine. We do not know, so we do not certify.
   */
  unmeasured: EvalCategory[];
}

/**
 * Categories that must actually be measured before a model can be called
 * semi-capable. Long-context and knowledge are omitted: the first is skipped
 * below `--full`, and the second is the weakest signal we have.
 */
export const REQUIRED_EVAL_CATEGORIES: EvalCategory[] = [
  "tool-selection",
  "tool-restraint",
  "tool-args",
  "multiturn",
  "instructions",
  "json-discipline",
  "reasoning",
];

/**
 * The bar for "semi-capable". Deliberately a floor check, not an intelligence
 * benchmark: a 12B-class model (Gemma-12B, Qwen-9B+) should clear it. Tuned
 * against real runs in Phase 4 rather than guessed.
 */
export const SEMI_CAPABLE_OVERALL_PCT = 70;
export const SEMI_CAPABLE_CATEGORY_FLOOR_PCT = 50;

export interface RunTarget {
  baseUrl: string;
  model: string;
  /** Best-effort engine identification, when the server reveals it. */
  engine?: string;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Performance numbers — informational, never scored, never touching the exit
 * code. A slow engine is not a non-conformant one; this section answers "how
 * fast", which is a different question from "how correct" and "how complete".
 */
export interface BenchStat {
  median: number;
  min: number;
  max: number;
  samples: number[];
}

export interface SpeculativeResult {
  predictableTokPerSec: number;
  novelTokPerSec: number;
  ratio: number;
  verdict: "effective" | "marginal" | "none";
  /**
   * True when the model thinks before answering. A reasoning model's "repeat
   * this" still triggers a novel thinking phase, which dilutes the speculative
   * signal — so the ratio understates real gains and gets flagged, not hidden.
   */
  reasoningCaveat: boolean;
}

/** One rung of the context-length ladder — how the engine does at this size. */
export interface ContextPoint {
  /** The size we aimed for (0.5k / 4k / 8k / 16k). */
  targetTokens: number;
  /** What the engine actually reported ingesting — the honest x-axis. */
  inputTokens: number | null;
  decodeTokPerSec: number | null;
  ttftMs: number | null;
}

export interface BenchReport {
  /** Steady-state decode throughput, tokens/sec. */
  decodeTokPerSec: BenchStat | null;
  /** Time to first generated token, ms. */
  ttftMs: BenchStat | null;
  /** Prompt ingestion rate, tokens/sec, from a deliberately long prompt. */
  prefillTokPerSec: BenchStat | null;
  prefillPromptTokens: number | null;
  /** MTP / speculative-decoding effectiveness, or null if not probed. */
  speculative: SpeculativeResult | null;
  /**
   * Decode throughput and latency as context grows. The interesting shape:
   * decode slows as the KV cache grows, and some engines fall off a cliff while
   * others degrade gracefully.
   */
  contextScaling: ContextPoint[] | null;
}

export interface RunReport {
  target: RunTarget;
  coverage: CoverageScore;
  conformance: ConformanceScore;
  capability: CapabilityScore;
  bench?: BenchReport;
  usage?: UsageTotals;
  durationMs: number;
}
