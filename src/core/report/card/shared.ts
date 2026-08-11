import { CATEGORY_FLOOR_PCT, type EvalCategory } from "../../outcome";
import type { JsonReport } from "../json";

export { CATEGORY_FLOOR_PCT };

export const CATEGORY_LABELS: Record<string, string> = {
  "tool-selection": "Tool selection",
  "tool-restraint": "Tool restraint",
  "tool-args": "Tool argument fidelity",
  multiturn: "Multi-turn state",
  instructions: "Instruction following",
  "json-discipline": "JSON discipline",
  "long-context": "Long-context recall",
  reasoning: "Basic reasoning",
  knowledge: "Basic knowledge",
};

export const AGENTIC_FAILURE_GLOSS: Record<string, string> = {
  "no-tool-call": "Answered without using tools (priors / guess)",
  "wrong-answer": "Used tools but final state or answer was wrong",
  "step-limit": "Hit the step cap before finishing cleanly",
  "engine-error": "Engine/API error during the agent loop",
};

export function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function shortModel(name: string | undefined | null): string {
  if (!name) return "run";
  return name
    .replace(/-MLX-4bit$/i, "")
    .replace(/-NVFP4-mlx$/i, "")
    .replace(/-mlx$/i, "");
}

export function slug(name: string | undefined | null): string {
  return (
    shortModel(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "run"
  );
}

/** Human-facing endpoint: host and port, no protocol, no trailing /v1. */
export function endpointLabel(baseUrl: string | undefined | null): string {
  if (!baseUrl) return "";
  const raw = String(baseUrl).trim();
  try {
    return new URL(raw.includes("://") ? raw : `http://${raw}`).host;
  } catch {
    return raw.replace(/^[a-z]+:\/\//i, "").split("/")[0] ?? "";
  }
}

/**
 * Library identity: which model, on which endpoint.
 *
 * Two engines serving one model is the comparison llmprobe exists for, so the
 * URL — not the model name alone — is what separates their entries. Keying on
 * the model alone made a second probe silently overwrite the first.
 */
export function runSlug(
  model: string | undefined | null,
  baseUrl: string | undefined | null,
): string {
  const host = endpointLabel(baseUrl)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
  return host ? `${slug(model)}--${host}` : slug(model);
}

export function tier(
  report: JsonReport,
  name: string,
): JsonReport["coverage"]["byTier"][number] | null {
  return report.coverage?.byTier?.find((t) => t.tier === name) ?? null;
}

export function toneForPct(
  n: number | null | undefined,
  { perfect = true }: { perfect?: boolean } = {},
): string {
  if (n == null) return "neutral";
  if (perfect && n === 100) return "good";
  if (n >= 90) return "good";
  if (n >= 70) return "caution";
  return "critical";
}

export function verdictTone(v: string | null | undefined): string {
  return v === "below-floor"
    ? "critical"
    : v === "strong" || v === "capable"
      ? "good"
      : "neutral";
}

export function catLabel(id: string): string {
  return CATEGORY_LABELS[id] ?? id;
}

export function mustFailures(report: JsonReport): Array<{
  result: JsonReport["conformance"]["results"][number];
  failure: JsonReport["conformance"]["results"][number]["failures"][number];
}> {
  const out: Array<{
    result: JsonReport["conformance"]["results"][number];
    failure: JsonReport["conformance"]["results"][number]["failures"][number];
  }> = [];
  for (const result of report.conformance?.results ?? []) {
    for (const failure of result.failures ?? []) {
      if (failure.severity === "MUST") out.push({ result, failure });
    }
  }
  return out;
}

export function outcomeCounts(report: JsonReport): Record<string, number> {
  const c: Record<string, number> = {
    pass: 0,
    fail: 0,
    unsupported: 0,
    inconclusive: 0,
    skipped: 0,
  };
  for (const r of report.conformance?.results ?? []) {
    if (r.outcome in c) c[r.outcome]! += 1;
  }
  if (
    c.inconclusive === 0 &&
    (report.conformance?.inconclusive?.length ?? 0) > 0
  ) {
    c.inconclusive = report.conformance!.inconclusive!.length;
  }
  return c;
}

export function barFill(p: number | null | undefined, kind = "engine"): string {
  const w = Math.max(0, Math.min(100, p ?? 0));
  const cls =
    p == null
      ? "fill"
      : p < 70
        ? "fill critical"
        : p < 90 && kind === "engine"
          ? "fill caution"
          : kind === "model"
            ? "fill model"
            : "fill";
  return `<span class="track"><span class="${cls}" style="width:${w}%"></span></span>`;
}

export function fmtDuration(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

export function fmtTokens(n: number | null | undefined): string | null {
  return n == null ? null : n.toLocaleString("en-US");
}

export function statusPill(outcome: string): string {
  const map: Record<string, [string, string]> = {
    pass: ["pass", "pass"],
    fail: ["fail", "fail"],
    unsupported: ["unsupported", "unsupported"],
    inconclusive: ["inconclusive", "inconclusive"],
    skipped: ["skipped", "skipped"],
    supported: ["supported", "supported"],
    missing: ["fail", "missing"],
    "not-probed": ["not-probed", "not probed"],
    partial: ["partial", "partial"],
  };
  const [cls, label] = map[outcome] ?? ["not-probed", outcome];
  return `<span class="status-pill ${cls}">${esc(label)}</span>`;
}

export function coverageStatus(entry: {
  supported?: boolean;
  probed?: boolean;
}): string {
  if (entry.probed === false) return "not-probed";
  if (entry.supported) return "supported";
  return "missing";
}

export type ConfTableRow = {
  id: string;
  test: string;
  surface: string;
  outcome: string;
  reason: string;
  durationMs: number | null;
  assertion: string;
  severity: string;
  evidence: string;
  status: string;
};

export function confTableRows(report: JsonReport): ConfTableRow[] {
  const rows: ConfTableRow[] = [];
  for (const result of report.conformance?.results ?? []) {
    const base = {
      id: result.id,
      test: result.name ?? result.id,
      surface: result.surface ?? "",
      outcome: result.outcome ?? "unknown",
      reason: result.reason ?? "",
      durationMs: result.durationMs ?? null,
    };
    const failures = result.failures ?? [];
    if (result.outcome === "fail" && failures.length > 0) {
      for (const f of failures) {
        rows.push({
          ...base,
          assertion: f.label ?? f.id,
          severity: f.severity ?? "MUST",
          evidence: f.message ?? "",
          status: "fail",
        });
      }
    } else {
      rows.push({
        ...base,
        assertion:
          result.outcome === "pass"
            ? "—"
            : result.outcome === "unsupported"
              ? "feature unsupported"
              : result.outcome === "inconclusive"
                ? "not exercised"
                : result.outcome === "skipped"
                  ? "skipped"
                  : "—",
        severity: "",
        evidence: result.reason ?? "",
        status: result.outcome ?? "unknown",
      });
    }
  }
  return rows;
}

export function miniTiers(report: JsonReport): string {
  return `<div class="mini-tiers">${(report.coverage?.byTier ?? [])
    .map((t) => {
      const tone = toneForPct(t.pct);
      return `<div class="mini-tier">
        <span class="name">${esc(t.tier)}</span>
        ${barFill(t.pct)}
        <span class="n ${tone}">${t.pct}%</span>
      </div>`;
    })
    .join("")}</div>`;
}

/** Optional eval category type re-export for callers. */
export type { EvalCategory };
