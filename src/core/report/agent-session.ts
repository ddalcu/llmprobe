import type { AgentSessionReport } from "../outcome";

const fmt = (value: number | null) =>
  value === null ? "unknown" : String(Math.round(value * 10) / 10);

export function agentSessionLines(report: AgentSessionReport): string[] {
  const lines = [
    "Agent session — one serial coding conversation; no real tools",
    `scenario: ${report.scenario}; prefix seed: ${JSON.stringify(report.prefixSeed)}`,
    `base ~${report.baseTokens}; warmup input ${fmt(report.prefixInputTokens)}; target ${report.targetTokens}; reached ${fmt(report.reachedInputTokens)} input tokens; overshoot ${fmt(report.overshootTokens)}`,
    `stop: ${report.stop}${report.note ? ` — ${report.note}` : ""}`,
    `measured wall ${fmt(report.elapsedMs / 1000)}s; aggregate ${fmt(report.aggregateTokPerSec)} output tok/s; ${fmt(report.turnsPerSec)} turns/s`,
    `measured usage: input ${fmt(report.inputTokens)}; output ${fmt(report.outputTokens)}; cached input ${fmt(report.cachedInputTokens)}`,
    `sampling: temperature ${report.sampling.temperature}; top_p ${report.sampling.topP ?? "default"}; reasoning ${report.reasoningEffort ?? "engine default"}`,
    "Warmups excluded. Elapsed time includes every measured prefill and generation, through completion of the target-crossing turn. Input totals count repeated history, not unique context.",
    "Decode windows use usage-calibrated character estimates, not exact token positions. Complete windows only in summaries; partial tails retained in JSON. TTFT includes queueing; no isolated prefill speed inferred.",
  ];
  if (report.ttftMs)
    lines.push(
      `TTFT p50/p95: ${fmt(report.ttftMs.p50)} / ${fmt(report.ttftMs.p95)} ms`,
    );
  if (report.latencyMs)
    lines.push(
      `turn latency p50/p95: ${fmt(report.latencyMs.p50)} / ${fmt(report.latencyMs.p95)} ms`,
    );
  if (report.streamGapMs)
    lines.push(
      `stream gap p50/p95/max: ${fmt(report.streamGapMs.p50)} / ${fmt(report.streamGapMs.p95)} / ${fmt(report.streamGapMs.max)} ms`,
    );
  for (const turn of report.turns) {
    lines.push(
      `turn ${turn.turn} ${turn.task}: input ${fmt(turn.inputTokens)}; output ${fmt(turn.outputTokens)}/${turn.maxTokens}; cached ${fmt(turn.cachedInputTokens)}; TTFT ${fmt(turn.ttftMs)} ms; wall ${fmt(turn.wallMs)} ms; decode ${fmt(turn.decodeTokPerSec)} tok/s; finish ${turn.finishReason ?? "unknown"}`,
    );
    if (turn.summary)
      lines.push(
        `  windows first/last ${fmt(turn.summary.firstTokPerSec)} / ${fmt(turn.summary.lastTokPerSec)}; mean ${fmt(turn.summary.meanTokPerSec)}; median ${fmt(turn.summary.medianTokPerSec)}; min–max ${fmt(turn.summary.minTokPerSec)}–${fmt(turn.summary.maxTokPerSec)} tok/s`,
      );
    if (turn.note || turn.error) lines.push(`  ${turn.error ?? turn.note}`);
  }
  return lines;
}
