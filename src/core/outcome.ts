/**
 * Core result vocabulary for llmprobe.
 *
 * The suite answers two independent questions in one run — "how complete and
 * correct is this engine?" and "does this model clear the floor?" — and the types
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
  | "skipped"
  /**
   * The target stopped answering — refused, reset, or hung up. Neither the
   * engine nor the model said anything, so this scores nothing at all: a
   * crashed process must never read as "implements nothing" or as a model that
   * cannot name a chemical symbol.
   */
  | "unreachable";

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

/**
 * The graded verdict. "below-floor" fails any of the three gates; past the
 * gates, the overall percentage picks "capable" or "strong". Deliberately
 * coarse: with 3–6 samples per category, finer tiers would grade noise.
 */
export type CapabilityVerdict = "below-floor" | "capable" | "strong";

export interface CapabilityScore {
  categories: CategoryScore[];
  passed: number;
  total: number;
  pct: number;
  verdict: CapabilityVerdict;
  /** Categories below the floor — one reason `verdict` is "below-floor". */
  weakCategories: EvalCategory[];
  /**
   * Required categories that never ran at all — the other reason.
   *
   * Found the hard way: a 2B model whose chat template cannot do tools made the
   * engine reject every tool request, so all three tool categories silently
   * *vanished* from the card and the model was certified capable at 100% on
   * the easy half. A category we could not measure must never be scored as
   * absent-and-therefore-fine. We do not know, so we do not certify.
   */
  unmeasured: EvalCategory[];
}

/**
 * Categories that must actually be measured before a model can grade above
 * "below-floor". Long-context and knowledge are omitted: the first is skipped
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
 * The tier cuts. "capable" is deliberately a floor check, not an intelligence
 * benchmark: a 12B-class model (Gemma-12B, Qwen-9B+) should clear it. Tuned
 * against real runs in Phase 4 rather than guessed. "strong" is the same
 * gates plus a 90% overall — room at the top without pretending 39 samples
 * can rank models finely.
 */
export const CAPABLE_OVERALL_PCT = 70;
export const STRONG_OVERALL_PCT = 90;
export const CATEGORY_FLOOR_PCT = 50;

/**
 * Agentic — multi-step tool use against a simulated file workspace. The
 * capability card is a floor check; this card is deliberately above it, and
 * the two are never blended: a model can be perfectly usable (capable) and
 * still fail every agentic task, and that should read as exactly that.
 *
 * Why a workspace and not a real sandbox: the tools are executed in-process
 * by llmprobe itself, so grading is a string comparison on the final state —
 * deterministic, no judge, no code execution, and a task costs a handful of
 * short requests.
 */
export type AgenticFailure =
  /** Finished (stopped calling tools) but the answer or file state is wrong. */
  | "wrong-answer"
  /** Answered without ever touching a tool — priors instead of the workspace. */
  | "no-tool-call"
  /** Still calling tools when the step cap ran out. */
  | "step-limit"
  /** The engine errored mid-task; says nothing good about either party. */
  | "engine-error";

export interface AgenticTaskResult {
  id: string;
  name: string;
  passed: boolean;
  /** Model requests used — the report shows this next to each task. */
  steps: number;
  failure?: AgenticFailure;
  detail?: string;
}

export interface AgenticScore {
  tasks: AgenticTaskResult[];
  /** Whole tasks, pass/fail — with 3 tasks, sample-level pcts would be noise. */
  passed: number;
  total: number;
  pct: number;
}

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
   * Tokens per decode step on the predictable prompt, read off SSE frame
   * arrival gaps. Independent of the ratio and of any second request: ~1 means
   * one token per step, above that means drafts are landing.
   */
  tokensPerStep: number | null;
  /** Why there is no tokens-per-step number — buffered stream, no usage, etc. */
  tokensPerStepNote: string | null;
  /**
   * True when the model thinks before answering. A reasoning model's "repeat
   * this" still triggers a novel thinking phase, which dilutes the speculative
   * signal — so the ratio understates real gains and gets flagged, not hidden.
   */
  reasoningCaveat: boolean;
}

/**
 * Did the machine hold its speed for the length of the run?
 *
 * The decode scenario repeated at the very end, minutes of sustained load after
 * the first one. A drop means thermal throttling or competing load; a rise
 * means the warmup never warmed it. Either way the figures above it moved while
 * they were being taken, so this is what turns "same-machine comparisons only"
 * from a caveat the reader has to remember into one the report can check.
 */
export interface LoadDriftResult {
  firstTokPerSec: number | null;
  lastTokPerSec: number | null;
  /** Signed percentage: negative is slower at the end. */
  driftPct: number | null;
  /** Sustained load between the two measurements. */
  elapsedMs: number;
  verdict: "steady" | "degraded" | "improved" | "unknown";
}

/**
 * Does the prefix cache save work, or only report that it did?
 *
 * Conformance already checks that `cached_tokens` is reported and that a warm
 * hit does not change the answer. This is the clock's opinion: the same prompt
 * twice, time to first token cold versus warm.
 */
export interface PrefixCacheResult {
  coldTtftMs: number | null;
  warmTtftMs: number | null;
  /** cold ÷ warm. Above ~2 means the second prefill did not happen. */
  speedup: number | null;
  /** What usage claimed was reused, when the engine reports it at all. */
  cachedTokens: number | null;
  promptTokens: number | null;
  verdict: "active" | "none" | "unknown";
}

/**
 * Does the engine run concurrent requests together or queue them?
 *
 * One burst of N streams against one stream alone. Continuous batching holds
 * efficiency near 1; a single slot behind a queue pins it at 1/N. Informational
 * like the rest of the benchmark, and just as hardware-dependent.
 */
export interface BatchingResult {
  streams: number;
  /** Output tokens over wall clock for a single stream. */
  singleTokPerSec: number | null;
  /** Output tokens over wall clock for the whole burst, summed. */
  aggregateTokPerSec: number | null;
  /** aggregate ÷ (single × streams). */
  efficiency: number | null;
  /** Slowest first token in the burst — where queueing shows up first. */
  worstTtftMs: number | null;
  verdict: "batched" | "partial" | "serialized" | "unknown";
}

/**
 * Whether speculation still pays at one context length.
 *
 * Engines routinely disable or starve a draft path as the KV cache grows, so
 * "MTP works" measured at 500 tokens says nothing about 32k. Each rung runs a
 * predictable prompt beside the novel one and reports both the throughput
 * ratio and the frame-gap step profile.
 */
export interface ContextSpeculative {
  /**
   * Decode tok/s on maximally predictable output (counting) at this rung — the
   * ceiling on what speculation can deliver at this context length. Counting is
   * nowhere in the prompt, so prompt-lookahead cannot serve it and nothing has
   * to be found first.
   */
  predictableTokPerSec: number | null;
  /** Tokens per decode step on that ceiling run. */
  predictableTokensPerStep: number | null;
  /** predictable ÷ coding decode throughput — the headroom left at this size. */
  ratio: number | null;
  verdict: "effective" | "marginal" | "none" | null;
  /** Tokens per decode step on the realistic coding task. Needs no comparison. */
  tokensPerStep: number | null;
  /** Why a signal is missing: context unread, buffered stream, etc. */
  note: string | null;
}

/** One rung of the context-length ladder — how the engine does at this size. */
export interface ContextPoint {
  /** The size we aimed for (0.5k … 64k; the top rungs run only at --full). */
  targetTokens: number;
  /** What the engine actually reported ingesting — the honest x-axis. */
  inputTokens: number | null;
  decodeTokPerSec: number | null;
  ttftMs: number | null;
  /** Prompt tokens over time-to-first-token — how fast this rung was ingested. */
  prefillTokPerSec: number | null;
  /**
   * Does speculative decoding still help at this prompt size? Null when the
   * rung failed outright.
   */
  speculative: ContextSpeculative | null;
  /** Successful runs behind the numbers (1 by default, 3 at --full, or --runs). */
  runs: number;
  /**
   * Why the rung produced no numbers — e.g. the engine's own context-overflow
   * error, verbatim. A failed rung ends the ladder: larger rungs are not
   * attempted, and their absence means "not tried", never "n/a".
   */
  note: string | null;
}

/**
 * Where the benchmark ran. Timings are hardware-dependent and only comparable
 * on the same machine — recording the machine makes that claim checkable
 * instead of a caveat the reader has to take on faith.
 */
export interface MachineInfo {
  platform: string;
  arch: string;
  cpu: string | null;
  memGB: number;
}

export interface BenchReport {
  /**
   * Steady-state decode throughput, tokens/sec, measured while generating code
   * — the workload these engines are actually asked to serve.
   */
  decodeTokPerSec: BenchStat | null;
  /**
   * Set when the engine's stream coalesced deltas (a fat first frame) on any
   * timed sample: client-side rates then exclude pre-window tokens, and the
   * classic per-frame math would have inflated them.
   */
  streamCaveat: string | null;
  /**
   * Which length mode produced the decode figures: forced-to-cap via
   * ignore_eos/min_tokens (equal work per model) or the model's natural stop
   * (the engine ignored the flags). Methodology must be visible, never silent.
   */
  decodeLengthNote?: string | null;
  /** Set when a --sampling preset ran the benchmark non-greedily. */
  samplingNote?: string | null;
  /** Set when --rungs or --runs changed the ladder or the repetition count. */
  runsNote?: string | null;
  /** Time to first generated token, ms. */
  ttftMs: BenchStat | null;
  /** Prompt ingestion rate, tokens/sec, from a deliberately long prompt. */
  prefillTokPerSec: BenchStat | null;
  prefillPromptTokens: number | null;
  /** MTP / speculative-decoding effectiveness, or null if not probed. */
  speculative: SpeculativeResult | null;
  /** Whether the prefix cache actually skips work, timed rather than reported. */
  prefixCache: PrefixCacheResult | null;
  /** Whether concurrent requests are batched or queued. */
  batching: BatchingResult | null;
  /** Whether the box held its speed for the whole run — qualifies everything above. */
  loadDrift: LoadDriftResult | null;
  machine: MachineInfo;
  /**
   * Decode throughput and latency as context grows. The interesting shape:
   * decode slows as the KV cache grows, and some engines fall off a cliff while
   * others degrade gracefully.
   */
  contextScaling: ContextPoint[] | null;
}

/**
 * Fidelity — does the engine reproduce the model faithfully? A single-engine,
 * reference-free score, meant to be compared across engines running the *same
 * weights*: hold the model constant and the delta between cards is the engine.
 *
 * Unlike the other three cards, this one *is* blended into a single rankable
 * number, on purpose — the whole use case is "which engine reproduced this
 * model best". The slices are still shown so a low score says *why*: a legit Q4
 * quant costs Confidence (that's the honest fidelity price of the quant), while
 * a genuine engine bug — non-determinism at temperature 0, a logprob that
 * disagrees with the token actually emitted — costs Determinism or Consistency.
 */
export type FidelitySliceId =
  | "correctness"
  | "confidence"
  | "determinism"
  | "consistency";

export interface FidelitySlice {
  id: FidelitySliceId;
  label: string;
  /** 0..1 sub-score. */
  score: number;
  /** Weight in the blended headline, before renormalising over measured slices. */
  weight: number;
  /** Human summary, e.g. "23/24 items" or "mean top-1 prob 0.94". */
  detail: string;
  /**
   * False when the engine couldn't be measured on this slice — Confidence and
   * Consistency need logprobs, and an engine that exposes none simply drops out
   * of the denominator rather than scoring zero, the same way an unimplemented
   * surface leaves the Conformance denominator alone.
   */
  measured: boolean;
  /** Why it wasn't measured, when `measured` is false. */
  unmeasuredReason?: string;
}

export interface FirstDivergence {
  /** Which battery item's greedy runs split. */
  itemId: string;
  /** Character index where the repeated temperature-0 runs first disagreed. */
  charIndex: number;
  /**
   * Which repeat disagreed with run 1 (2 = the very next one). Run 2 is the
   * cold-vs-warm shape: run 1 prefills cold, everything after it hits the
   * prefix cache, so a split there points at caching rather than at sampling.
   */
  run: number;
  /** How many runs were compared. */
  runs: number;
}

/** One battery item's raw numbers, before the slices round them off. */
export interface FidelityMeasurement {
  id: string;
  /** Confidence is scored over the harder items only; this says which. */
  hard: boolean;
  correct: boolean;
  /** exp(first-answer-token logprob), or null when the engine sent no logprobs. */
  topProb: number | null;
  /** Top-1 probability minus the runner-up's, or null without a top-k. */
  margin: number | null;
}

export interface FidelityScore {
  /** 0..100, the single rankable number, blended over measured slices only. */
  pct: number;
  slices: FidelitySlice[];
  /** How many battery items were graded — the honest denominator. */
  items: number;
  /**
   * The greedy self-divergence fact: the first repeated temperature-0 run that
   * failed to reproduce byte-for-byte, or null when the engine was perfectly
   * deterministic. "diverged at char 84" is the single most useful thing here.
   */
  firstDivergence: FirstDivergence | null;
  /** Slice labels excluded for want of logprobs, named on the card. */
  unmeasured: string[];
  /**
   * The continuous numbers behind the graded slices — reported, never scored.
   *
   * The card is a floor check on purpose: Confidence saturates at a mean top-1
   * probability of 0.9, so 0.94 and 0.99 both read as a clean 100, and two
   * healthy engines tie. That is the right answer to "did this engine damage
   * the model" and the wrong one for anybody ranking engines or correlating
   * against an external benchmark. Those numbers exist either way — this is
   * where they are readable, rather than only inside a `detail` string.
   *
   * Nulls stay null. A zero here would read as a maximally unconfident engine
   * in someone else's spreadsheet.
   */
  measurements: {
    /** Mean top-1 probability over the same items Confidence scores. */
    meanTopProb: number | null;
    /** Mean gap to the runner-up over those same items. */
    meanMargin: number | null;
    items: FidelityMeasurement[];
  };
  /**
   * True on a reasoning model: it spends budget thinking before the visible
   * answer, so Confidence reads the post-thinking distribution and the score is
   * a floor, not a ceiling. Flagged, never hidden — same honesty as the bench.
   */
  reasoningCaveat: boolean;
}

/** Blend weights for the fidelity headline. Correctness leads; see FidelityScore. */
export const FIDELITY_WEIGHTS: Record<FidelitySliceId, number> = {
  correctness: 0.4,
  confidence: 0.25,
  determinism: 0.25,
  consistency: 0.1,
};

export interface RunReport {
  target: RunTarget;
  /**
   * Set when the run stopped early because the target stopped answering. Every
   * card below it is partial by construction — the checks after the target died
   * never ran, and reading a whole-surface zero here as a measurement is
   * exactly the mistake this field exists to prevent.
   */
  incomplete?: string;
  coverage: CoverageScore;
  conformance: ConformanceScore;
  capability: CapabilityScore;
  /** Agentic card; present unless `--quick`, the engine lacks tools, or the budget ran out first. */
  agentic?: AgenticScore;
  /** Engine-fidelity card; present unless the run was `--quick`. */
  fidelity?: FidelityScore;
  bench?: BenchReport;
  usage?: UsageTotals;
  durationMs: number;
}
