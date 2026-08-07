import type { EvalCategory, RunReport } from "../outcome";

const CATEGORY_LABELS: Record<EvalCategory, string> = {
  "tool-selection": "Tool selection",
  "tool-restraint": "Tool restraint",
  "tool-args": "Tool arg fidelity",
  multiturn: "Multi-turn state",
  instructions: "Instruction following",
  "json-discipline": "JSON discipline",
  "long-context": "Long-context recall",
  reasoning: "Basic reasoning",
  knowledge: "Basic knowledge",
};

const badge = (label: string, value: string, colour: string): string =>
  `![${label}](https://img.shields.io/badge/${encodeURIComponent(label)}-${encodeURIComponent(value)}-${colour})`;

const colourFor = (pct: number): string =>
  pct >= 90
    ? "brightgreen"
    : pct >= 70
      ? "yellow"
      : pct >= 40
        ? "orange"
        : "red";

/** README-ready output: badges plus the three tables. */
export function renderMarkdown(report: RunReport): string {
  const { coverage, conformance, capability, target } = report;

  const core = coverage.byTier.find((t) => t.tier === "core");
  const lines: string[] = [];

  lines.push(`# llmprobe report — ${target.engine ?? target.baseUrl}`);
  lines.push("");
  lines.push(
    [
      badge("core", `${core?.pct ?? 0}%`, colourFor(core?.pct ?? 0)),
      badge("conformance", `${conformance.pct}%`, colourFor(conformance.pct)),
      badge(
        "model",
        capability.verdict === "below-floor"
          ? "below floor"
          : capability.verdict,
        capability.verdict === "strong"
          ? "brightgreen"
          : capability.verdict === "capable"
            ? "green"
            : "red",
      ),
    ].join(" "),
  );
  lines.push("");
  lines.push(
    `**Target:** \`${target.baseUrl}\` · **Model:** \`${target.model}\``,
  );
  lines.push("");

  lines.push("## Surface coverage");
  lines.push("");
  lines.push("| Tier | Supported | Score | Missing |");
  lines.push("| --- | --- | --- | --- |");
  for (const tier of coverage.byTier) {
    const missing = tier.missing.length ? tier.missing.join(", ") : "—";
    lines.push(
      `| ${tier.tier.toUpperCase()} | ${tier.supported}/${tier.total} | ${tier.pct}% | ${missing} |`,
    );
  }
  if (coverage.credits.length) {
    lines.push("");
    for (const credit of coverage.credits) {
      lines.push(`> Detected (not scored): ${credit.label}`);
    }
  }
  lines.push("");

  lines.push(`## Engine conformance — ${conformance.pct}%`);
  lines.push("");
  lines.push("_MUST assertions, implemented surfaces only._");
  lines.push("");
  if (conformance.total === 0) {
    lines.push("Nothing exercised — no implemented surface ran.");
  } else {
    lines.push("| Surface | Passed | Score |");
    lines.push("| --- | --- | --- |");
    for (const surface of conformance.bySurface) {
      lines.push(
        `| ${surface.surface} | ${surface.passed}/${surface.total} | ${surface.pct}% |`,
      );
    }
    if (conformance.inconclusive.length) {
      lines.push("");
      lines.push(
        `**${conformance.inconclusive.length} inconclusive** — the engine was never exercised:`,
      );
      lines.push("");
      for (const result of conformance.inconclusive) {
        lines.push(`- \`${result.id}\` — ${result.reason ?? "unknown"}`);
      }
    }
    if (conformance.warnings.length) {
      lines.push("");
      lines.push(
        `**${conformance.warnings.length} SHOULD warnings** (not scored):`,
      );
      lines.push("");
      for (const warning of conformance.warnings) {
        lines.push(
          `- ${warning.label}${warning.message ? ` — ${warning.message}` : ""}`,
        );
      }
    }
  }
  lines.push("");

  const verdict =
    capability.verdict === "below-floor"
      ? "below the floor ❌"
      : `${capability.verdict} ✅`;
  lines.push(`## Model capability — ${capability.pct}% (${verdict})`);
  lines.push("");
  if (capability.total === 0) {
    lines.push("No evals ran.");
  } else {
    lines.push("| Category | Passed | Score |");
    lines.push("| --- | --- | --- |");
    for (const category of capability.categories) {
      const weak = capability.weakCategories.includes(category.category)
        ? " ⚠️"
        : "";
      lines.push(
        `| ${CATEGORY_LABELS[category.category]}${weak} | ${category.passed}/${category.total} | ${category.pct}% |`,
      );
    }
  }

  if (report.agentic) {
    const ag = report.agentic;
    lines.push("");
    lines.push(`## Agentic — ${ag.passed}/${ag.total} tasks`);
    lines.push("");
    lines.push(
      "_Multi-step tool use in a simulated workspace. A harder bar than the floor check, never blended into it._",
    );
    lines.push("");
    lines.push("| Task | Result | Steps |");
    lines.push("| --- | --- | --- |");
    for (const task of ag.tasks) {
      const result = task.passed
        ? "✅"
        : `❌ ${task.detail ?? task.failure ?? "failed"}`;
      lines.push(`| ${task.name} | ${result} | ${task.steps} |`);
    }
  }

  if (report.fidelity) {
    const fid = report.fidelity;
    lines.push("");
    lines.push(`## Engine fidelity — ${fid.pct}%`);
    lines.push("");
    lines.push(
      "_Same-model comparisons only — holds the model constant, so the number is the engine._",
    );
    lines.push("");
    lines.push("| Slice | Score | Detail |");
    lines.push("| --- | --- | --- |");
    for (const slice of fid.slices) {
      const score = slice.measured
        ? `${Math.round(slice.score * 10000) / 100}%`
        : "not measured";
      lines.push(`| ${slice.label} | ${score} | ${slice.detail} |`);
    }
    if (fid.firstDivergence) {
      const d = fid.firstDivergence;
      lines.push("");
      lines.push(
        `> ⚠️ Greedy runs diverged at char ${d.charIndex} (\`${d.itemId}\`, run ${d.run} of ${d.runs}) — non-determinism at temperature 0.`,
      );
    }
    if (fid.reasoningCaveat) {
      lines.push("");
      lines.push(
        "> Reasoning model — Confidence reads the post-thinking distribution, so the score is a floor.",
      );
    }
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(
    `_Generated by [llmprobe](https://github.com/) · ${report.usage ? `${(report.usage.inputTokens + report.usage.outputTokens).toLocaleString()} tokens · ` : ""}${Math.round(report.durationMs / 1000)}s_`,
  );

  return lines.join("\n");
}
