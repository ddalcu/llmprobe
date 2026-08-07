import type { EvalCategory } from "../outcome";
import type { JsonReport, ReportPhase } from "./json";

export type Perspective = "model" | "deploy" | "engine";

export const PERSPECTIVES: Record<
  Perspective,
  { label: string; question: string }
> = {
  model: {
    label: "Model evaluation",
    question: "Can this model reliably do the work I need?",
  },
  deploy: {
    label: "Deployment readiness",
    question:
      "Can I integrate and operate this engine–model stack with confidence?",
  },
  engine: {
    label: "Engine diagnostics",
    question: "What is missing, broken, or regressed in the engine?",
  },
};

export const CATEGORY_LABELS: Record<EvalCategory, string> = {
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

export interface InsightSignal {
  label: string;
  value: string;
  detail?: string;
  tone?: "good" | "critical" | "caution" | "neutral";
}

export interface InsightFinding {
  kind: "critical" | "caution" | "note";
  label: string;
  detail: string;
}

export interface PerspectiveInsights {
  perspective: Perspective;
  title: string;
  question: string;
  conclusion: string;
  signals: InsightSignal[];
  findings: InsightFinding[];
}

const pct = (value: number | null | undefined): string =>
  value === null || value === undefined ? "not measured" : `${value}%`;

const phase = (
  report: JsonReport,
  name: keyof NonNullable<JsonReport["run"]>["phases"],
): { status: ReportPhase; reason?: string } =>
  report.run?.phases[name] ?? {
    status: "not-run",
    reason: "scope not recorded",
  };

const phaseText = (
  report: JsonReport,
  name: keyof NonNullable<JsonReport["run"]>["phases"],
): string => {
  const value = phase(report, name);
  return value.status === "measured"
    ? "measured"
    : `${value.status}${value.reason ? ` — ${value.reason}` : ""}`;
};

const conformanceFailures = (report: JsonReport) =>
  report.conformance.results.flatMap((result) =>
    result.failures
      .filter((failure) => failure.severity === "MUST")
      .map((failure) => ({ result, failure })),
  );

const allFindings = (report: JsonReport): InsightFinding[] => {
  const findings: InsightFinding[] = [];
  for (const { result, failure } of conformanceFailures(report)) {
    findings.push({
      kind: "critical",
      label: failure.label ?? failure.id,
      detail: `${result.name ?? result.id}${failure.message ? ` — ${failure.message}` : ""}`,
    });
  }
  for (const tier of report.coverage.byTier) {
    if (tier.missing.length > 0) {
      findings.push({
        kind: tier.tier === "core" ? "critical" : "caution",
        label: `${tier.tier[0]!.toUpperCase()}${tier.tier.slice(1)} coverage gaps`,
        detail: tier.missing.join(", "),
      });
    }
    if ((tier.unprobed ?? []).length > 0) {
      findings.push({
        kind: "note",
        label: `${tier.tier[0]!.toUpperCase()}${tier.tier.slice(1)} not probed`,
        detail: (tier.unprobed ?? []).join(", "),
      });
    }
  }
  const weak = report.capability.weakCategories ?? [];
  if (weak.length > 0) {
    findings.push({
      kind: "caution",
      label: "Model categories below floor",
      detail: weak
        .map((category) => CATEGORY_LABELS[category] ?? category)
        .join(", "),
    });
  }
  const unmeasured = report.capability.unmeasured ?? [];
  if (unmeasured.length > 0) {
    findings.push({
      kind: "note",
      label: "Model categories not measured",
      detail: unmeasured
        .map((category) => CATEGORY_LABELS[category] ?? category)
        .join(", "),
    });
  }
  if ((report.conformance.inconclusive?.length ?? 0) > 0) {
    findings.push({
      kind: "caution",
      label: "Conformance checks inconclusive",
      detail: (report.conformance.inconclusive ?? [])
        .map(
          (result) =>
            `${result.name ?? result.id}: ${result.reason ?? "model did not exercise the path"}`,
        )
        .join("; "),
    });
  }
  if (report.agentic) {
    for (const task of report.agentic.tasks.filter((task) => !task.passed)) {
      findings.push({
        kind: "caution",
        label: `Agent task failed: ${task.name}`,
        detail: task.detail ?? task.failure ?? "failed",
      });
    }
  }
  if (report.fidelity?.firstDivergence) {
    const divergence = report.fidelity.firstDivergence;
    findings.push({
      kind: "caution",
      label: "Temperature-zero runs diverged",
      detail: `${divergence.itemId} at character ${divergence.charIndex}`,
    });
  }
  return findings;
};

const modelConclusion = (report: JsonReport): string => {
  const capability = report.capability;
  if (
    phase(report, "capability").status !== "measured" ||
    capability.categories.length === 0
  ) {
    return `Model evidence was ${phaseText(report, "capability")}.`;
  }
  const agentic = report.agentic
    ? ` Agentic work: ${report.agentic.passed}/${report.agentic.total} tasks.`
    : ` Agentic work was ${phaseText(report, "agentic")}.`;
  const weak =
    capability.weakCategories.length > 0
      ? ` Weak categories: ${capability.weakCategories.map((category) => CATEGORY_LABELS[category] ?? category).join(", ")}.`
      : " No measured category fell below the floor.";
  return `✓ ${capability.verdict}: ${capability.pct}% across ${capability.categories.length} measured categories.${weak}${agentic}`;
};

const deployConclusion = (report: JsonReport): string => {
  const core = report.coverage.byTier.find((tier) => tier.tier === "core");
  const conformance =
    phase(report, "conformance").status === "not-run"
      ? `Conformance was ${phaseText(report, "conformance")}.`
      : `${report.conformance.pct}% of exercised MUST assertions pass.`;
  return `Core coverage is ${core ? `${core.pct}% (${core.supported}/${core.total})` : "not measured"}; ${conformance} ${report.capability.categories.length > 0 ? `The model is ${report.capability.verdict}.` : `Model suitability was ${phaseText(report, "capability")}.`}`;
};

const engineConclusion = (report: JsonReport): string => {
  const failures = conformanceFailures(report).length;
  const missingCore =
    report.coverage.byTier.find((tier) => tier.tier === "core")?.missing
      .length ?? 0;
  if (failures === 0 && missingCore === 0) {
    return "No exercised MUST violations or Core coverage gaps were found; inspect Extended and Frontier findings for remaining work.";
  }
  return `There are ${failures} exercised MUST violation${failures === 1 ? "" : "s"}${missingCore > 0 ? ` and ${missingCore} Core coverage gap${missingCore === 1 ? "" : "s"}` : ""}. The findings below identify the repair targets.`;
};

export function buildPerspectiveInsights(
  report: JsonReport,
  perspective: Perspective,
): PerspectiveInsights {
  const definition = PERSPECTIVES[perspective];
  const findings = allFindings(report);
  const core = report.coverage.byTier.find((tier) => tier.tier === "core");
  const extended = report.coverage.byTier.find(
    (tier) => tier.tier === "extended",
  );
  const measuredFidelity =
    report.fidelity?.slices.filter((slice) => slice.measured).length ?? 0;
  const totalFidelity = report.fidelity?.slices.length ?? 0;
  const signals: InsightSignal[] =
    perspective === "model"
      ? [
          {
            label: "Capability",
            value:
              report.capability.categories.length > 0
                ? `${report.capability.pct}% · ${report.capability.verdict}`
                : "not measured",
            detail: phaseText(report, "capability"),
            tone:
              report.capability.verdict === "below-floor" ? "critical" : "good",
          },
          {
            label: "Agentic work",
            value: report.agentic
              ? `${report.agentic.passed}/${report.agentic.total}`
              : "not measured",
            detail: phaseText(report, "agentic"),
            tone:
              report.agentic && report.agentic.passed < report.agentic.total
                ? "caution"
                : "neutral",
          },
          {
            label: "Serving fidelity",
            value: report.fidelity ? `${report.fidelity.pct}%` : "not measured",
            detail: report.fidelity
              ? `${measuredFidelity}/${totalFidelity} slices measured`
              : phaseText(report, "fidelity"),
            tone: "neutral",
          },
        ]
      : perspective === "deploy"
        ? [
            {
              label: "Core coverage",
              value: core ? `${core.pct}%` : "not measured",
              detail: core
                ? `${core.supported}/${core.total} items`
                : phaseText(report, "coverage"),
              tone: core?.pct === 100 ? "good" : "caution",
            },
            {
              label: "Conformance",
              value:
                report.conformance.total > 0
                  ? `${report.conformance.pct}%`
                  : "not measured",
              detail:
                report.conformance.total > 0
                  ? `${report.conformance.passed}/${report.conformance.total} MUST assertions`
                  : phaseText(report, "conformance"),
              tone:
                report.conformance.total > 0 && report.conformance.pct < 100
                  ? "critical"
                  : "good",
            },
            {
              label: "Model floor",
              value:
                report.capability.categories.length > 0
                  ? report.capability.verdict
                  : "not measured",
              detail:
                report.capability.categories.length > 0
                  ? `${report.capability.pct}% overall`
                  : phaseText(report, "capability"),
              tone:
                report.capability.verdict === "below-floor"
                  ? "critical"
                  : "neutral",
            },
            {
              label: "Performance",
              value: report.bench?.decodeTokPerSec
                ? `${report.bench.decodeTokPerSec.median} tok/s`
                : "not measured",
              detail: report.bench
                ? `${report.bench.ttftMs?.median ?? "n/a"} ms first token`
                : phaseText(report, "performance"),
              tone: "neutral",
            },
          ]
        : [
            {
              label: "MUST violations",
              value: String(conformanceFailures(report).length),
              detail: "exercised assertions",
              tone:
                conformanceFailures(report).length > 0 ? "critical" : "good",
            },
            {
              label: "Core gaps",
              value: String(core?.missing.length ?? 0),
              detail: core?.missing.join(", ") || "none",
              tone: (core?.missing.length ?? 0) > 0 ? "critical" : "good",
            },
            {
              label: "Extended coverage",
              value: extended ? `${extended.pct}%` : "not measured",
              detail: extended
                ? `${extended.supported}/${extended.total} items`
                : phaseText(report, "coverage"),
              tone: "neutral",
            },
            {
              label: "Inconclusive",
              value: String(report.conformance.inconclusive?.length ?? 0),
              detail: "not counted as pass or fail",
              tone:
                (report.conformance.inconclusive?.length ?? 0) > 0
                  ? "caution"
                  : "neutral",
            },
          ];

  return {
    perspective,
    title: definition.label,
    question: definition.question,
    conclusion:
      perspective === "model"
        ? modelConclusion(report)
        : perspective === "deploy"
          ? deployConclusion(report)
          : engineConclusion(report),
    signals,
    findings: findings.slice(0, 16),
  };
}

export function phaseLabel(
  report: JsonReport,
  name: keyof NonNullable<JsonReport["run"]>["phases"],
): string {
  return phaseText(report, name);
}
