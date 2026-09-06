import type { ReasoningEffort } from "../core/adapter";

export type ReasoningSource =
  | "GPQA Diamond"
  | "GPQA Diamond (modified)"
  | "SuperGPQA"
  | "AIME2025"
  | "COMPSEC"
  | "MMLU-Pro"
  | "OlympiadBench"
  | "LiveBench"
  | "NIST Juliet";

/** core: the 12B floor check. hard: the ds4 hard suite, for large models. */
export type ReasoningSuite = "core" | "hard";

export interface ReasoningCase {
  source: ReasoningSource;
  id: string;
  domain: string;
  title: string;
  question: string;
  /** Multiple choice when present; otherwise an integer (AIME) or line spec (COMPSEC). */
  choices?: string[];
  answer: string;
  /** Open-answer form. Unset: choices → letter, COMPSEC/Juliet → line set, else integer. */
  kind?: "rational" | "sequence" | "text";
  /** Equivalent surface forms of the answer. */
  aliases?: string[];
  /** Generation cap for this case; an explicit --eval-max-tokens overrides it. */
  maxTokens?: number;
}

export type ReasoningStatus = "passed" | "failed" | "stopped" | "error";

export interface ReasoningCaseResult {
  id: string;
  source: ReasoningSource;
  domain: string;
  title: string;
  status: ReasoningStatus;
  expected: string;
  got: string;
  /** Visible answer text, thinking stripped. Kept so a run can be regraded offline. */
  text: string;
  finishReason: string | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  durationMs: number;
  error?: string;
}

export interface ReasoningSourceSummary {
  source: string;
  passed: number;
  failed: number;
  stopped: number;
  error: number;
  total: number;
}

export interface ReasoningReport {
  suite: ReasoningSuite;
  passed: number;
  total: number;
  /** Ran out of tokens before an answer line; reported apart from wrong. */
  stopped: number;
  error: number;
  maxTokens: number;
  temperature: number;
  /** Effort asked for on every question; null when --reasoning off. */
  reasoningEffort: ReasoningEffort | null;
  /** The engine 400'd the effort param, so the run fell back to the engine's default. */
  reasoningEffortRejected: boolean;
  bySource: ReasoningSourceSummary[];
  cases: ReasoningCaseResult[];
  /** Set when --eval-questions or --eval-cases narrowed the set, or the run aborted early. */
  scopeNote: string | null;
  /** Set when the run stopped early; the completed cases are still reported. */
  aborted: { reason: "budget" | "unreachable"; message: string } | null;
}

/** ", reasoning medium" / ", reasoning medium (rejected by the engine)" / "". */
export function effortNote(r: ReasoningReport): string {
  if (!r.reasoningEffort) return "";
  return `, reasoning ${r.reasoningEffort}${r.reasoningEffortRejected ? " (rejected by the engine, ran at its default)" : ""}`;
}
