import type { LongDecodeReport } from "../outcome";

const rate = (value: number | null): string =>
  value === null ? "n/a" : `${Math.round(value * 10) / 10}`;

/** The same per-generation measurements in terminal, HTML and Markdown reports. */
export function longDecodeLines(report: LongDecodeReport): string[] {
  const lines = [
    "Long decode — shared prefix, separate output workloads",
    `prefix seed: ${JSON.stringify(report.prefixSeed)}`,
    `context: ~${report.contextTokens} tokens; warmup input: ${report.prefixInputTokens ?? "unknown"}; output cap: ${report.maxTokens}; window: ~${report.windowTokens}; runs: ${report.runs}`,
    `sampling: temperature ${report.sampling.temperature}${report.sampling.topP !== undefined ? `, top_p ${report.sampling.topP}` : ""}; reasoning effort: ${report.reasoningEffort ?? "engine default"}`,
    report.tokenMethod,
    report.lengthNote,
    "Rates in tok/s. Window summaries use complete windows only; partial tail shown separately.",
  ];
  for (const workload of report.workloads) {
    lines.push("", workload.id);
    for (const sample of workload.samples) {
      lines.push(
        `  run ${sample.run}: ${sample.outputTokens ?? "unknown"} output tokens; finish ${sample.finishReason ?? "unknown"}; ${sample.reachedCap === null ? "cap attainment unknown" : sample.reachedCap ? "cap reached" : "cap not reached"}`,
      );
      if (sample.error) lines.push(`    error: ${sample.error}`);
      lines.push(
        `    whole decode ${rate(sample.decodeTokPerSec)}; end-to-end ${rate(sample.endToEndTokPerSec)}; wall ${Math.round(sample.wallMs)} ms; TTFT ${sample.ttftMs === null ? "unknown" : `${Math.round(sample.ttftMs)} ms`}`,
      );
      lines.push(
        `    cached input ${sample.cachedInputTokens ?? "unknown"} / ${sample.inputTokens ?? "unknown"} tokens`,
      );
      const summary = sample.summary;
      if (summary) {
        lines.push(
          `    windows ${summary.completeWindows}: first ${rate(summary.firstTokPerSec)}; last ${rate(summary.lastTokPerSec)}; mean ${rate(summary.meanTokPerSec)}; median ${rate(summary.medianTokPerSec)}; min–max ${rate(summary.minTokPerSec)}–${rate(summary.maxTokPerSec)}; change ${summary.changePct === null ? "n/a" : `${summary.changePct}%`}`,
        );
      } else lines.push("    complete window statistics unavailable");
      if (sample.note) lines.push(`    ${sample.note}`);
      for (const window of sample.windows) {
        lines.push(
          `    ~${window.startTokens}–${window.endTokens} tokens: ${rate(window.tokPerSec)} (${Math.round(window.startMs)}–${Math.round(window.endMs)} ms${window.complete ? "" : "; partial"})`,
        );
      }
    }
  }
  return lines;
}
