import { STEP_SPECULATION_FLOOR } from "../../bench/stats";
import type {
  AgenticScore,
  BenchReport,
  BenchStat,
  CapabilityScore,
  ConformanceScore,
  ContextSpeculative,
  CoverageScore,
  EvalCategory,
  FidelityScore,
  RunReport,
} from "../outcome";
import { type Palette, paletteFor } from "./colors";

const WIDTH = 74;

export const CATEGORY_LABELS: Record<EvalCategory, string> = {
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

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

/** Length as the terminal sees it — colour codes take no columns. */
function visualLen(s: string): number {
  return s.replace(ANSI, "").length;
}

/** Left text, right text, flushed to the card's edges. */
function spread(left: string, right: string): string {
  const gap = Math.max(1, WIDTH - visualLen(left) - visualLen(right));
  return `${left}${" ".repeat(gap)}${right}`;
}

function fmtPct(n: number): string {
  return `${n}%`;
}

function bar(pct: number, c: Palette): string {
  const filled = Math.max(0, Math.min(10, Math.round(pct / 10)));
  const body = "█".repeat(filled) + "░".repeat(10 - filled);
  if (pct >= 90) return c.green(body);
  if (pct >= 50) return c.yellow(body);
  return c.red(body);
}

function fmtDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function fmtCount(n: number): string {
  return n.toLocaleString("en-US");
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

// ── sections ────────────────────────────────────────────────────────────────

function renderCoverage(coverage: CoverageScore, c: Palette): string[] {
  const lines = [c.bold("SURFACE COVERAGE")];

  for (const tier of coverage.byTier) {
    const label = tier.tier.toUpperCase().padEnd(10);
    const ratio = `${tier.supported}/${tier.total}`.padEnd(7);
    const pct = fmtPct(tier.pct).padStart(6);
    lines.push(`  ${label}${ratio}${pct}  ${bar(tier.pct, c)}`);

    // Name names. The missing list is the entire point of a normative suite —
    // "✗ responses" is the pressure on the engine to go implement it.
    if (tier.missing.length > 0) {
      const missing = tier.missing.map((m) => `✗ ${m}`).join("   ");
      lines.push(`            ${c.red(missing)}`);
    }

    // Never let "we skipped the check" read as "the engine lacks it".
    if (tier.unprobed.length > 0) {
      lines.push(
        `            ${c.gray(`? ${tier.unprobed.join(", ")} — not probed in this run`)}`,
      );
    }
  }

  // Detected, shown, worth zero — we reward standards, not native APIs.
  for (const credit of coverage.credits) {
    lines.push(
      `  ${"credit".padEnd(10)}${c.gray(`${credit.label} — detected, not scored`)}`,
    );
  }

  return lines;
}

function renderConformance(conf: ConformanceScore, c: Palette): string[] {
  const lines = [
    spread(c.bold("ENGINE CONFORMANCE"), c.bold(fmtPct(conf.pct))),
    `  ${c.gray("MUST assertions, implemented surfaces only")}`,
  ];

  if (conf.total === 0) {
    lines.push(`  ${c.gray("nothing exercised — no implemented surface ran")}`);
    return lines;
  }

  const width = Math.max(...conf.bySurface.map((s) => s.surface.length));
  for (const surface of conf.bySurface) {
    const label = surface.surface.padEnd(width + 2);
    const ratio = `${surface.passed}/${surface.total}`.padEnd(10);
    const pct = fmtPct(surface.pct).padStart(6);
    const colour =
      surface.pct === 100 ? c.green : surface.pct >= 90 ? c.yellow : c.red;
    lines.push(`  ${label}${ratio}${colour(pct)}`);
  }

  // Inconclusive is the honest third state: the engine was never exercised
  // because the model wouldn't cooperate. Loud, and out of the denominator.
  if (conf.inconclusive.length > 0) {
    const n = conf.inconclusive.length;
    lines.push(
      `  ${c.yellow(`⚠ ${n} inconclusive`)} ${c.gray("— engine never exercised")}`,
    );
    for (const result of conf.inconclusive) {
      lines.push(`      ${c.gray(`${result.name} — ${result.reason ?? "?"}`)}`);
    }
  }

  if (conf.warnings.length > 0) {
    const n = conf.warnings.length;
    lines.push(`  ${c.yellow(`⚠ ${n} SHOULD ${plural(n, "warning")}`)}`);
    for (const w of conf.warnings) {
      const detail = w.message ? ` — ${w.message}` : "";
      lines.push(`      ${c.gray(`${w.label}${detail}`)}`);
    }
  }

  if (conf.nits.length > 0) {
    const n = conf.nits.length;
    lines.push(`  ${c.gray(`· ${n} MAY ${plural(n, "nit")}`)}`);
  }

  return lines;
}

function renderCapability(cap: CapabilityScore, c: Palette): string[] {
  const verdict =
    cap.verdict === "below-floor"
      ? c.red("below floor ✗")
      : c.green(`${cap.verdict} ✓`);
  const headline = cap.total === 0 ? c.gray("no evals run") : fmtPct(cap.pct);

  const lines = [
    spread(
      c.bold("MODEL CAPABILITY"),
      cap.total === 0 ? headline : `${c.bold(headline)}   ${verdict}`,
    ),
  ];

  if (cap.total === 0) return lines;

  const labels = cap.categories.map((cat) => CATEGORY_LABELS[cat.category]);
  const width = Math.max(...labels.map((l) => l.length));

  for (const cat of cap.categories) {
    const label = CATEGORY_LABELS[cat.category].padEnd(width + 2);
    const ratio = `${cat.passed}/${cat.total}`.padEnd(8);
    const pct = fmtPct(cat.pct).padStart(5);
    const weak = cap.weakCategories.includes(cat.category);
    const shown = weak ? c.red(pct) : pct;
    lines.push(`  ${label}${ratio}${shown}  ${bar(cat.pct, c)}`);
  }

  if (cap.weakCategories.length > 0) {
    const names = cap.weakCategories
      .map((cat) => CATEGORY_LABELS[cat])
      .join(", ");
    lines.push(`  ${c.gray(`below the floor: ${names}`)}`);
  }

  // Never let a category we could not measure read as a category the model
  // passed. Silence here would certify a model on the half of the card it
  // happened to be able to attempt.
  if (cap.unmeasured.length > 0) {
    const names = cap.unmeasured.map((cat) => CATEGORY_LABELS[cat]).join(", ");
    lines.push(
      `  ${c.yellow(`⚠ never measured: ${names}`)} ${c.gray("— the engine refused these requests for this model")}`,
    );
  }

  return lines;
}

function renderAgentic(agentic: AgenticScore, c: Palette): string[] {
  const headline = `${agentic.passed}/${agentic.total} tasks`;
  const lines = [
    spread(c.bold("AGENTIC"), c.bold(headline)),
    `  ${c.gray("multi-step tool use in a simulated workspace — a harder bar than the floor check, never blended into it")}`,
  ];

  const width = Math.max(...agentic.tasks.map((t) => t.name.length));
  for (const task of agentic.tasks) {
    const icon = task.passed ? c.green("✓") : c.red("✗");
    const name = task.name.padEnd(width + 2);
    const steps = c.gray(`${task.steps} ${plural(task.steps, "step")}`);
    lines.push(`  ${icon} ${name}${steps}`);
    if (!task.passed && task.detail) {
      lines.push(`      ${c.red("→")} ${c.gray(task.detail)}`);
    }
  }

  return lines;
}

function renderFidelity(fid: FidelityScore, c: Palette): string[] {
  const lines = [
    spread(c.bold("ENGINE FIDELITY"), c.bold(fmtPct(fid.pct))),
    `  ${c.gray("same-model comparisons only — holds the model constant, so the number is the engine")}`,
  ];

  const width = Math.max(...fid.slices.map((s) => s.label.length));
  for (const s of fid.slices) {
    const label = s.label.padEnd(width + 2);
    if (!s.measured) {
      lines.push(
        `  ${label}${c.gray("—      not measured")}  ${c.gray(s.detail)}`,
      );
      continue;
    }
    const scorePct = Math.round(s.score * 10000) / 100;
    const pct = fmtPct(scorePct).padStart(7);
    lines.push(`  ${label}${pct}  ${bar(scorePct, c)}  ${c.gray(s.detail)}`);
  }

  // The greedy self-divergence fact: a temperature-0 rerun that failed to
  // reproduce is a pure engine bug, and where it split is the useful part.
  if (fid.firstDivergence) {
    const d = fid.firstDivergence;
    lines.push(
      `  ${c.yellow(`⚠ greedy runs diverged at char ${d.charIndex}`)} ${c.gray(`(${d.itemId}, run ${d.run} of ${d.runs}) — non-determinism at temperature 0`)}`,
    );
  }

  // Never let "no logprobs" read as a zero — name what dropped out instead.
  if (fid.unmeasured.length > 0) {
    lines.push(
      `  ${c.gray(`· ${fid.unmeasured.join(", ")} not measured — engine exposed no logprobs`)}`,
    );
  }

  if (fid.reasoningCaveat) {
    lines.push(
      `  ${c.gray("(reasoning model — Confidence reads the post-thinking distribution, so the score is a floor)")}`,
    );
  }

  return lines;
}

function fmtStat(stat: BenchStat | null, unit: string): string {
  if (!stat) return "n/a";
  const range = stat.min === stat.max ? "" : ` (${stat.min}–${stat.max})`;
  return `${stat.median} ${unit}${range}`;
}

function fmtTokensK(n: number): string {
  return n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n);
}

/** ms under a second, seconds above — 38283ms reads better as "38.3s". */
function fmtLatency(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms} ms`;
}

/**
 * The speculation column of a context rung. Three readings, any of which can be
 * absent: tokens per decode step (silent when the engine buffers its stream),
 * the echo-vs-novel ratio (silent when the model did not echo), and the
 * counting ratio (--full only). When none survived, the rung says why instead
 * of showing a blank.
 *
 * Everything is shown against this rung's own novel rate, because a raw tok/s
 * at 32k says nothing on its own — the comparison is the measurement.
 */
function rungSpeculation(spec: ContextSpeculative | null, c: Palette): string {
  if (!spec) return "";

  const bits: string[] = [];
  if (spec.tokensPerStep !== null) {
    const text = `${spec.tokensPerStep} tok/step`;
    bits.push(
      spec.tokensPerStep >= STEP_SPECULATION_FLOOR
        ? c.green(text)
        : c.gray(text),
    );
  }
  // How much faster maximally predictable output runs at this same prompt
  // size — the headroom the draft path still has once the task is realistic.
  if (spec.ratio !== null) {
    const text = `${spec.ratio}× ceiling`;
    bits.push(spec.verdict === "effective" ? c.green(text) : c.gray(text));
  }
  if (spec.predictableTokensPerStep !== null) {
    bits.push(c.gray(`${spec.predictableTokensPerStep} tok/step at ceiling`));
  }

  if (bits.length === 0) {
    return c.gray(`  ${spec.note ?? "no speculation signal"}`);
  }
  const why = spec.note ? c.gray(` (${spec.note})`) : "";
  return `  ${bits.join(c.gray(" · "))}${why}`;
}

function renderBench(bench: BenchReport, c: Palette): string[] {
  const machine = [
    bench.machine.cpu,
    `${bench.machine.memGB} GB`,
    `${bench.machine.platform} ${bench.machine.arch}`,
  ]
    .filter(Boolean)
    .join(" · ");

  // Sits above the figures it qualifies: if the box slowed while they were
  // being taken, that is the first thing to know about all of them.
  const drift = bench.loadDrift;
  const driftLines: string[] = [];
  if (drift && drift.driftPct !== null) {
    const sign = drift.driftPct > 0 ? "+" : "";
    const summary = `${drift.firstTokPerSec} → ${drift.lastTokPerSec} tok/s over ${fmtDuration(drift.elapsedMs)} (${sign}${drift.driftPct}%)`;
    if (drift.verdict === "steady") {
      driftLines.push(`  ${c.gray(`sustained load: steady — ${summary}`)}`);
    } else {
      const why =
        drift.verdict === "degraded"
          ? "the machine slowed while these numbers were taken — thermal throttling or competing load"
          : "the machine sped up mid-run — the warmup never warmed it, so these read low";
      driftLines.push(`  ${c.yellow(`⚠ sustained load: ${summary}`)}`);
      driftLines.push(
        `  ${c.gray(`  ${why}; treat the figures below as a range`)}`,
      );
    }
  }

  const caveatLines: string[] = [];
  if (bench.streamCaveat) {
    caveatLines.push(`  ${c.yellow(`⚠ ${bench.streamCaveat}`)}`);
  }
  if (bench.decodeLengthNote) {
    caveatLines.push(`  ${c.gray(bench.decodeLengthNote)}`);
  }

  const lines = [
    c.bold("PERFORMANCE"),
    `  ${c.gray("informational — not scored; hardware-dependent, same-machine comparisons only")}`,
    `  ${c.gray(`machine: ${machine}`)}`,
    ...driftLines,
    ...caveatLines,
    `  ${"Decode throughput".padEnd(22)}${fmtStat(bench.decodeTokPerSec, "tok/s")}`,
    `  ${"Time to first token".padEnd(22)}${fmtStat(bench.ttftMs, "ms")}`,
  ];

  const prefill = fmtStat(bench.prefillTokPerSec, "tok/s");
  const promptNote = bench.prefillPromptTokens
    ? c.gray(`  (${bench.prefillPromptTokens}-token prompt)`)
    : "";
  lines.push(`  ${"Prefill throughput".padEnd(22)}${prefill}${promptNote}`);

  if (bench.contextScaling && bench.contextScaling.length > 0) {
    lines.push(
      `  ${c.gray("Context scaling  decode · first-token latency · speculation vs prompt size")}`,
    );
    for (const point of bench.contextScaling) {
      const size = point.inputTokens ?? point.targetTokens;
      const sizeLabel = `~${fmtTokensK(size)}`.padStart(8);
      if (point.note) {
        lines.push(`  ${c.gray(sizeLabel)}   ${c.yellow(`✗ ${point.note}`)}`);
        continue;
      }
      const decode = (
        point.decodeTokPerSec !== null
          ? `${point.decodeTokPerSec} tok/s`
          : "n/a"
      ).padEnd(13);
      const ttft = (
        point.ttftMs !== null ? fmtLatency(point.ttftMs) : "n/a"
      ).padEnd(10);
      lines.push(
        `  ${c.gray(`${sizeLabel}   ${decode}${ttft}`)}${rungSpeculation(point.speculative, c)}`,
      );
    }
  }

  const cache = bench.prefixCache;
  if (cache) {
    const detail =
      cache.verdict === "unknown"
        ? c.gray("not measurable")
        : `${cache.speedup}× ${c.gray(`(${fmtLatency(cache.coldTtftMs!)} cold → ${fmtLatency(cache.warmTtftMs!)} warm)`)}`;
    const label =
      cache.verdict === "active"
        ? c.green("active")
        : cache.verdict === "none"
          ? c.yellow("not detected")
          : c.gray("unknown");
    lines.push(`  ${"Prefix cache".padEnd(22)}${label}  ${detail}`);
    // usage claiming a hit while the clock says otherwise is the whole point.
    if (cache.cachedTokens !== null) {
      lines.push(
        `  ${c.gray(`  usage reports ${cache.cachedTokens} of ${cache.promptTokens ?? "?"} prompt tokens cached`)}`,
      );
    }
  }

  const batch = bench.batching;
  if (batch) {
    const label =
      batch.verdict === "batched"
        ? c.green("batched")
        : batch.verdict === "partial"
          ? c.yellow("partial")
          : batch.verdict === "serialized"
            ? c.yellow("serialized — one slot behind a queue")
            : c.gray("unknown");
    lines.push(
      `  ${`Concurrency (${batch.streams})`.padEnd(22)}${label}${
        batch.efficiency !== null
          ? c.gray(`  ${batch.efficiency} efficiency`)
          : ""
      }`,
    );
    if (batch.aggregateTokPerSec !== null) {
      const worst =
        batch.worstTtftMs !== null
          ? ` · slowest first token ${fmtLatency(batch.worstTtftMs)}`
          : "";
      lines.push(
        `  ${c.gray(`  ${batch.aggregateTokPerSec} tok/s aggregate vs ${batch.singleTokPerSec} alone${worst}`)}`,
      );
    }
  }

  const spec = bench.speculative;
  if (spec) {
    const label =
      spec.verdict === "effective"
        ? c.green(`${spec.ratio}× — effective (MTP/draft active)`)
        : spec.verdict === "marginal"
          ? c.yellow(`${spec.ratio}× — marginal`)
          : c.gray(`${spec.ratio}× — none detected`);
    lines.push(`  ${"Speculative decode".padEnd(22)}${label}`);
    lines.push(
      `  ${c.gray(`  predictable ${spec.predictableTokPerSec} tok/s · novel ${spec.novelTokPerSec} tok/s`)}`,
    );
    // Read straight off frame arrival gaps — no comparison involved, so it
    // stands even when the ratio is muddied.
    const steps =
      spec.tokensPerStep !== null
        ? `${spec.tokensPerStep} tokens per decode step`
        : `tokens per decode step: ${spec.tokensPerStepNote ?? "unavailable"}`;
    lines.push(`  ${c.gray(`  ${steps}`)}`);
    if (spec.reasoningCaveat) {
      lines.push(
        `  ${c.gray("  (reasoning model — the thinking phase is novel, so this understates real gains)")}`,
      );
    }
  }

  return lines;
}

// ── entry point ─────────────────────────────────────────────────────────────

export function renderReport(
  report: RunReport,
  options: { color?: boolean; benchOnly?: boolean } = {},
): string {
  const c = paletteFor(options.color ?? true);
  const rule = "━".repeat(WIDTH);

  const target = [
    report.target.baseUrl,
    report.target.engine,
    report.target.model,
  ]
    .filter(Boolean)
    .join(" · ");

  // --bench-only never ran the scored phases, so their cards would be three
  // empty sections claiming nothing was found. Absent beats zeroed.
  const scored = options.benchOnly
    ? []
    : [
        ...renderCoverage(report.coverage, c),
        "",
        ...renderConformance(report.conformance, c),
        "",
        ...renderCapability(report.capability, c),
        "",
      ];

  const lines: string[] = [
    rule,
    ` ${c.bold("llmprobe")} ${c.gray("·")} ${target}`,
    rule,
    "",
  ];

  // Above the cards, not below them: a reader who stops at the first number has
  // to have already been told the run did not finish.
  if (report.incomplete) {
    lines.push(
      ` ${c.red("✗ INCOMPLETE RUN")} ${c.gray("— the cards below are partial")}`,
      ` ${c.gray(report.incomplete)}`,
      "",
    );
  }

  lines.push(...scored);

  if (report.agentic) {
    lines.push(...renderAgentic(report.agentic, c), "");
  }

  if (report.fidelity) {
    lines.push(...renderFidelity(report.fidelity, c), "");
  }

  if (report.bench) {
    lines.push(...renderBench(report.bench, c), "");
  }

  const footer: string[] = [];
  if (report.usage) {
    const { inputTokens, outputTokens } = report.usage;
    // Split, because the two are not interchangeable: on a paid endpoint they
    // are priced differently, and a run dominated by input is a context ladder
    // while one dominated by output is evals.
    footer.push(
      `${fmtCount(inputTokens + outputTokens)} tokens ` +
        `(${fmtCount(inputTokens)} in · ${fmtCount(outputTokens)} out)`,
    );
  }
  footer.push(fmtDuration(report.durationMs));
  lines.push(`  ${c.gray(footer.join(" · "))}`);

  return lines.join("\n");
}
