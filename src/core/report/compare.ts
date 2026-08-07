import { normalizeJsonReport, type JsonReport } from "./json";
import { STYLE, chartJsBundle, embedJson, esc, fmtTokensK } from "./html";
import {
  PERSPECTIVES,
  buildPerspectiveInsights,
  type Perspective,
} from "./insights";
import { renderCompareWorkbenchHtml } from "./card/compare-workbench";

/**
 * One page comparing several saved runs.
 *
 * Default output is the interactive model-picker workbench (blank columns,
 * dropdowns, sticky freeze header). Benchmark curve overlays remain available
 * via `renderBenchmarkComparisonHtml` for deep performance diffs.
 */

export interface ComparisonInput {
  label: string;
  report: JsonReport;
  /** Optional link to a single-run HTML report for this input. */
  href?: string | null;
  file?: string;
}

/**
 * Okabe-Ito, minus the two that fail against one of the themes (yellow washes
 * out on light, black disappears on dark). Distinguishable under the common
 * forms of colour blindness, which a hue ramp would not be — these are distinct
 * series, not an ordinal scale.
 */
const SERIES_COLORS = [
  "#0072B2",
  "#E69F00",
  "#009E73",
  "#CC79A7",
  "#56B4E9",
  "#D55E00",
  "#8C6BB1",
  "#6E7B8B",
];

const color = (i: number): string =>
  SERIES_COLORS[i % SERIES_COLORS.length] ?? SERIES_COLORS[0]!;

const num = (v: number | null | undefined): string =>
  v === null || v === undefined ? "n/a" : String(v);

const pct = (v: number | null | undefined): string =>
  v === null || v === undefined ? "n/a" : `${v}%`;

/** Where a run came from, as far as the report can say. */
function describe(input: ComparisonInput): string {
  const t = input.report.target;
  return [t.engine, t.model].filter(Boolean).join(" · ") || t.baseUrl;
}

function machineOf(input: ComparisonInput): string | null {
  const m = input.report.bench?.machine;
  if (!m) return null;
  return [m.cpu, `${m.memGB} GB`, `${m.platform} ${m.arch}`]
    .filter(Boolean)
    .join(" · ");
}

const tierPct = (input: ComparisonInput, tier: string): number | null =>
  input.report.coverage.byTier.find((t) => t.tier === tier)?.pct ?? null;

/**
 * A context-scaling series as {x: prompt tokens, y: value} pairs.
 *
 * Failed rungs are dropped rather than plotted as zero — a rung the engine
 * rejected is absent data, and a zero would read as "infinitely slow".
 */
function scalingSeries(
  input: ComparisonInput,
  pick: (
    p: NonNullable<JsonReport["bench"]>["contextScaling"] extends Array<
      infer P
    > | null
      ? P
      : never,
  ) => number | null,
): Array<{ x: number; y: number }> {
  const points = input.report.bench?.contextScaling ?? [];
  return points
    .filter((p) => !p.note)
    .map((p) => ({ x: p.inputTokens ?? p.targetTokens, y: pick(p) }))
    .filter((p): p is { x: number; y: number } => p.y !== null && p.x > 0);
}

interface ChartSpec {
  id: string;
  title: string;
  yTitle: string;
  series: Array<Array<{ x: number; y: number }>>;
}

function buildCharts(inputs: ComparisonInput[]): ChartSpec[] {
  const specs: Array<[string, string, string, (p: any) => number | null]> = [
    [
      "cmp-decode",
      "Decode throughput vs context",
      "decode tok/s",
      (p) => p.decodeTokPerSec,
    ],
    [
      "cmp-ttft",
      "Time to first token vs context",
      "first token, ms",
      (p) => p.ttftMs,
    ],
    [
      "cmp-prefill",
      "Prefill throughput vs context",
      "prefill tok/s",
      (p) => p.prefillTokPerSec ?? null,
    ],
    [
      "cmp-step",
      "Tokens per decode step vs context",
      "tokens per step",
      (p) => p.speculative?.tokensPerStep ?? null,
    ],
  ];

  return specs
    .map(([id, title, yTitle, pick]) => ({
      id,
      title,
      yTitle,
      series: inputs.map((i) => scalingSeries(i, pick)),
    }))
    .filter((spec) => spec.series.some((s) => s.length > 0));
}

/** One line of the scorecard, and everything needed to rank it. */
interface ScoreRow {
  label: string;
  /** What this row measures — shown on hover over the label. */
  help: string;
  /** Which way is better. Ranking is skipped when this is null. */
  better: "higher" | "lower";
  /** The comparable number, or null when this run has nothing to compare. */
  value: (i: ComparisonInput) => number | null;
  /** What the cell shows. */
  text: (i: ComparisonInput) => string;
  /** How a value reads in the hover text. */
  fmt?: (v: number) => string;
  /** Extra evidence for the hover, beyond the ranking. */
  detail?: (i: ComparisonInput) => string | null;
  /**
   * The number only orders the runs, it does not measure them — a verdict
   * scored 1 against one scored 2 is not "50% lower". Suppresses the ratio.
   */
  ordinal?: boolean;
}

/** Ordinal scores so a verdict can be ranked beside the numbers. */
const CACHE_RANK: Record<string, number> = { active: 2, none: 1 };
const BATCH_RANK: Record<string, number> = {
  batched: 3,
  partial: 2,
  serialized: 1,
};

function scoreRows(): ScoreRow[] {
  const asPct = (v: number) => `${v}%`;
  return [
    {
      label: "Coverage — core",
      help: "Share of Core-tier surfaces and features the engine implements. Hardware-independent.",
      better: "higher",
      value: (i) => tierPct(i, "core"),
      text: (i) => pct(tierPct(i, "core")),
      fmt: asPct,
    },
    {
      label: "Coverage — extended",
      help: "Share of Extended-tier features implemented. Hardware-independent.",
      better: "higher",
      value: (i) => tierPct(i, "extended"),
      text: (i) => pct(tierPct(i, "extended")),
      fmt: asPct,
    },
    {
      label: "Coverage — frontier",
      help: "Share of Frontier-tier features implemented. Hardware-independent.",
      better: "higher",
      value: (i) => tierPct(i, "frontier"),
      text: (i) => pct(tierPct(i, "frontier")),
      fmt: asPct,
    },
    {
      label: "Conformance",
      help: "MUST assertions passed, over the surfaces the engine actually implements. Anything under 100% is a spec violation.",
      better: "higher",
      // A --bench-only run has no conformance at all. Scoring that 0% would
      // read as an engine that failed everything rather than one nobody asked.
      value: (i) =>
        i.report.conformance.total === 0 ? null : i.report.conformance.pct,
      text: (i) =>
        i.report.conformance.total === 0
          ? "n/a"
          : `${pct(i.report.conformance.pct)} <span class="note">${i.report.conformance.passed}/${i.report.conformance.total}</span>`,
      fmt: asPct,
      detail: (i) =>
        i.report.conformance.total === 0
          ? "not run — this report has no conformance phase"
          : `${i.report.conformance.passed} of ${i.report.conformance.total} MUST assertions passed`,
    },
    {
      label: "Capability",
      help: "Deterministic evals of the model, not the engine: tool use, JSON discipline, instruction following, reasoning.",
      better: "higher",
      value: (i) =>
        i.report.capability.categories.length === 0
          ? null
          : i.report.capability.pct,
      text: (i) =>
        i.report.capability.categories.length === 0
          ? "n/a"
          : `${pct(i.report.capability.pct)} <span class="note">${esc(i.report.capability.verdict)}</span>`,
      fmt: asPct,
      detail: (i) =>
        i.report.capability.categories.length === 0
          ? null
          : `verdict: ${i.report.capability.verdict}`,
    },
    {
      label: "Agentic",
      help: "Multi-step tool tasks in a simulated workspace — a harder bar than the capability floor.",
      better: "higher",
      value: (i) =>
        i.report.agentic
          ? i.report.agentic.passed / Math.max(1, i.report.agentic.total)
          : null,
      text: (i) =>
        i.report.agentic
          ? `${i.report.agentic.passed}/${i.report.agentic.total}`
          : "n/a",
      fmt: (v) => `${Math.round(v * 100)}%`,
    },
    {
      label: "Fidelity",
      help: "Whether the engine serves the model faithfully: correctness, confidence, determinism, logprob consistency.",
      better: "higher",
      value: (i) => i.report.fidelity?.pct ?? null,
      text: (i) => pct(i.report.fidelity?.pct),
      fmt: asPct,
    },
    {
      label: "Decode tok/s",
      help: "Steady-state generation rate while writing code — the workload these engines actually serve. Hardware-dependent.",
      better: "higher",
      value: (i) => i.report.bench?.decodeTokPerSec?.median ?? null,
      text: (i) => num(i.report.bench?.decodeTokPerSec?.median),
      fmt: (v) => `${v} tok/s`,
      detail: (i) => {
        const s = i.report.bench?.decodeTokPerSec;
        return s
          ? `median of ${s.samples.length} runs, ${s.min}–${s.max}`
          : null;
      },
    },
    {
      label: "First token, ms",
      help: "Time to the first generated token on a short prompt. Lower is better. Hardware-dependent.",
      better: "lower",
      value: (i) => i.report.bench?.ttftMs?.median ?? null,
      text: (i) => num(i.report.bench?.ttftMs?.median),
      fmt: (v) => `${v} ms`,
      detail: (i) => {
        const s = i.report.bench?.ttftMs;
        return s
          ? `median of ${s.samples.length} runs, ${s.min}–${s.max}`
          : null;
      },
    },
    {
      label: "Prefill tok/s",
      help: "Prompt ingestion rate, from prompt tokens over time-to-first-token on a long prompt.",
      better: "higher",
      value: (i) => i.report.bench?.prefillTokPerSec?.median ?? null,
      text: (i) => num(i.report.bench?.prefillTokPerSec?.median),
      fmt: (v) => `${v} tok/s`,
      detail: (i) =>
        i.report.bench?.prefillPromptTokens
          ? `measured on a ${i.report.bench.prefillPromptTokens}-token prompt`
          : null,
    },
    {
      label: "Speculative",
      help: "Decode throughput on predictable output over novel output. Well above 1 means a draft path is paying off.",
      better: "higher",
      value: (i) => i.report.bench?.speculative?.ratio ?? null,
      text: (i) =>
        i.report.bench?.speculative
          ? `${i.report.bench.speculative.ratio}× <span class="note">${esc(i.report.bench.speculative.verdict)}</span>`
          : "n/a",
      fmt: (v) => `${v}×`,
      detail: (i) => {
        const s = i.report.bench?.speculative;
        return s
          ? `predictable ${s.predictableTokPerSec} tok/s vs novel ${s.novelTokPerSec} tok/s`
          : null;
      },
    },
    {
      label: "Tokens per step",
      help: "Tokens emitted per server decode step, read off SSE frame arrival gaps. ~1 means no speculation is visible.",
      better: "higher",
      value: (i) => i.report.bench?.speculative?.tokensPerStep ?? null,
      text: (i) => num(i.report.bench?.speculative?.tokensPerStep),
      fmt: (v) => `${v} tok/step`,
      detail: (i) => i.report.bench?.speculative?.tokensPerStepNote ?? null,
    },
    {
      label: "Prefix cache",
      help: "Whether a repeated prompt actually skips the prefill, timed rather than taken from the reported cached_tokens.",
      better: "higher",
      value: (i) => {
        const v = i.report.bench?.prefixCache?.verdict;
        return v ? (CACHE_RANK[v] ?? null) : null;
      },
      text: (i) =>
        i.report.bench?.prefixCache
          ? `${esc(i.report.bench.prefixCache.verdict)} <span class="note">${num(i.report.bench.prefixCache.speedup)}×</span>`
          : "n/a",
      fmt: (v) => (v >= 2 ? "active" : "none"),
      ordinal: true,
      detail: (i) => {
        const c = i.report.bench?.prefixCache;
        if (!c) return null;
        return `${c.coldTtftMs} ms cold → ${c.warmTtftMs} ms warm; usage reported ${c.cachedTokens ?? "no"} cached tokens`;
      },
    },
    {
      label: "Concurrency",
      help: "Whether four in-flight requests are batched together or queued behind one slot. Efficiency near 1 is real batching, near 1/N is a queue.",
      better: "higher",
      value: (i) => {
        const v = i.report.bench?.batching?.verdict;
        return v ? (BATCH_RANK[v] ?? null) : null;
      },
      text: (i) =>
        i.report.bench?.batching
          ? `${esc(i.report.bench.batching.verdict)} <span class="note">${num(i.report.bench.batching.efficiency)}</span>`
          : "n/a",
      fmt: (v) => ["", "serialized", "partial", "batched"][v] ?? String(v),
      ordinal: true,
      detail: (i) => {
        const b = i.report.bench?.batching;
        return b
          ? `${b.aggregateTokPerSec} tok/s across ${b.streams} streams vs ${b.singleTokPerSec} tok/s alone`
          : null;
      },
    },
    {
      label: "Sustained load",
      help: "How far the decode rate moved between the start and the end of the run. Near zero means the numbers above are stable.",
      better: "higher",
      // Closer to zero wins, in either direction: a run that sped up mid-way
      // is as unstable as one that slowed.
      value: (i) => {
        const d = i.report.bench?.loadDrift?.driftPct;
        return d === null || d === undefined ? null : -Math.abs(d);
      },
      text: (i) =>
        i.report.bench?.loadDrift?.driftPct !== undefined &&
        i.report.bench?.loadDrift?.driftPct !== null
          ? `${i.report.bench.loadDrift.driftPct}% <span class="note">${esc(i.report.bench.loadDrift.verdict)}</span>`
          : "n/a",
      fmt: (v) => `${Math.abs(v)}% drift`,
      ordinal: true,
      detail: (i) => {
        const d = i.report.bench?.loadDrift;
        return d
          ? `${d.firstTokPerSec} → ${d.lastTokPerSec} tok/s over the run`
          : null;
      },
    },
  ];
}

function scorecard(
  inputs: ComparisonInput[],
  timingComparable = true,
  fidelityComparable = true,
): string {
  const swatch = (i: number): string =>
    `<span class="swatch" style="background:${color(i)}"></span>`;

  const renderRow = (row: ScoreRow): string => {
    const values = inputs.map(row.value);
    const present = values.filter((v): v is number => v !== null);
    const fmt = row.fmt ?? ((v: number) => String(v));

    // Ranking needs at least two runs to have measured the thing. One value
    // and a column of n/a is not a comparison.
    const timingRow =
      /Decode|token|Prefill|Speculative|step|cache|Concurrency|Sustained/i.test(
        row.label,
      );
    const fidelityRow = row.label === "Fidelity";
    const comparable =
      present.length >= 2 &&
      (timingComparable || !timingRow) &&
      (fidelityComparable || !fidelityRow);
    const best = comparable
      ? row.better === "higher"
        ? Math.max(...present)
        : Math.min(...present)
      : null;
    const worst = comparable
      ? row.better === "higher"
        ? Math.min(...present)
        : Math.max(...present)
      : null;
    const tied = comparable && best === worst;

    const cells = inputs.map((input, n) => {
      const value = values[n];
      const parts: string[] = [];
      let cls = "";
      let mark = "";

      if (value === null) {
        parts.push("not measured in this run");
      } else if (!comparable) {
        parts.push(`${fmt(value)} — only run with this measured`);
      } else if (tied) {
        cls = "tied";
        mark = "=";
        parts.push(`tied at ${fmt(value)}`);
      } else if (value === best) {
        cls = "best";
        mark = "▲";
        parts.push(`best — ${fmt(value)}`);
        const runnerUp = present
          .filter((v) => v !== best)
          .sort((a, b) => (row.better === "higher" ? b - a : a - b))[0];
        if (runnerUp !== undefined) {
          parts.push(`next is ${fmt(runnerUp)}`);
        }
      } else {
        if (value === worst) {
          cls = "worst";
          mark = "▼";
        }
        parts.push(`${fmt(value)} vs best ${fmt(best!)}`);
        // Ratio against the winner, phrased so it reads the same whichever
        // direction the metric runs. Never on an ordinal row, where the
        // numbers only sort and a ratio between them would be invented.
        if (!row.ordinal && best !== 0) {
          const gap = Math.round(Math.abs((value - best!) / best!) * 100);
          if (gap > 0) {
            parts.push(
              row.better === "higher" ? `${gap}% lower` : `${gap}% slower`,
            );
          }
        }
      }

      const extra = row.detail?.(input) ?? null;
      if (extra) parts.push(extra);

      const marker = mark ? `<span class="mark">${mark}</span>` : "";
      return `<td class="cell ${cls}" data-tip="${esc(parts.join(" · "))}">${row.text(input)}${marker}</td>`;
    });

    return `<tr><td class="cell metric" data-tip="${esc(row.help)}">${esc(row.label)}</td>${cells.join("")}</tr>`;
  };

  return `<table class="scorecard">
    <tr><th></th>${inputs.map((i, n) => `<th>${swatch(n)}${esc(i.label)}</th>`).join("")}</tr>
    ${scoreRows().map(renderRow).join("\n")}
  </table>`;
}

/** The data behind every overlaid chart, as text. Nothing is chart-only. */
function chartTable(spec: ChartSpec, inputs: ComparisonInput[]): string {
  const xs = [...new Set(spec.series.flatMap((s) => s.map((p) => p.x)))].sort(
    (a, b) => a - b,
  );
  if (xs.length === 0) return "";

  const row = (x: number): string =>
    `<tr><td>~${fmtTokensK(x)}</td>${spec.series
      .map((s) => `<td>${num(s.find((p) => p.x === x)?.y)}</td>`)
      .join("")}</tr>`;

  return `<details>
    <summary>${esc(spec.title)} — data</summary>
    <table>
      <tr><th>prompt tokens</th>${inputs.map((i) => `<th>${esc(i.label)}</th>`).join("")}</tr>
      ${xs.map(row).join("\n")}
    </table>
  </details>`;
}

/**
 * Scorecard-only styling. Rank is never carried by colour alone — every marked
 * cell also gets a ▲ / ▼ / = glyph, so the winner is readable in greyscale and
 * to anyone who cannot separate the two hues.
 *
 * Tooltips are CSS on a `data-tip` attribute rather than the native `title`,
 * which takes a second to appear and cannot be styled. No JS, so they work in
 * a saved file exactly as they do live.
 */
const COMPARE_STYLE = `
  .swatch {
    display: inline-block; width: 9px; height: 9px;
    border-radius: 2px; margin-right: 6px;
  }
  .scorecard td { color: var(--ink-2); }
  .scorecard td.best { color: var(--good-text); font-weight: 600; }
  .scorecard td.worst { color: var(--critical); }
  .scorecard td.tied { color: var(--muted); }
  .scorecard .mark { margin-left: 5px; font-size: 10px; opacity: 0.85; }
  .scorecard td.metric { color: var(--ink); }

  .cell { position: relative; }
  .cell[data-tip] { cursor: help; }
  .cell[data-tip]:hover::after {
    content: attr(data-tip);
    position: absolute; bottom: calc(100% + 6px); right: 0;
    z-index: 10; width: max-content; max-width: 280px;
    white-space: normal; text-align: left; font-weight: 400;
    background: var(--ink); color: var(--page);
    padding: 6px 9px; border-radius: 6px;
    font-size: 12px; line-height: 1.45;
    box-shadow: 0 2px 10px rgba(0,0,0,0.25);
  }
  .cell.metric[data-tip]:hover::after { left: 0; right: auto; }
`;

const COMPARE_SCRIPT = `
  const css = (name) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  const charts = [];
  function makeChart(id, build) {
    const el = document.getElementById(id);
    if (!el) return;
    charts.push({ el, build, chart: new Chart(el, build()) });
  }

  const fmtK = (n) => (n >= 1000 ? Math.round(n / 100) / 10 + "k" : String(n));

  function build(spec) {
    return {
      type: "line",
      data: {
        datasets: spec.series.map((points, i) => ({
          label: LABELS[i],
          data: points,
          borderColor: COLORS[i],
          backgroundColor: COLORS[i],
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          tension: 0.25,
          spanGaps: true,
        })),
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: "nearest", intersect: false },
        plugins: {
          legend: { labels: { color: css("--ink-2"), boxWidth: 10, boxHeight: 10 } },
          tooltip: {
            callbacks: {
              title: (items) => "~" + fmtK(items[0].parsed.x) + " prompt tokens",
            },
          },
        },
        scales: {
          // Logarithmic and numeric: the rungs double, and two runs rarely land
          // on the same actual token count.
          x: {
            type: "logarithmic",
            title: { display: true, text: "prompt tokens", color: css("--muted") },
            ticks: { color: css("--muted"), callback: (v) => fmtK(v) },
            grid: { display: false },
            border: { color: css("--grid") },
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: spec.yTitle, color: css("--muted") },
            ticks: { color: css("--muted") },
            grid: { color: css("--grid") },
            border: { display: false },
          },
        },
      },
    };
  }

  for (const spec of SPECS) makeChart(spec.id, () => build(spec));

  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    for (const entry of charts) {
      entry.chart.destroy();
      entry.chart = new Chart(entry.el, entry.build());
    }
  });
`;

/** Interactive compare workbench (default for `--compare`). */
export function renderComparisonHtml(inputs: ComparisonInput[]): string {
  return renderCompareWorkbenchHtml(
    inputs.map((input) => ({
      label: input.label,
      report: normalizeJsonReport(input.report),
      href: input.href,
      file: input.file,
    })),
  );
}

/**
 * Legacy scorecard + context-curve overlay compare (bench-focused).
 * Kept for tests and callers that need overlaid performance series.
 */
export function renderBenchmarkComparisonHtml(
  inputs: ComparisonInput[],
): string {
  inputs = inputs.map((input) => ({
    ...input,
    report: normalizeJsonReport(input.report),
  }));
  const charts = buildCharts(inputs);

  // Timings only mean something on identical hardware. With the machines in
  // the reports, that stops being a caveat the reader has to remember.
  const machines = inputs.map(machineOf);
  const known = machines.filter((m): m is string => m !== null);
  const mixed = new Set(known).size > 1;
  const sameModel =
    new Set(inputs.map((input) => input.report.target.model)).size === 1;
  const machineNote = mixed
    ? `<div class="missing">⚠ These runs are from different machines — coverage, conformance and capability still compare, but every timing below does not.</div>`
    : known.length > 0
      ? `<div class="fineprint">All runs measured on ${esc(known[0]!)}.</div>`
      : "";

  const chartMarkup = charts
    .map(
      (spec) => `<div>
        <div class="chart-title">${esc(spec.title)}</div>
        <div class="chart-box"><canvas id="${spec.id}"></canvas></div>
      </div>`,
    )
    .join("\n");

  const perfSection =
    charts.length > 0
      ? `<section>
      <h2>Performance vs context <span class="note">— one line per run</span></h2>
      <div class="charts">${chartMarkup}</div>
      ${charts.map((spec) => chartTable(spec, inputs)).join("\n")}
    </section>`
      : `<section>
      <h2>Performance vs context</h2>
      <div class="fineprint">No run carries benchmark data — re-run with <code>--bench</code> to compare curves.</div>
    </section>`;

  const runs = inputs
    .map(
      (input, i) =>
        `<tr><td><span class="swatch" style="background:${color(i)}"></span>${esc(input.label)}</td>
         <td style="text-align:left">${esc(describe(input))}</td>
         <td style="text-align:left">${esc(machineOf(input) ?? "no benchmark data")}</td></tr>`,
    )
    .join("\n");

  const perspectives = (Object.keys(PERSPECTIVES) as Perspective[])
    .map((perspective) => {
      const definition = PERSPECTIVES[perspective];
      const rows = inputs
        .map((input) => {
          const insight = buildPerspectiveInsights(input.report, perspective);
          const primary = insight.signals
            .slice(0, 3)
            .map((signal) => `${signal.label}: ${signal.value}`)
            .join(" · ");
          return `<tr><td>${esc(input.label)}</td><td style="text-align:left">${esc(insight.conclusion)}</td><td style="text-align:left">${esc(primary)}</td></tr>`;
        })
        .join("\n");
      const categories = [
        ...new Set(
          inputs.flatMap((input) =>
            input.report.capability.categories.map(
              (category) => category.category,
            ),
          ),
        ),
      ];
      const categoryMatrix =
        perspective === "model" && categories.length > 0
          ? `<details><summary>capability category matrix</summary><table><tr><th>category</th>${inputs.map((input) => `<th>${esc(input.label)}</th>`).join("")}</tr>${categories
              .map(
                (category) =>
                  `<tr><td>${esc(category)}</td>${inputs
                    .map((input) => {
                      const value = input.report.capability.categories.find(
                        (item) => item.category === category,
                      );
                      return `<td>${value ? `${value.pct}% (${value.passed}/${value.total})` : "not measured"}</td>`;
                    })
                    .join("")}</tr>`,
              )
              .join("")}</table></details>`
          : "";
      return `<section class="perspective-compare" data-view="${perspective}"><h2>${esc(definition.label)} <span class="note">— ${esc(definition.question)}</span></h2><table><tr><th>run</th><th style="text-align:left">evidence-led conclusion</th><th style="text-align:left">signals</th></tr>${rows}</table>${categoryMatrix}</section>`;
    })
    .join("\n");

  const evidence = inputs
    .map((input) => {
      const mustFailures = input.report.conformance.results.reduce(
        (count, result) =>
          count +
          result.failures.filter((failure) => failure.severity === "MUST")
            .length,
        0,
      );
      const core = input.report.coverage.byTier.find(
        (tier) => tier.tier === "core",
      );
      return `<tr><td>${esc(input.label)}</td><td>${mustFailures}</td><td>${core?.missing.length ?? 0}</td><td>${input.report.conformance.inconclusive?.length ?? 0}</td></tr>`;
    })
    .join("\n");

  return `<title>llmprobe — comparison of ${inputs.length} runs</title>
<style>${STYLE}${COMPARE_STYLE}</style>
<main>
  <header>
    <h1>llmprobe comparison</h1>
    <div class="sub">${inputs.length} runs side by side</div>
    <nav class="perspectives" aria-label="Dashboard perspective"><a href="#model" data-perspective="model">Model evaluation</a><a href="#deploy" data-perspective="deploy">Deployment readiness</a><a href="#engine" data-perspective="engine">Engine diagnostics</a></nav>
  </header>

  ${perspectives}

  <section class="perspective-compare" data-view="engine">
    <h2>Engine reference <span class="note">— choose a run to inspect regressions and improvements</span></h2>
    <label for="reference-run">Reference run </label><select id="reference-run">${inputs.map((input, index) => `<option value="${index}">${esc(input.label)}</option>`).join("")}</select>
    <div id="reference-delta" class="fineprint">Select a reference to compare supported surfaces and MUST outcomes.</div>
    <table><tr><th>run</th><th>MUST violations</th><th>Core gaps</th><th>inconclusive</th></tr>${evidence}</table>
  </section>

  <section class="compare-section" data-view-order="deploy,engine,model">
    <h2>Runs</h2>
    <table>
      <tr><th>label</th><th style="text-align:left">target</th><th style="text-align:left">machine</th></tr>
      ${runs}
    </table>
    ${machineNote}
  </section>

  <section class="compare-section" data-view-order="deploy,model,engine">
    <h2>Scorecard</h2>
    ${scorecard(inputs, !mixed, sameModel)}
    <div class="fineprint">Coverage, conformance and capability are hardware-independent. Timings require identical hardware; fidelity requires the same model identifier.</div>
  </section>

  <div class="compare-section" data-view-order="deploy,model,engine">${perfSection}</div>
</main>
<script>${chartJsBundle()}</script>
<script>
const LABELS = ${embedJson(inputs.map((i) => i.label))};
const COLORS = ${embedJson(inputs.map((_, i) => color(i)))};
const SPECS = ${embedJson(charts)};
const REPORTS = ${embedJson(inputs.map((input) => input.report))};
const perspectiveLinks = [...document.querySelectorAll("[data-perspective]")];
const perspectivePanels = [...document.querySelectorAll(".perspective-compare")];
const ordered = [...document.querySelectorAll(".compare-section")];
function setPerspective(name) { const chosen = ["model","deploy","engine"].includes(name) ? name : "model"; perspectiveLinks.forEach((link) => { const active = link.dataset.perspective === chosen; link.classList.toggle("active", active); link.setAttribute("aria-current", active ? "page" : "false"); }); perspectivePanels.forEach((panel) => panel.hidden = panel.dataset.view && panel.dataset.view !== chosen); const main = document.querySelector("main"); ordered.sort((a,b) => { const rank = (el) => { const values = (el.dataset.viewOrder || "").split(","); const index = values.indexOf(chosen); return index < 0 ? 99 : index; }; return rank(a)-rank(b); }).forEach((el) => main?.appendChild(el)); }
setPerspective(location.hash.slice(1)); window.addEventListener("hashchange", () => setPerspective(location.hash.slice(1)));
const reference = document.getElementById("reference-run"); const delta = document.getElementById("reference-delta");
function showDelta() { const base = REPORTS[Number(reference?.value || 0)]; if (!base || !delta) return; const lines = []; REPORTS.forEach((report, index) => { if (report === base) return; const before = new Map(base.conformance.results.map(result => [result.id, result.outcome])); const regressions = report.conformance.results.filter(result => before.get(result.id) === "pass" && result.outcome === "fail").length; const improvements = report.conformance.results.filter(result => before.get(result.id) === "fail" && result.outcome === "pass").length; const oldCoverage = new Map((base.coverage.entries || []).map(entry => [entry.id, entry.supported])); const coverageRegressions = (report.coverage.entries || []).filter(entry => oldCoverage.get(entry.id) === true && entry.supported === false).length; const coverageImprovements = (report.coverage.entries || []).filter(entry => oldCoverage.get(entry.id) === false && entry.supported === true).length; lines.push(LABELS[index] + ": " + regressions + " conformance regression" + (regressions === 1 ? "" : "s") + ", " + improvements + " improvement" + (improvements === 1 ? "" : "s") + ", " + coverageRegressions + " coverage regression" + (coverageRegressions === 1 ? "" : "s") + ", " + coverageImprovements + " coverage improvement" + (coverageImprovements === 1 ? "" : "s")); }); delta.textContent = lines.length ? lines.join(" · ") : "No comparison rows beyond the selected reference."; }
reference?.addEventListener("change", showDelta); showDelta();
${COMPARE_SCRIPT}
</script>`;
}
