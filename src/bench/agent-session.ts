import { randomUUID } from "node:crypto";
import type { Turn } from "../core/adapter";
import { BudgetExceededError } from "../core/client";
import type { RunContext } from "../core/context";
import type { AgentSessionReport } from "../core/outcome";
import type { BenchSample, TimedRun } from "./index";
import { agentSessionPrefix, agentSessionTask } from "./agent-session-corpus";
import { decodeWindows, median, tokensPerSecond } from "./stats";

function percentiles(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: median(sorted),
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
  };
}

export async function runAgentSession(
  ctx: RunContext,
  run: TimedRun,
  onProgress?: (label: string) => void,
  onSample?: (sample: BenchSample) => void,
): Promise<AgentSessionReport> {
  const settings = ctx.config.agentSession!;
  const prefixSeed = settings.prefixSeed ?? randomUUID();
  const surface = ctx.evalSurface!;
  let bytes = settings.baseTokens * 4;
  let prefix = agentSessionPrefix(prefixSeed, bytes);
  onProgress?.("agent session prefix calibration");
  let warm = await run(ctx, surface, "Reply OK.", 1, undefined, prefix);
  if (warm.error) throw new Error(`prefix warmup failed: ${warm.error}`);
  // Fit once before the measured conversation; never rewrite an in-use prefix.
  if (warm.inputTokens !== null && warm.inputTokens > 0) {
    const ratio = settings.baseTokens / warm.inputTokens;
    if (Math.abs(ratio - 1) > 0.03) {
      bytes = Math.round(
        Math.min(
          settings.baseTokens * 8,
          Math.max(settings.baseTokens * 2, bytes * ratio),
        ),
      );
      prefix = agentSessionPrefix(prefixSeed, bytes);
      onProgress?.("agent session fitted prefix warmup");
      warm = await run(ctx, surface, "Reply OK.", 1, undefined, prefix);
      if (warm.error) throw new Error(`prefix warmup failed: ${warm.error}`);
    }
  }
  onProgress?.("agent session coding warmup");
  const warmup = await run(
    ctx,
    surface,
    "Write a TypeScript job validator with tests.",
    256,
    undefined,
    prefix,
  );
  if (warmup.error) throw new Error(`coding warmup failed: ${warmup.error}`);

  const report: AgentSessionReport = {
    scenario: "queue-maintenance-v1",
    prefixSeed,
    baseTokens: settings.baseTokens,
    targetTokens: settings.targetTokens,
    prefixInputTokens: warm.inputTokens,
    reachedInputTokens: null,
    overshootTokens: null,
    maxTurns: settings.maxTurns,
    windowTokens: settings.windowTokens,
    elapsedMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    aggregateTokPerSec: null,
    turnsPerSec: null,
    ttftMs: null,
    latencyMs: null,
    streamGapMs: null,
    stop: "turn-limit",
    note: null,
    sampling: {
      temperature: ctx.config.benchSampling?.temperature ?? 0,
      ...(ctx.config.benchSampling?.topP !== undefined
        ? { topP: ctx.config.benchSampling.topP }
        : {}),
    },
    reasoningEffort: ctx.config.reasoningEffort ?? null,
    turns: [],
  };
  const turns: Turn[] = [];
  const gaps: number[] = [];
  const started = Date.now();
  for (let turn = 1; turn <= settings.maxTurns; turn += 1) {
    const task = agentSessionTask(turn);
    turns.push({ type: "user", text: task.text });
    onProgress?.(`agent session ${turn}/${settings.maxTurns}: ${task.name}`);
    const startMs = Date.now() - started;
    let sample;
    try {
      sample = await run(
        ctx,
        surface,
        turns,
        task.maxTokens,
        undefined,
        prefix,
      );
    } catch (err) {
      if (!(err instanceof BudgetExceededError)) throw err;
      report.stop = "budget";
      report.note = err.message;
      break;
    }
    const endMs = Date.now() - started;
    const profile = decodeWindows(
      sample.textFrames,
      sample.outputTokens,
      settings.windowTokens,
    );
    report.turns.push({
      turn,
      task: task.name,
      text: sample.text,
      reasoningText: sample.reasoningText,
      bundleTokens: task.bundleTokens,
      maxTokens: task.maxTokens,
      startMs,
      endMs,
      inputTokens: sample.inputTokens,
      outputTokens: sample.outputTokens,
      cachedInputTokens: sample.cachedInputTokens,
      ttftMs: sample.ttftMs,
      wallMs: endMs - startMs,
      decodeTokPerSec: profile.decodeTokPerSec,
      finishReason: sample.finishReason,
      windows: profile.windows,
      summary: profile.summary,
      note:
        [
          sample.streamNote,
          profile.note,
          sample.cachedInputTokens === null
            ? "prefix reuse not reported"
            : null,
        ]
          .filter(Boolean)
          .join(" · ") || null,
      ...(sample.error ? { error: sample.error } : {}),
    });
    for (const field of [
      "inputTokens",
      "outputTokens",
      "cachedInputTokens",
    ] as const) {
      const value = sample[field];
      report[field] =
        report[field] === null || value === null ? null : report[field] + value;
    }
    for (let i = 1; i < sample.textFrames.length; i += 1) {
      gaps.push(
        sample.textFrames[i]!.timeMs - sample.textFrames[i - 1]!.timeMs,
      );
    }
    onSample?.({
      label: `session ${turn} ~${sample.inputTokens ?? "?"} input`,
      value: profile.decodeTokPerSec,
      unit: "tok/s",
      warmup: false,
      error: sample.error,
    });
    if (sample.error) {
      report.stop = "engine-error";
      report.note = sample.error;
      break;
    }
    report.reachedInputTokens = sample.inputTokens;
    if (sample.inputTokens === null) {
      report.stop = "missing-usage";
      report.note =
        "input-token usage missing — target context cannot be verified";
      break;
    }
    if (sample.inputTokens >= settings.targetTokens) {
      report.stop = "target";
      report.overshootTokens = sample.inputTokens - settings.targetTokens;
      break;
    }
    turns.push({
      type: "assistant-text",
      text: sample.text,
      ...(sample.reasoningText ? { reasoning: sample.reasoningText } : {}),
    });
  }
  report.elapsedMs = Date.now() - started;
  const complete = report.turns.filter((turn) => !turn.error);
  report.aggregateTokPerSec = tokensPerSecond(
    report.outputTokens,
    report.elapsedMs,
  );
  report.turnsPerSec = tokensPerSecond(complete.length, report.elapsedMs);
  report.ttftMs = percentiles(
    complete.flatMap((turn) => (turn.ttftMs === null ? [] : [turn.ttftMs])),
  );
  report.latencyMs = percentiles(complete.map((turn) => turn.wallMs));
  const gapStats = percentiles(gaps);
  report.streamGapMs = gapStats
    ? { ...gapStats, max: gaps.reduce((max, gap) => Math.max(max, gap), 0) }
    : null;
  if (report.stop === "turn-limit")
    report.note = "safety turn limit reached before target context";
  return report;
}
