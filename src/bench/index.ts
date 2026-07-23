import { arch, cpus, platform, totalmem } from "node:os";

import { tryParseJson } from "../core/assert";
import { BudgetExceededError } from "../core/client";
import type { RunContext } from "../core/context";
import type {
  BenchReport,
  ContextPoint,
  MachineInfo,
  SpeculativeResult,
} from "../core/outcome";
import { buildLongPrefix } from "../core/assert";
import {
  type BenchStat,
  classifySpeculative,
  computeStat,
  median,
  tokensPerSecond,
} from "./stats";

/**
 * The mini benchmark.
 *
 * Informational only — it never feeds a score or the exit code. What makes it a
 * benchmark rather than the incidental per-request timing we already had:
 *
 *  - a warmup run per scenario, discarded, so cold model-load / cache-warm
 *    never leaks into the number;
 *  - K measured runs, reported as median (min–max), never a single figure;
 *  - a unique lead-in on every request, so the engine's prompt/prefix cache
 *    (llama.cpp slots, vLLM APC, LM Studio, Ollama) can never serve a measured
 *    run from an earlier run's KV — a cache hit collapses TTFT and makes
 *    prefill read as tens of thousands of tok/s;
 *  - a black-box speculative-decoding / MTP probe: decode throughput on
 *    predictable content (verbatim echo) versus novel content. Speculation only
 *    pays when the draft is accepted, which happens far more on predictable
 *    output, so the ratio is the signature of a working MTP/draft path.
 *
 * Cross-engine comparison is only valid on the same hardware; the report says so.
 */

const K = 3;
const DECODE_TOKENS = 192;
const PREFILL_TOKENS = 8;
/** ~8 KB of filler ≈ a couple thousand tokens, enough to time prefill. */
const PREFILL_PROMPT_BYTES = 8192;

/** Context ladder — kept deliberately short so --bench stays quick. */
const CONTEXT_LADDER = [512, 4096, 8192, 16384];
/** --full climbs higher — the interesting cliffs often appear past 16k. */
const CONTEXT_LADDER_FULL = [...CONTEXT_LADDER, 32768, 65536];
/** --full also repeats each rung, so one OS hiccup can't bend the curve. */
const CONTEXT_RUNS_FULL = 3;
const CONTEXT_GEN_TOKENS = 64;
/** English runs ~4 bytes/token; the real size is read back from usage anyway. */
const BYTES_PER_TOKEN = 4;
/**
 * Context rungs run with the per-request timeout stretched by this factor: an
 * uncached prefill of the biggest rung is the slowest single request in the
 * whole suite, and on slow hardware it routinely outlasts a timeout that every
 * other request finishes well inside.
 */
const CONTEXT_TIMEOUT_MULTIPLIER = 3;

/** A coherent passage the model can echo verbatim — high draft acceptance. */
const PREDICTABLE_PASSAGE =
  "The old lighthouse stood at the edge of the rocky cliff, its white paint " +
  "weathered by decades of salt and wind. Every evening the keeper climbed the " +
  "spiral stairs, lit the great lamp, and watched its beam sweep slowly across " +
  "the dark water, guiding the fishing boats safely home through the fog.";

/**
 * Prefix caches match from token 0 and survive across llmprobe invocations, so
 * the lead-in sits at the very start of the prompt and is unique per process
 * (timestamp tag) and per request (sequence number).
 */
const CACHE_BUST_TAG = Date.now().toString(36);
let cacheBustSeq = 0;
const cacheBust = (text: string): string =>
  `[probe ${CACHE_BUST_TAG}-${(cacheBustSeq++).toString(36)}] ${text}`;

interface RunSample {
  ttftMs: number | null;
  decodeTokPerSec: number | null;
  prefillTokPerSec: number | null;
  outputTokens: number | null;
  inputTokens: number | null;
  /** Why the run produced nothing — engine error or timeout, verbatim. */
  error?: string;
}

const failedSample = (error: string): RunSample => ({
  ttftMs: null,
  decodeTokPerSec: null,
  prefillTokPerSec: null,
  outputTokens: null,
  inputTokens: null,
  error,
});

/** Pull the human part out of an error body: `{"error":{"message":...}}` etc. */
function errorFromBody(status: number, raw: string): string {
  const parsed = tryParseJson(raw.trim());
  let message = "";
  if (parsed.ok && typeof parsed.value === "object" && parsed.value !== null) {
    const err = (parsed.value as { error?: unknown }).error;
    if (typeof err === "string") message = err;
    else if (typeof err === "object" && err !== null) {
      const m = (err as { message?: unknown }).message;
      if (typeof m === "string") message = m;
    }
  }
  message = message.replace(/\s+/g, " ").trim().slice(0, 120);
  return message ? `HTTP ${status} — ${message}` : `HTTP ${status}`;
}

/** One timed generation, reduced to the metrics we care about. */
async function timedRun(
  ctx: RunContext,
  surface: string,
  text: string,
  maxTokens: number,
  timeoutMs = ctx.config.timeoutMs,
): Promise<RunSample> {
  const adapter = ctx.adapters.get(surface)!;
  const body = {
    ...adapter.buildBody(
      {
        turns: [{ type: "user", text: cacheBust(text) }],
        temperature: 0,
        maxTokens,
        includeUsage: true,
      },
      ctx.config,
    ),
    stream: true,
  };

  // A run that outlasts the request timeout (uncached prefill of the biggest
  // context rung can, on slow hardware) costs one null sample, not the whole
  // benchmark. Only the token-budget ceiling still aborts the run.
  let timed;
  try {
    timed = await ctx.client.streamTimed(
      adapter.path,
      body,
      adapter.headers(ctx.config),
      timeoutMs,
    );
  } catch (err) {
    if (err instanceof BudgetExceededError) throw err;
    if (err instanceof Error && err.name === "TimeoutError") {
      return failedSample(`timed out after ${timeoutMs / 1000}s`);
    }
    return failedSample(err instanceof Error ? err.message : String(err));
  }

  if (timed.status !== 200) {
    return failedSample(errorFromBody(timed.status, timed.raw));
  }

  const reply = adapter.parseStream(timed.frames);
  ctx.client.recordUsage(reply.usage.inputTokens, reply.usage.outputTokens);

  // TTFT = arrival of the first frame carrying a generated token.
  let firstIdx = -1;
  for (let i = 0; i < timed.frames.length; i += 1) {
    const parsed = tryParseJson(timed.frames[i]!.data);
    if (parsed.ok && adapter.frameText(parsed.value) !== "") {
      firstIdx = i;
      break;
    }
  }

  const ttftMs =
    firstIdx >= 0 ? timed.frameTimesMs[firstIdx]! - timed.startMs : null;
  const decodeMs =
    firstIdx >= 0 ? timed.endMs - timed.frameTimesMs[firstIdx]! : null;

  return {
    ttftMs,
    decodeTokPerSec:
      decodeMs !== null
        ? tokensPerSecond(reply.usage.outputTokens, decodeMs)
        : null,
    // Prefill: prompt tokens divided by time-to-first-token — the standard
    // proxy, since TTFT is dominated by prompt ingestion on a long prompt.
    prefillTokPerSec:
      ttftMs !== null ? tokensPerSecond(reply.usage.inputTokens, ttftMs) : null,
    outputTokens: reply.usage.outputTokens,
    inputTokens: reply.usage.inputTokens,
  };
}

/** Warmup (discarded) + K measured runs of the same request. */
async function measure(
  ctx: RunContext,
  surface: string,
  text: string,
  maxTokens: number,
  onProgress?: (label: string) => void,
  label = "",
): Promise<RunSample[]> {
  onProgress?.(`${label} warmup`);
  await timedRun(ctx, surface, text, maxTokens); // discarded

  const samples: RunSample[] = [];
  for (let i = 0; i < K; i += 1) {
    onProgress?.(`${label} ${i + 1}/${K}`);
    samples.push(await timedRun(ctx, surface, text, maxTokens));
  }
  return samples;
}

const pick = (samples: RunSample[], field: keyof RunSample): BenchStat | null =>
  computeStat(
    samples
      .map((s) => s[field])
      .filter((v): v is number => typeof v === "number"),
  );

const fmtK = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

/**
 * Decode + latency as the prompt grows. One run per rung by default (the only
 * real cost is the big prefill); --full climbs to 64k and takes the median of
 * 3 runs per rung. We report the *actual* input tokens usage returns, not the
 * target, so the x-axis is honest even when the tokenizer disagrees with our
 * byte estimate.
 *
 * A rung where every run fails ends the ladder with the engine's own error on
 * the point (typically a context-window overflow) — larger rungs can only fail
 * the same way, and burning minutes to prove it helps nobody.
 */
async function contextScaling(
  ctx: RunContext,
  surface: string,
  onProgress?: (label: string) => void,
): Promise<ContextPoint[]> {
  const full = ctx.config.depth === "full";
  const ladder = full ? CONTEXT_LADDER_FULL : CONTEXT_LADDER;
  const runsPerRung = full ? CONTEXT_RUNS_FULL : 1;
  const timeoutMs = ctx.config.timeoutMs * CONTEXT_TIMEOUT_MULTIPLIER;
  const points: ContextPoint[] = [];

  for (const target of ladder) {
    const prompt =
      buildLongPrefix(
        "Operations archive entry for the quarterly review.",
        target * BYTES_PER_TOKEN,
      ) + "\n\nIn one sentence, summarise the archive above.";

    const samples: RunSample[] = [];
    for (let i = 0; i < runsPerRung; i += 1) {
      const count = runsPerRung > 1 ? ` ${i + 1}/${runsPerRung}` : "";
      onProgress?.(`context ~${fmtK(target)}${count}`);
      samples.push(
        await timedRun(ctx, surface, prompt, CONTEXT_GEN_TOKENS, timeoutMs),
      );
    }

    const ok = samples.filter((s) => s.error === undefined);
    const decodes = ok
      .map((s) => s.decodeTokPerSec)
      .filter((v): v is number => v !== null);
    const ttfts = ok
      .map((s) => s.ttftMs)
      .filter((v): v is number => v !== null);

    const point: ContextPoint = {
      targetTokens: target,
      inputTokens:
        ok.map((s) => s.inputTokens).find((v) => typeof v === "number") ?? null,
      decodeTokPerSec:
        decodes.length > 0 ? Math.round(median(decodes) * 10) / 10 : null,
      ttftMs: ttfts.length > 0 ? Math.round(median(ttfts)) : null,
      runs: ok.length,
      note: null,
    };

    if (ok.length === 0) {
      point.note = samples[0]?.error ?? "no successful run";
      points.push(point);
      break;
    }
    points.push(point);
  }

  return points;
}

function machineInfo(): MachineInfo {
  return {
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model.trim() || null,
    memGB: Math.round(totalmem() / 2 ** 30),
  };
}

export async function runBenchmark(
  ctx: RunContext,
  reasoningModel: boolean,
  onProgress?: (label: string) => void,
): Promise<BenchReport | null> {
  const surface = ctx.evalSurface;
  if (!surface) return null;

  // Decode + TTFT from a free-form generation.
  const decodeSamples = await measure(
    ctx,
    surface,
    "Write a detailed, vivid description of a bustling harbour town at dawn.",
    DECODE_TOKENS,
    onProgress,
    "decode",
  );

  // Prefill from a deliberately long prompt with almost no generation.
  const prefillPrompt =
    buildLongPrefix(
      "The archive records the following entry.",
      PREFILL_PROMPT_BYTES,
    ) + "\n\nReply with just the word: OK.";
  const prefillSamples = await measure(
    ctx,
    surface,
    prefillPrompt,
    PREFILL_TOKENS,
    onProgress,
    "prefill",
  );

  // Speculative / MTP probe: predictable echo versus novel generation.
  const predictable = await measure(
    ctx,
    surface,
    `Repeat the following passage exactly, word for word:\n\n${PREDICTABLE_PASSAGE}`,
    DECODE_TOKENS,
    onProgress,
    "spec:predictable",
  );
  const novel = await measure(
    ctx,
    surface,
    "Invent an original, surprising paragraph of stream-of-consciousness prose. Avoid common phrases.",
    DECODE_TOKENS,
    onProgress,
    "spec:novel",
  );

  const predTps = median(
    predictable
      .map((s) => s.decodeTokPerSec)
      .filter((v): v is number => v !== null),
  );
  const novelTps = median(
    novel.map((s) => s.decodeTokPerSec).filter((v): v is number => v !== null),
  );

  let speculative: SpeculativeResult | null = null;
  if (predTps > 0 && novelTps > 0) {
    const { ratio, verdict } = classifySpeculative(predTps, novelTps);
    speculative = {
      predictableTokPerSec: Math.round(predTps * 10) / 10,
      novelTokPerSec: Math.round(novelTps * 10) / 10,
      ratio,
      verdict,
      reasoningCaveat: reasoningModel,
    };
  }

  const prefillPromptTokens =
    prefillSamples
      .map((s) => s.inputTokens)
      .find((v) => typeof v === "number") ?? null;

  const contextPoints = await contextScaling(ctx, surface, onProgress);

  return {
    decodeTokPerSec: pick(decodeSamples, "decodeTokPerSec"),
    ttftMs: pick(decodeSamples, "ttftMs"),
    prefillTokPerSec: pick(prefillSamples, "prefillTokPerSec"),
    prefillPromptTokens,
    speculative,
    machine: machineInfo(),
    contextScaling: contextPoints.length > 0 ? contextPoints : null,
  };
}
