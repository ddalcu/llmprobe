/**
 * Pure statistics for the mini benchmark.
 *
 * Timings are noisy and hardware-dependent, so the benchmark never reports a
 * single figure — it reports a median with a min–max range, over runs that
 * exclude a discarded warmup. These helpers are the whole numeric core, kept
 * pure so the methodology is unit-testable without touching an engine.
 */

export interface BenchStat {
  median: number;
  min: number;
  max: number;
  /** The measured samples (warmup already excluded), for the JSON report. */
  samples: number[];
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

export function computeStat(samples: number[]): BenchStat | null {
  if (samples.length === 0) return null;
  return {
    median: round(median(samples)),
    min: round(Math.min(...samples)),
    max: round(Math.max(...samples)),
    samples: samples.map(round),
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Tokens per second. Returns null when either input is unusable. */
export function tokensPerSecond(
  tokens: number | null | undefined,
  ms: number,
): number | null {
  if (typeof tokens !== "number" || tokens <= 0 || ms <= 0) return null;
  return (tokens / ms) * 1000;
}

export type SpeculativeVerdict = "effective" | "marginal" | "none";

/**
 * Classify a speculative-decoding signal from the predictable-vs-novel ratio.
 *
 * MTP / speculative decoding only pays off when the draft is *accepted*, which
 * happens far more on predictable output (verbatim echo, repetition) than on
 * novel text. So a decode-throughput ratio well above 1 is the black-box
 * signature that speculation is actually working; a ratio near 1 means it is
 * absent or ineffective. We cannot tell *which* technique (MTP vs draft model
 * vs prompt-lookahead) — only whether it helps.
 */
export const SPECULATIVE_EFFECTIVE = 1.25;
export const SPECULATIVE_MARGINAL = 1.05;

export function classifySpeculative(
  predictableTps: number,
  novelTps: number,
): { ratio: number; verdict: SpeculativeVerdict } {
  if (novelTps <= 0) return { ratio: 0, verdict: "none" };
  const ratio = predictableTps / novelTps;
  const verdict: SpeculativeVerdict =
    ratio >= SPECULATIVE_EFFECTIVE
      ? "effective"
      : ratio >= SPECULATIVE_MARGINAL
        ? "marginal"
        : "none";
  return { ratio: Math.round(ratio * 100) / 100, verdict };
}

/**
 * Decode throughput from when the visible tokens actually arrived.
 *
 * The window is first text frame → *last* text frame, not first frame → end of
 * stream. After the final token an engine still sends the finish_reason chunk,
 * the usage frame and `[DONE]`, and the client still drains and closes the
 * body. All of that lands in the denominator while producing nothing, which
 * deflates the rate by roughly the fixed cost of a request — a tenth of a short
 * generation, and the reason a client-timed figure reads below a server-timed
 * one for the same work.
 *
 * `visibleTokens` must exclude reasoning tokens. `completion_tokens` counts the
 * scratchpad, but the window starts at the first *visible* frame, so counting
 * thinking tokens against visible-only time inflates in the other direction —
 * and a run where the model happens to think then reads faster than one where
 * it does not, which is scatter rather than measurement.
 *
 * N frames bound N-1 intervals, so the numerator drops one token: the first
 * arrived at the window's opening edge and was not generated inside it.
 */
export function decodeRate(
  textFrameTimes: number[],
  visibleTokens: number | null,
): number | null {
  if (textFrameTimes.length < 2) return null;
  if (typeof visibleTokens !== "number" || visibleTokens < 2) return null;
  const span = textFrameTimes[textFrameTimes.length - 1]! - textFrameTimes[0]!;
  if (span <= 0) return null;
  return ((visibleTokens - 1) / span) * 1000;
}

/** One streamed frame that carried generated text: when, and how much. */
export interface DeliveryFrame {
  timeMs: number;
  chars: number;
}

export interface DeliveryRateResult {
  /** Client-observed delivered tokens per second, or null if unmeasurable. */
  rate: number | null;
  /** Output tokens divided by text frames — stream granularity. */
  meanTokensPerFrame: number | null;
  /** Fraction of the output already in flight when the window opened. */
  firstFrameShare: number | null;
  /** True when frame sizes say the server coalesces deltas. */
  coalesced: boolean;
  /** Human-readable caveat when `coalesced`, else null. */
  note: string | null;
}

/**
 * A first frame carrying more than this share of the output means the window
 * start is not a per-token event and the classic (N-1)/span math would credit
 * pre-window tokens to the measured span.
 */
export const COALESCED_FIRST_FRAME_SHARE = 0.05;

/**
 * Client-observed delivery rate, robust to delta coalescing.
 *
 * The classic client-side decode math is (tokens - 1) / (t_last - t_first)
 * over frame arrival times. That silently trusts the server to stream one
 * token per frame: a server that coalesces deltas (a stream-interval knob, a
 * buffering proxy) delivers its first frame LATE and FAT, which shortens the
 * measured window while the numerator keeps every token — measured 15-20%
 * inflation on a live engine against the same stream timed per-token. The fix
 * is bookkeeping, not smoothing: tokens already in flight when the window
 * opens (the first frame's share, estimated by characters) do not belong to
 * the numerator. On an honest per-token stream the first frame is one token
 * and this reduces exactly to (N-1)/span.
 *
 * Tokens are apportioned to frames by character count — usage reports true
 * totals, frames report true text, and chars-per-token cancels out of the
 * share arithmetic.
 */
export function deliveryRate(
  frames: DeliveryFrame[],
  outputTokens: number | null,
): DeliveryRateResult {
  const none: DeliveryRateResult = {
    rate: null,
    meanTokensPerFrame: null,
    firstFrameShare: null,
    coalesced: false,
    note: null,
  };
  if (typeof outputTokens !== "number" || outputTokens < 2) return none;
  if (frames.length === 1) {
    return {
      ...none,
      meanTokensPerFrame: outputTokens,
      firstFrameShare: 1,
      coalesced: true,
      note: "stream arrived in one frame — client-side rate unmeasurable",
    };
  }
  if (frames.length < 2) return none;
  const totalChars = frames.reduce((sum, f) => sum + f.chars, 0);
  if (totalChars <= 0) return none;
  const span = frames[frames.length - 1]!.timeMs - frames[0]!.timeMs;
  const firstFrameShare = frames[0]!.chars / totalChars;
  const meanTokensPerFrame = outputTokens / frames.length;
  const coalesced = firstFrameShare > COALESCED_FIRST_FRAME_SHARE;
  const note = coalesced
    ? `first frame carried ${Math.round(firstFrameShare * 100)}% of the output — coalesced deltas; rate excludes pre-window tokens`
    : null;
  if (span <= 0) {
    return {
      rate: null,
      meanTokensPerFrame,
      firstFrameShare,
      coalesced: true,
      note: "all frames arrived at once — client-side rate unmeasurable",
    };
  }
  const deliveredInWindow = outputTokens * (1 - firstFrameShare);
  if (deliveredInWindow < 1) {
    return { rate: null, meanTokensPerFrame, firstFrameShare, coalesced, note };
  }
  return {
    rate: (deliveredInWindow / span) * 1000,
    meanTokensPerFrame,
    firstFrameShare,
    coalesced,
    note,
  };
}

export type PrefixCacheVerdict = "active" | "none" | "unknown";

/** A repeat this much faster to first token means the prefill was skipped. */
export const PREFIX_CACHE_SPEEDUP = 2;
/**
 * Below this cold time to first token there was no prefill worth caching, and
 * the ratio is measuring jitter. 3 ms against 1 ms is a "3× speedup" and
 * evidence of nothing; any real engine ingesting this probe's prompt is far
 * above it.
 */
export const PREFIX_CACHE_MIN_COLD_MS = 50;

/**
 * Does the prefix cache actually save work?
 *
 * The conformance suite already checks that an engine *reports* cached tokens
 * and that a warm hit does not change the answer. Neither catches the engine
 * that reports a hit and re-ingests the prompt regardless — only the clock
 * does. Identical prompt twice, time to first token cold versus warm.
 */
export function classifyPrefixCache(
  coldTtftMs: number | null,
  warmTtftMs: number | null,
): { speedup: number | null; verdict: PrefixCacheVerdict } {
  if (
    !coldTtftMs ||
    !warmTtftMs ||
    coldTtftMs < PREFIX_CACHE_MIN_COLD_MS ||
    warmTtftMs <= 0
  ) {
    return { speedup: null, verdict: "unknown" };
  }
  const speedup = coldTtftMs / warmTtftMs;
  return {
    speedup: Math.round(speedup * 10) / 10,
    verdict: speedup >= PREFIX_CACHE_SPEEDUP ? "active" : "none",
  };
}

export type BatchingVerdict = "batched" | "partial" | "serialized" | "unknown";

export const BATCHING_EFFICIENT = 0.7;
export const BATCHING_PARTIAL = 0.35;

/**
 * Does the engine run concurrent requests together, or queue them?
 *
 * Efficiency is aggregate throughput under N streams over what N streams would
 * produce if each ran at the single-stream rate. Continuous batching (vLLM,
 * mlx-serve) holds near 1 until it saturates; one slot behind a queue pins it
 * at 1/N, because the four streams simply take four times as long. The
 * operational difference is enormous and nothing else in the suite sees it.
 */
export function classifyBatching(
  singleTokPerSec: number | null,
  aggregateTokPerSec: number | null,
  streams: number,
): { efficiency: number | null; verdict: BatchingVerdict } {
  if (
    !singleTokPerSec ||
    !aggregateTokPerSec ||
    singleTokPerSec <= 0 ||
    aggregateTokPerSec <= 0 ||
    streams < 2
  ) {
    return { efficiency: null, verdict: "unknown" };
  }
  const efficiency = aggregateTokPerSec / (singleTokPerSec * streams);
  const verdict: BatchingVerdict =
    efficiency >= BATCHING_EFFICIENT
      ? "batched"
      : efficiency >= BATCHING_PARTIAL
        ? "partial"
        : "serialized";
  return { efficiency: Math.round(efficiency * 100) / 100, verdict };
}

export type DriftVerdict = "steady" | "degraded" | "improved" | "unknown";

/** Beyond this much movement, the run's numbers are a range, not figures. */
export const DRIFT_TOLERANCE_PCT = 10;

/**
 * Did the machine hold its speed for the length of the run?
 *
 * The same decode scenario at the start and at the end, minutes of sustained
 * load apart. A drop is thermal throttling or something else arriving on the
 * box; a rise means the warmup did not actually warm it. Both mean the figures
 * above were taken while the ground was moving, which is the caveat the
 * "same machine only" note can only gesture at.
 *
 * Deliberately not an OS thermal reading: `ProcessInfo.thermalState` is macOS
 * only and reports that the chip was warm, not that these numbers changed.
 */
export function classifyLoadDrift(
  firstTokPerSec: number | null,
  lastTokPerSec: number | null,
): { driftPct: number | null; verdict: DriftVerdict } {
  if (
    !firstTokPerSec ||
    !lastTokPerSec ||
    firstTokPerSec <= 0 ||
    lastTokPerSec <= 0
  ) {
    return { driftPct: null, verdict: "unknown" };
  }
  const driftPct = ((lastTokPerSec - firstTokPerSec) / firstTokPerSec) * 100;
  const verdict: DriftVerdict =
    driftPct <= -DRIFT_TOLERANCE_PCT
      ? "degraded"
      : driftPct >= DRIFT_TOLERANCE_PCT
        ? "improved"
        : "steady";
  return { driftPct: Math.round(driftPct * 10) / 10, verdict };
}

/** How a stream was emitted: tokens per server decode step. */
export interface StepProfile {
  /** Tokens the engine emitted per decode step. ~1 means no speculation. */
  tokensPerStep: number | null;
  /** Decode steps counted from frame arrival gaps. */
  steps: number | null;
  /** Text-bearing SSE frames the analysis saw. */
  frames: number;
  /** Why there is no number — the stream shape could not support a claim. */
  note: string | null;
}

/** Below this many streamed frames the gap distribution is just noise. */
export const MIN_STEP_FRAMES = 16;
/**
 * A gap at least this fraction of the mean gap ends a decode step. Speculated
 * tokens share a step, so they arrive with near-zero gaps and the real step
 * boundaries sit far above the mean; half the mean separates the two cleanly
 * for any acceptance length, and survives ordinary jitter.
 */
export const STEP_GAP_FRACTION = 0.5;
/**
 * More tokens per step than this is not a draft path — it is a buffering
 * proxy or a coalesced write. Real MTP/EAGLE/Medusa acceptance runs 1–5.
 */
export const MAX_PLAUSIBLE_TOKENS_PER_STEP = 8;
/** At or above this, speculation is visibly doing work. */
export const STEP_SPECULATION_FLOOR = 1.15;

const noProfile = (frames: number, note: string): StepProfile => ({
  tokensPerStep: null,
  steps: null,
  frames,
  note,
});

/**
 * Estimate tokens per decode step from when the stream's frames actually
 * arrived.
 *
 * This is the direct signature of speculative decoding / MTP, and unlike the
 * predictable-vs-novel throughput ratio it needs no second request and no
 * comparison: a speculator that accepts k drafts emits k tokens in one server
 * step, so they land together and the step boundary shows up as a gap far
 * wider than the mean. Engines that instead pack a whole step into one SSE
 * frame are caught too, because the token count comes from usage rather than
 * from counting frames.
 *
 * Every shape that cannot carry the claim returns a note instead of a number.
 * A body delivered in one read has no visible steps, and a stream chopped into
 * a couple of big writes would otherwise compute to an absurd acceptance
 * length — reporting either as "no speculation" or "spectacular speculation"
 * would be fabrication.
 */
export function analyzeStepProfile(
  frameTimesMs: number[],
  outputTokens: number | null,
): StepProfile {
  const frames = frameTimesMs.length;
  if (frames < MIN_STEP_FRAMES) {
    return noProfile(frames, `only ${frames} streamed frames — too few`);
  }
  if (typeof outputTokens !== "number" || outputTokens <= 0) {
    return noProfile(frames, "no output-token usage to divide by");
  }

  const span = frameTimesMs[frames - 1]! - frameTimesMs[0]!;
  if (span <= 0) {
    return noProfile(frames, "arrived in one read — frames not timed apart");
  }

  const gaps: number[] = [];
  for (let i = 1; i < frames; i += 1) {
    gaps.push(frameTimesMs[i]! - frameTimesMs[i - 1]!);
  }
  const threshold = (span / gaps.length) * STEP_GAP_FRACTION;
  const steps = gaps.filter((g) => g >= threshold).length + 1;
  const tokensPerStep = outputTokens / steps;

  if (tokensPerStep > MAX_PLAUSIBLE_TOKENS_PER_STEP) {
    return noProfile(
      frames,
      `${steps} write(s) for ${outputTokens} tokens — stream looks buffered`,
    );
  }

  return {
    tokensPerStep: Math.round(tokensPerStep * 100) / 100,
    steps,
    frames,
    note: null,
  };
}
