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
