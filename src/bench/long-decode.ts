import { randomUUID } from "node:crypto";
import type { RunContext } from "../core/context";
import type { LongDecodeReport, LongDecodeSample } from "../core/outcome";
import type { BenchSample, TimedRun } from "./index";
import { buildCodeContext } from "./corpus";
import { decodeWindows, tokensPerSecond } from "./stats";

export function longDecodePrefix(seed: string, contextTokens: number): string {
  return (
    `[long-decode prefix ${JSON.stringify(seed)}]\n` +
    "Use the reference code below as background. Follow the user's output task.\n\n" +
    buildCodeContext(contextTokens * 4)
  );
}

export async function runLongDecode(
  ctx: RunContext,
  run: TimedRun,
  onProgress?: (label: string) => void,
  onSample?: (sample: BenchSample) => void,
): Promise<LongDecodeReport> {
  const { contextTokens, maxTokens, windowTokens } = ctx.config.longDecode!;
  const prefixSeed = ctx.config.longDecode!.prefixSeed ?? randomUUID();
  const prefix = longDecodePrefix(prefixSeed, contextTokens);
  const surface = ctx.evalSurface!;
  const runs = ctx.config.benchRuns ?? 3;
  const workloads: LongDecodeReport["workloads"] = [
    {
      id: "code",
      prompt:
        "Write a complete TypeScript job scheduler library. Include types, a priority queue, " +
        "dependency tracking, bounded concurrency, cancellation, retry backoff, persistence, " +
        "metrics, and a large test suite. Implement every component in full with documentation " +
        "and examples. Produce at least 800 lines of source; do not summarize or omit code.",
      samples: [],
    },
    {
      id: "prose",
      prompt:
        "Write a 20-chapter original expedition narrative. Each chapter must contain at least " +
        "500 words with dialogue, detailed scenes, and new discoveries. Start at chapter one " +
        "and continue through all chapters without summaries or an outline.",
      samples: [],
    },
    {
      id: "predictable",
      prompt:
        `Count from 1 to ${Math.max(10000, maxTokens * 2)}, one integer per line. ` +
        "Do not skip numbers, abbreviate, explain, or stop before the final integer.",
      samples: [],
    },
  ];

  // The prefix identity stays fixed; all sample-specific text follows it.
  onProgress?.(`long decode prefix warmup (seed ${prefixSeed})`);
  const warm = await run(ctx, surface, "Reply OK.", 1, undefined, prefix);
  if (warm.error) throw new Error(`prefix warmup failed: ${warm.error}`);
  onProgress?.("long decode length probe");
  const probeTokens = Math.min(32, maxTokens);
  const probe = await run(
    ctx,
    surface,
    "Reply with only the word OK.",
    probeTokens,
    { ignore_eos: true, min_tokens: probeTokens },
    prefix,
  );
  const forceLength =
    probe.error === undefined && (probe.outputTokens ?? 0) >= probeTokens;
  const extra = forceLength
    ? { ignore_eos: true, min_tokens: maxTokens }
    : undefined;
  const lengthNote = forceLength
    ? `length probe reached ${probeTokens} tokens; ignore_eos + min_tokens requested for measured runs; actual lengths recorded`
    : `length forcing unavailable${probe.error ? ` (${probe.error})` : " or ignored"}; natural stops recorded`;

  for (const workload of workloads) {
    onProgress?.(`long decode ${workload.id} warmup`);
    const warmup = await run(
      ctx,
      surface,
      `[sample warmup]\n${workload.prompt}`,
      maxTokens,
      extra,
      prefix,
    );
    onSample?.({
      label: `long:${workload.id} warmup`,
      value: null,
      unit: "tok/s",
      warmup: true,
      error: warmup.error,
    });
    for (let i = 0; i < runs; i += 1) {
      onProgress?.(`long decode ${workload.id} ${i + 1}/${runs}`);
      const sample = await run(
        ctx,
        surface,
        `[sample ${i + 1}]\n${workload.prompt}`,
        maxTokens,
        extra,
        prefix,
      );
      const profile = decodeWindows(
        sample.textFrames,
        sample.outputTokens,
        windowTokens,
      );
      const notes = [
        sample.streamNote,
        profile.note,
        sample.outputTokens !== null && sample.outputTokens < maxTokens
          ? `ended at ${sample.outputTokens} of ${maxTokens} tokens (${sample.finishReason ?? "unknown finish"})`
          : null,
        sample.cachedInputTokens === null
          ? "prefix cache reuse not reported"
          : null,
      ].filter(Boolean);
      const result: LongDecodeSample = {
        run: i + 1,
        inputTokens: sample.inputTokens,
        outputTokens: sample.outputTokens,
        cachedInputTokens: sample.cachedInputTokens,
        ttftMs: sample.ttftMs,
        wallMs: sample.wallMs,
        decodeTokPerSec: profile.decodeTokPerSec,
        endToEndTokPerSec: tokensPerSecond(sample.outputTokens, sample.wallMs),
        finishReason: sample.finishReason,
        reachedCap:
          sample.outputTokens === null
            ? null
            : sample.outputTokens >= maxTokens,
        windows: profile.windows,
        summary: profile.summary,
        note: notes.length ? notes.join(" · ") : null,
        ...(sample.error ? { error: sample.error } : {}),
      };
      workload.samples.push(result);
      onSample?.({
        label: `long:${workload.id} ${i + 1}/${runs}`,
        value: profile.decodeTokPerSec,
        unit: "tok/s",
        warmup: false,
        error: sample.error,
      });
    }
  }
  return {
    prefixSeed,
    contextTokens,
    prefixInputTokens: warm.inputTokens,
    maxTokens,
    windowTokens,
    runs,
    tokenMethod:
      "estimated tokens = output usage × chunk characters / total characters; equal-time chunks grouped; first arrival excluded; windows end on real arrivals; summaries exclude partial final window; reasoning included when streamed",
    lengthNote,
    sampling: {
      temperature: ctx.config.benchSampling?.temperature ?? 0,
      ...(ctx.config.benchSampling?.topP !== undefined
        ? { topP: ctx.config.benchSampling.topP }
        : {}),
    },
    reasoningEffort: ctx.config.reasoningEffort ?? null,
    workloads,
  };
}
