import { arch, cpus, platform, totalmem } from "node:os";

import { tryParseJson } from "../core/assert";
import { BudgetExceededError } from "../core/client";
import type { RunContext } from "../core/context";
import type {
  BatchingResult,
  BenchReport,
  ContextPoint,
  ContextSpeculative,
  LoadDriftResult,
  MachineInfo,
  PrefixCacheResult,
  SpeculativeResult,
} from "../core/outcome";
import { buildLongPrefix, runConcurrent } from "../core/assert";
import {
  PLANTED_CONSTANT,
  buildCodeContextWithConstant,
  usedPlantedConstant,
} from "./corpus";
import {
  type BenchStat,
  type StepProfile,
  analyzeStepProfile,
  classifyBatching,
  deliveryRate,
  classifyLoadDrift,
  classifyPrefixCache,
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
 * That probe also runs at every rung of the context ladder, because engines
 * routinely starve or disable a draft path as the KV cache grows — "MTP works"
 * measured on a 500-token prompt says nothing about 32k.
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
/**
 * Long enough for the decode rate and the frame-gap step profile to mean
 * something. A speculator's acceptance pattern is a distribution, and 64 tokens
 * is too short a sample to read one out of.
 */
const CONTEXT_GEN_TOKENS = 192;
/** Opening guess only; every rung re-fits this against what usage reported. */
const BYTES_PER_TOKEN = 4;
/**
 * How far the fitted filler size may stray from the flat guess, per token of
 * target. A tokenizer that disagrees this violently, or an engine reporting
 * nonsense usage, must not be able to talk us into a 100 MB prompt.
 */
const MIN_FIT_BYTES_PER_TOKEN = 2;
const MAX_FIT_BYTES_PER_TOKEN = 8;
/**
 * Roughly what a chat template costs on top of the message text — role tags,
 * BOS, the generation prompt. Small, but at the 512 rung it is the difference
 * between landing on 512 and landing on 570, so a single-point fit has to model
 * it rather than fold it into the bytes-per-token slope.
 */
const TEMPLATE_TOKENS = 10;
/** Filler for the one throwaway request that calibrates the ladder. */
const CALIBRATION_FILLER_BYTES = 2048;

/**
 * Server-feature checks: two probes, seven requests, no ladder. Both answer a
 * yes/no about the engine rather than charting a curve, so neither earns the
 * minutes a second ladder would cost.
 */
const PREFIX_CACHE_PROMPT_BYTES = 6144;
/** Names the one probe that repeats a prompt deliberately. */
export const PREFIX_CACHE_SEED =
  "Operations handbook, section on shift handover.";
const BATCH_STREAMS = 4;
const BATCH_GEN_TOKENS = 96;

/** One measured run, reported as it completes so the terminal is never blank. */
export interface BenchSample {
  /** Scenario and position, e.g. "decode 2/3". */
  label: string;
  /** The headline number for this scenario. */
  value: number | null;
  unit: string;
  /** The discarded run — reported so its cost is visible, never its number. */
  warmup: boolean;
  error?: string;
}

/** One (filler bytes → tokens the engine counted) observation. */
interface LadderFit {
  bytes: number;
  tokens: number;
}

/**
 * How much filler to write to land on `target` input tokens.
 *
 * English runs ~4.4 bytes/token, so the flat 4-byte guess builds every rung
 * about 10% short — a ladder that says 4k and measures 3.7k. Fitting against
 * what the engine actually counted fixes that without assuming a tokenizer.
 *
 * Two observations give a straight line through the most recent pair. They
 * carry identical non-filler overhead, so the intercept absorbs the notice, the
 * instruction and the chat template exactly. One observation cannot separate
 * slope from intercept, so it subtracts the overhead it knows about by hand.
 *
 * Every point must come from a prompt of the *same* shape and filler. Bytes per
 * token is a property of the text, not the language: this ladder's indexed
 * filler runs ~3.6 bytes/token where ordinary prose runs ~4.4, so fitting the
 * ladder against a differently-worded probe lands it 20% out.
 */
function fillerBytesFor(
  target: number,
  fits: LadderFit[],
  fixedChars: number,
): number {
  const clamp = (bytes: number): number =>
    Math.round(
      Math.min(
        target * MAX_FIT_BYTES_PER_TOKEN,
        Math.max(target * MIN_FIT_BYTES_PER_TOKEN, bytes),
      ),
    );

  const usable = fits.filter((f) => f.bytes > 0 && f.tokens > 0);
  if (usable.length === 0) return clamp(target * BYTES_PER_TOKEN);

  const last = usable[usable.length - 1]!;
  const prev = usable[usable.length - 2];
  if (prev === undefined || prev.tokens === last.tokens) {
    const fillerTokens = last.tokens - TEMPLATE_TOKENS;
    if (fillerTokens <= 0) return clamp(target * BYTES_PER_TOKEN);
    const bytesPerToken = (last.bytes + fixedChars) / fillerTokens;
    return clamp((target - TEMPLATE_TOKENS) * bytesPerToken - fixedChars);
  }

  const slope = (last.bytes - prev.bytes) / (last.tokens - prev.tokens);
  return clamp(last.bytes + slope * (target - last.tokens));
}

/**
 * The decode scenario. Measured once at the start and once more at the very
 * end, so the drift check compares like with like — same text, same token
 * count, minutes of sustained load apart.
 *
 * Code rather than prose, because that is what these engines are actually
 * asked to generate. Decode rate is not one number: a speculator accepts far
 * more drafts on the repetitive, highly-constrained token stream of source
 * code than on creative writing, so a prose figure understates what a coding
 * agent would see. This asks for enough type signature, control flow and
 * comment to exercise the mix.
 *
 * The speculative probe keeps its own prose prompt on purpose — that ratio
 * needs a genuinely low-acceptance baseline to divide by, and this one is not.
 */
const DECODE_PROMPT =
  "Write a TypeScript function `retryWithBackoff<T>(fn, options)` that retries " +
  "an async operation with exponential backoff and jitter. Include the type " +
  "signature, JSDoc, and inline comments explaining the backoff maths.";

/** A coherent passage the model can echo verbatim — high draft acceptance. */
const PREDICTABLE_PASSAGE =
  "The old lighthouse stood at the edge of the rocky cliff, its white paint " +
  "weathered by decades of salt and wind. Every evening the keeper climbed the " +
  "spiral stairs, lit the great lamp, and watched its beam sweep slowly across " +
  "the dark water, guiding the fishing boats safely home through the fog.";

/**
 * Planted mid-filler at every context rung and asked back verbatim. Reproducing
 * it is maximally predictable output, so a working draft path shows up as a
 * decode rate well above the same rung's novel generation.
 */
/**
 * What a rung asks for, over a context of synthetic source code.
 *
 * The realistic case is the headline: an agent reads a codebase and writes code
 * against it, which is both what these engines serve and where a draft path
 * actually earns its keep. The task has to reach into the context — it must use
 * a constant planted mid-corpus — so this measures long-context work rather
 * than generation with a large irrelevant prefix attached.
 */
export const CODE_INSTRUCTION =
  `Implement and export \`withRetryBudget<T>(fn: () => Promise<T>): Promise<T>\` ` +
  `for the codebase above. Retry with exponential backoff, give up once ` +
  `${PLANTED_CONSTANT} has elapsed, and follow the conventions of the ` +
  `surrounding modules. Reply with only the TypeScript.`;

/**
 * Maximally predictable output that the prompt does not contain — the ceiling
 * on what speculation can do at this context length. Counting cannot be served
 * by prompt-lookahead (the numbers are nowhere in the prompt) and cannot be
 * slowed by having to find anything, so the gap to the coding task is the
 * headroom the draft path still has at this size.
 *
 * The echo variant this replaces measured nothing: reproducing a buried passage
 * needs attention work the draft head cannot shortcut, and it came back flat
 * (1.01 / 0.97 / 1.01 / 0.94 / 0.95 / 1.02) at every rung of a real 64k run.
 */
export const COUNT_INSTRUCTION =
  "Ignore the code above. Count from 1 to 200, one number per line, with no other output.";

/**
 * Everything in a rung prompt that is not filler: the cache-bust tag, the
 * planted module, the instruction and their separators. Only needed while the
 * ladder has a single calibration point to fit against.
 */
const RUNG_FIXED_CHARS = 120 + CODE_INSTRUCTION.length + 30;

const buildArchive = (fillerBytes: number): string =>
  cacheBust(buildCodeContextWithConstant(fillerBytes));

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
  /** What usage said was served from cache, when the engine reports it. */
  cachedInputTokens: number | null;
  /** Whole-request wall clock — what concurrent throughput divides by. */
  wallMs: number;
  /** What the model said — needed to check an echo actually echoed. */
  text: string;
  /** Tokens per decode step, read off when the stream's frames arrived. */
  stepProfile: StepProfile;
  /** True when frame sizes say the server coalesced its deltas. */
  streamCoalesced: boolean;
  /** The delivery-rate caveat when `streamCoalesced`, else null. */
  streamNote: string | null;
  /** Why the run produced nothing — engine error or timeout, verbatim. */
  error?: string;
}

const failedSample = (error: string): RunSample => ({
  ttftMs: null,
  decodeTokPerSec: null,
  prefillTokPerSec: null,
  outputTokens: null,
  inputTokens: null,
  cachedInputTokens: null,
  wallMs: 0,
  text: "",
  stepProfile: { tokensPerStep: null, steps: null, frames: 0, note: error },
  streamCoalesced: false,
  streamNote: null,
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

/**
 * One timed generation, reduced to the metrics we care about.
 *
 * Sends `text` exactly as given. Keeping prompts distinct from a prefix cache
 * is the caller's job, because only the caller knows whether a shared prefix
 * is an accident or the point — the context rungs share one deliberately.
 */
async function timedRun(
  ctx: RunContext,
  surface: string,
  text: string,
  maxTokens: number,
): Promise<RunSample> {
  const adapter = ctx.adapters.get(surface)!;
  const body = {
    ...adapter.buildBody(
      {
        turns: [{ type: "user", text }],
        temperature: 0,
        maxTokens,
        includeUsage: true,
      },
      ctx.config,
    ),
    stream: true,
  };

  // No deadline. An honest uncached prefill of the biggest rung is the slowest
  // request in the suite, and how slow depends on a model and a machine we
  // cannot predict from here — a timeout would only turn a slow box into a
  // rung failure it did not earn. Whatever the engine does, we wait for it.
  // Only the token-budget ceiling still aborts the run.
  let timed;
  try {
    timed = await ctx.client.streamTimed(
      adapter.path,
      body,
      adapter.headers(ctx.config),
      null,
    );
  } catch (err) {
    if (err instanceof BudgetExceededError) throw err;
    return failedSample(err instanceof Error ? err.message : String(err));
  }

  if (timed.status !== 200) {
    return failedSample(errorFromBody(timed.status, timed.raw));
  }

  const reply = adapter.parseStream(timed.frames);
  ctx.client.recordUsage(reply.usage.inputTokens, reply.usage.outputTokens);

  // Every frame carrying generated text: when it arrived and how much it
  // carried. The first gives TTFT; the spacing of the rest is the speculation
  // signature; the SIZES are what keep a delta-coalescing server from
  // inflating the client-observed rate (a late, fat first frame shortens the
  // measured window while the classic numerator keeps every token).
  const textFrameTimes: number[] = [];
  const textFrames: { timeMs: number; chars: number }[] = [];
  for (let i = 0; i < timed.frames.length; i += 1) {
    const parsed = tryParseJson(timed.frames[i]!.data);
    if (parsed.ok) {
      const text = adapter.frameText(parsed.value);
      if (text !== "") {
        textFrameTimes.push(timed.frameTimesMs[i]!);
        textFrames.push({ timeMs: timed.frameTimesMs[i]!, chars: text.length });
      }
    }
  }

  const firstTextMs = textFrameTimes[0] ?? null;
  const ttftMs = firstTextMs !== null ? firstTextMs - timed.startMs : null;

  // Delivery rate over the window generated text arrived in. The window spans
  // reasoning frames too (frameText returns them), so the numerator must be
  // ALL output tokens — a visible-only count against a window that includes
  // the thinking phase deflates toward zero, and a visible-only window does
  // not exist client-side once a server interleaves the two.
  const delivery = deliveryRate(textFrames, reply.usage.outputTokens);

  return {
    ttftMs,
    decodeTokPerSec: delivery.rate,
    // Prefill: prompt tokens divided by time-to-first-token — the standard
    // proxy, since TTFT is dominated by prompt ingestion on a long prompt.
    prefillTokPerSec:
      ttftMs !== null ? tokensPerSecond(reply.usage.inputTokens, ttftMs) : null,
    outputTokens: reply.usage.outputTokens,
    inputTokens: reply.usage.inputTokens,
    cachedInputTokens: reply.usage.cachedInputTokens ?? null,
    wallMs: timed.endMs - timed.startMs,
    text: reply.text,
    stepProfile: analyzeStepProfile(textFrameTimes, reply.usage.outputTokens),
    streamCoalesced: delivery.coalesced,
    streamNote: delivery.note,
  };
}

/** Warmup (discarded) + K measured runs of the same request. */
async function measure(
  ctx: RunContext,
  surface: string,
  text: string,
  maxTokens: number,
  metric: "decodeTokPerSec" | "prefillTokPerSec",
  onSample?: (sample: BenchSample) => void,
  label = "",
): Promise<RunSample[]> {
  // Reported after each run rather than before it, because the number is the
  // point: a bare "decode 2/3" says only that something is happening.
  const report = (run: RunSample, tag: string, warmup: boolean): void =>
    onSample?.({
      label: `${label} ${tag}`,
      value: run[metric],
      unit: "tok/s",
      warmup,
      error: run.error,
    });

  // Busted per call: these scenarios send the same text K+1 times, and the
  // warmup alone would otherwise serve every measured run from a warm KV.
  const warm = await timedRun(ctx, surface, cacheBust(text), maxTokens);
  report(warm, "warmup", true);

  const samples: RunSample[] = [];
  for (let i = 0; i < K; i += 1) {
    const run = await timedRun(ctx, surface, cacheBust(text), maxTokens);
    samples.push(run);
    report(run, `${i + 1}/${K}`, false);
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

/** Median decode rate over the runs that produced one, or 0. */
const medianDecode = (samples: RunSample[]): number =>
  median(
    samples
      .map((s) => s.decodeTokPerSec)
      .filter((v): v is number => v !== null),
  );

/**
 * Does speculation still pay at this rung?
 *
 * Two independent readings, because each fails in a different way. The step
 * profile comes free off the novel runs and needs no comparison at all, but
 * goes quiet whenever the engine buffers its stream. The echo-vs-novel ratio
 * survives buffering, but only counts when the model actually echoed.
 */
function rungSpeculation(
  coding: RunSample[],
  ceiling: RunSample[],
): ContextSpeculative {
  const notes: string[] = [];

  const stepsOf = (runs: RunSample[]): number | null => {
    const values = runs
      .map((s) => s.stepProfile.tokensPerStep)
      .filter((v): v is number => v !== null);
    return values.length > 0 ? Math.round(median(values) * 100) / 100 : null;
  };

  const tokensPerStep = stepsOf(coding);
  if (tokensPerStep === null) {
    const why = coding.map((s) => s.stepProfile.note).find(Boolean);
    if (why) notes.push(why);
  }

  // Did the coding task actually reach into the context? A model that ignores
  // the planted constant is being timed on generation with a large irrelevant
  // prefix, which is not what this rung claims to measure.
  const grounded = coding.filter((s) => usedPlantedConstant(s.text));
  if (coding.length > 0 && grounded.length === 0) {
    notes.push(`answer never used ${PLANTED_CONSTANT} — context may be unread`);
  }

  const ok = ceiling.filter((s) => s.error === undefined);
  const codingTps = medianDecode(coding);
  const ceilingTps = medianDecode(ok);
  const rated =
    ceilingTps > 0 && codingTps > 0
      ? classifySpeculative(ceilingTps, codingTps)
      : null;

  return {
    predictableTokPerSec:
      ceilingTps > 0 ? Math.round(ceilingTps * 10) / 10 : null,
    predictableTokensPerStep: stepsOf(ok),
    ratio: rated?.ratio ?? null,
    verdict: rated?.verdict ?? null,
    tokensPerStep,
    note: notes.length > 0 ? notes.join(" · ") : null,
  };
}

/**
 * Decode + latency + prefill + speculation as the prompt grows. One run per
 * rung by default (the only real cost is the big prefill); --full climbs to
 * 64k, takes the median of 3 runs per rung, and adds the counting variant.
 *
 * Each rung is sized from the token counts earlier rungs actually produced, so
 * a rung labelled 8k really ingests ~8k, and the x-axis still reports what the
 * engine counted rather than what we aimed for.
 *
 * Each run builds one archive and asks two or three different things of it.
 * Sharing the prefix is deliberate: only the summarise variant supplies TTFT
 * and prefill, so a prefix-cache hit on the others costs nothing and saves the
 * whole uncached prefill — which is what makes the extra variants nearly free
 * at the big rungs on any engine with prefix caching.
 *
 * A rung where every run fails ends the ladder with the engine's own error on
 * the point (typically a context-window overflow) — larger rungs can only fail
 * the same way, and burning minutes to prove it helps nobody.
 */
async function contextScaling(
  ctx: RunContext,
  surface: string,
  onProgress?: (label: string) => void,
  onRung?: (point: ContextPoint) => void,
): Promise<ContextPoint[]> {
  const full = ctx.config.depth === "full";
  const ladder = full ? CONTEXT_LADDER_FULL : CONTEXT_LADDER;
  const runsPerRung = full ? CONTEXT_RUNS_FULL : 1;
  const points: ContextPoint[] = [];
  const fits: LadderFit[] = [];

  // One throwaway request in exactly the ladder's shape, generating a single
  // token, so even the first rung is sized against this tokenizer instead of a
  // guess. Cheap: it is the smallest prefill in the whole benchmark.
  onProgress?.("context calibrating");
  const calibration = await timedRun(
    ctx,
    surface,
    `${buildArchive(CALIBRATION_FILLER_BYTES)}\n\n${CODE_INSTRUCTION}`,
    1,
  );
  if (typeof calibration.inputTokens === "number") {
    fits.push({
      bytes: CALIBRATION_FILLER_BYTES,
      tokens: calibration.inputTokens,
    });
  }

  for (const target of ladder) {
    const novel: RunSample[] = [];
    const counting: RunSample[] = [];
    const fillerBytes = fillerBytesFor(target, fits, RUNG_FIXED_CHARS);

    for (let i = 0; i < runsPerRung; i += 1) {
      const nth = runsPerRung > 1 ? ` ${i + 1}/${runsPerRung}` : "";
      const label = `context ~${fmtK(target)}`;
      const archive = buildArchive(fillerBytes);
      const ask = (instruction: string): Promise<RunSample> =>
        timedRun(
          ctx,
          surface,
          `${archive}\n\n${instruction}`,
          CONTEXT_GEN_TOKENS,
        );

      onProgress?.(`${label}${nth}`);
      const baseline = await ask(CODE_INSTRUCTION);
      novel.push(baseline);
      // A rung the engine cannot answer at all gets no speculation probe: the
      // ceiling run would only fail the same way, slowly.
      if (baseline.error !== undefined) break;

      onProgress?.(`${label} ceiling${nth}`);
      counting.push(await ask(COUNT_INSTRUCTION));
    }

    const ok = novel.filter((s) => s.error === undefined);
    const ttfts = ok
      .map((s) => s.ttftMs)
      .filter((v): v is number => v !== null);
    const decodes = ok
      .map((s) => s.decodeTokPerSec)
      .filter((v): v is number => v !== null);
    const prefills = ok
      .map((s) => s.prefillTokPerSec)
      .filter((v): v is number => v !== null);

    const inputTokens =
      ok.map((s) => s.inputTokens).find((v) => typeof v === "number") ?? null;
    if (inputTokens !== null)
      fits.push({ bytes: fillerBytes, tokens: inputTokens });

    const point: ContextPoint = {
      targetTokens: target,
      inputTokens,
      decodeTokPerSec:
        decodes.length > 0 ? Math.round(median(decodes) * 10) / 10 : null,
      ttftMs: ttfts.length > 0 ? Math.round(median(ttfts)) : null,
      prefillTokPerSec:
        prefills.length > 0 ? Math.round(median(prefills)) : null,
      speculative: null,
      runs: ok.length,
      note: null,
    };

    if (ok.length === 0) {
      point.note = novel[0]?.error ?? "no successful run";
      points.push(point);
      onRung?.(point);
      break;
    }

    point.speculative = rungSpeculation(ok, counting);
    points.push(point);
    // Reported as each rung lands rather than only at the end: the ladder is
    // the longest part of the run, and a 64k rung alone can take minutes.
    onRung?.(point);
  }

  return points;
}

/**
 * Does the prefix cache save work? Same prompt twice, cold TTFT versus warm.
 *
 * The one place in the suite that deliberately *wants* a cache hit — the rest
 * of the benchmark busts the cache on every request. Busted once and reused, so
 * the first request is genuinely cold even across llmprobe invocations while
 * the second is an exact repeat.
 */
async function prefixCacheProbe(
  ctx: RunContext,
  surface: string,
  onProgress?: (label: string) => void,
): Promise<PrefixCacheResult | null> {
  const prompt =
    cacheBust(buildLongPrefix(PREFIX_CACHE_SEED, PREFIX_CACHE_PROMPT_BYTES)) +
    "\n\nReply with just the word: OK.";

  onProgress?.("prefix cache cold");
  const cold = await timedRun(ctx, surface, prompt, PREFILL_TOKENS);
  if (cold.error !== undefined) return null;

  onProgress?.("prefix cache warm");
  const warm = await timedRun(ctx, surface, prompt, PREFILL_TOKENS);
  if (warm.error !== undefined) return null;

  const { speedup, verdict } = classifyPrefixCache(cold.ttftMs, warm.ttftMs);
  return {
    coldTtftMs: cold.ttftMs,
    warmTtftMs: warm.ttftMs,
    speedup,
    cachedTokens: warm.cachedInputTokens,
    promptTokens: warm.inputTokens,
    verdict,
  };
}

/**
 * Batched or queued? One stream alone against a burst of four.
 *
 * Aggregate throughput is the burst's output tokens over the burst's wall
 * clock — not a sum of per-request rates, which would report a queue as
 * perfectly parallel. Prompts differ per stream so the engine is batching
 * rather than serving three of them from one cache entry.
 */
async function batchingProbe(
  ctx: RunContext,
  surface: string,
  onProgress?: (label: string) => void,
): Promise<BatchingResult | null> {
  const ask = (i: number): string =>
    cacheBust(
      `Write a short descriptive paragraph. Subject number ${i}: ` +
        "a harbour at dawn, a kite above a field, a ledger, a paper lantern.",
    );
  const rate = (tokens: number | null, wallMs: number): number | null =>
    tokensPerSecond(tokens, wallMs);

  onProgress?.("batching 1 stream");
  const single = await timedRun(ctx, surface, ask(0), BATCH_GEN_TOKENS);
  if (single.error !== undefined) return null;

  onProgress?.(`batching ${BATCH_STREAMS} streams`);
  const startedMs = Date.now();
  const burst = await runConcurrent(BATCH_STREAMS, BATCH_STREAMS, (i) =>
    timedRun(ctx, surface, ask(i + 1), BATCH_GEN_TOKENS),
  );
  const burstWallMs = Date.now() - startedMs;

  const singleTokPerSec = rate(single.outputTokens, single.wallMs);
  const complete = burst.every((s) => s.error === undefined);
  const burstTokens = burst.reduce((sum, s) => sum + (s.outputTokens ?? 0), 0);
  const aggregateTokPerSec = complete ? rate(burstTokens, burstWallMs) : null;

  const ttfts = burst
    .map((s) => s.ttftMs)
    .filter((v): v is number => v !== null);

  const { efficiency, verdict } = classifyBatching(
    singleTokPerSec,
    aggregateTokPerSec,
    BATCH_STREAMS,
  );

  return {
    streams: BATCH_STREAMS,
    singleTokPerSec:
      singleTokPerSec !== null ? Math.round(singleTokPerSec * 10) / 10 : null,
    aggregateTokPerSec:
      aggregateTokPerSec !== null
        ? Math.round(aggregateTokPerSec * 10) / 10
        : null,
    efficiency,
    worstTtftMs: ttfts.length > 0 ? Math.max(...ttfts) : null,
    verdict,
  };
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
  onRung?: (point: ContextPoint) => void,
  onSample?: (sample: BenchSample) => void,
): Promise<BenchReport | null> {
  const surface = ctx.evalSurface;
  if (!surface) return null;

  // Decode + TTFT from a free-form generation.
  const decodeSamples = await measure(
    ctx,
    surface,
    DECODE_PROMPT,
    DECODE_TOKENS,
    "decodeTokPerSec",
    onSample,
    "decode",
  );
  // Where the drift check starts counting from: everything after this point is
  // sustained load on the same box.
  const decodeMeasuredMs = Date.now();
  const decodeStat = pick(decodeSamples, "decodeTokPerSec");

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
    "prefillTokPerSec",
    onSample,
    "prefill",
  );

  // Speculative / MTP probe: predictable echo versus novel generation.
  const predictable = await measure(
    ctx,
    surface,
    `Repeat the following passage exactly, word for word:\n\n${PREDICTABLE_PASSAGE}`,
    DECODE_TOKENS,
    "decodeTokPerSec",
    onSample,
    "spec:predictable",
  );
  const novel = await measure(
    ctx,
    surface,
    "Invent an original, surprising paragraph of stream-of-consciousness prose. Avoid common phrases.",
    DECODE_TOKENS,
    "decodeTokPerSec",
    onSample,
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

  // The frame-gap reading of the same runs: independent of the ratio, and the
  // only one of the two that still says something when a model refuses to echo.
  const predSteps = predictable
    .map((s) => s.stepProfile.tokensPerStep)
    .filter((v): v is number => v !== null);

  let speculative: SpeculativeResult | null = null;
  if (predTps > 0 && novelTps > 0) {
    const { ratio, verdict } = classifySpeculative(predTps, novelTps);
    speculative = {
      predictableTokPerSec: Math.round(predTps * 10) / 10,
      novelTokPerSec: Math.round(novelTps * 10) / 10,
      ratio,
      verdict,
      tokensPerStep:
        predSteps.length > 0 ? Math.round(median(predSteps) * 100) / 100 : null,
      tokensPerStepNote:
        predSteps.length > 0
          ? null
          : (predictable.map((s) => s.stepProfile.note).find(Boolean) ?? null),
      reasoningCaveat: reasoningModel,
    };
  }

  const prefillPromptTokens =
    prefillSamples
      .map((s) => s.inputTokens)
      .find((v) => typeof v === "number") ?? null;

  // Server features: cheap yes/no checks, not curves.
  const prefixCache = await prefixCacheProbe(ctx, surface, onProgress);
  const batching = await batchingProbe(ctx, surface, onProgress);

  const contextPoints = await contextScaling(ctx, surface, onProgress, onRung);

  // Last thing the benchmark does: the opening decode scenario again, after
  // every other probe has loaded the box for minutes. One request, and it is
  // what says whether the figures above are stable or a moving target. No
  // warmup — the engine could not be warmer by now, which is the point.
  onProgress?.("sustained load");
  const drifted = await timedRun(
    ctx,
    surface,
    cacheBust(DECODE_PROMPT),
    DECODE_TOKENS,
  );
  const firstDecode = decodeStat?.median ?? null;
  const lastDecode =
    drifted.error === undefined ? drifted.decodeTokPerSec : null;
  const { driftPct, verdict: driftVerdict } = classifyLoadDrift(
    firstDecode,
    lastDecode,
  );
  const loadDrift: LoadDriftResult = {
    firstTokPerSec: firstDecode,
    lastTokPerSec:
      lastDecode !== null ? Math.round(lastDecode * 10) / 10 : null,
    driftPct,
    elapsedMs: Date.now() - decodeMeasuredMs,
    verdict: driftVerdict,
  };

  // Coalescing caveat: any timed stream whose first frame carried a
  // disproportionate share of the output. The rates are already corrected
  // (pre-window tokens excluded); the caveat says the correction engaged,
  // because a coalescing server's numbers are not comparable to a per-token
  // stream's under the classic math other tools report.
  const streamed = [...decodeSamples, ...predictable, ...novel, drifted];
  const coalescedCount = streamed.filter((s) => s.streamCoalesced).length;
  const streamCaveat =
    coalescedCount > 0
      ? `${coalescedCount} of ${streamed.length} timed streams arrived with coalesced deltas — client-observed rates exclude tokens already in flight at the window start`
      : null;

  return {
    decodeTokPerSec: decodeStat,
    streamCaveat,
    ttftMs: pick(decodeSamples, "ttftMs"),
    prefillTokPerSec: pick(prefillSamples, "prefillTokPerSec"),
    prefillPromptTokens,
    speculative,
    prefixCache,
    batching,
    loadDrift,
    machine: machineInfo(),
    contextScaling: contextPoints.length > 0 ? contextPoints : null,
  };
}
