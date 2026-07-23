import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import type { EvalCategory } from "../outcome";
import type { JsonReport } from "./json";
import { CATEGORY_LABELS } from "./terminal";

/**
 * A single self-contained HTML file: the JSON report plus Chart.js, inlined,
 * so the file opens offline and can be attached to an issue or a PR as-is.
 *
 * Chart rules (deliberate, not cosmetic): one axis per chart — decode and TTFT
 * get separate panels, never a dual-axis; a single blue hue everywhere, since
 * no chart here compares distinct series; the speculative pair uses two shades
 * of that hue (an ordinal ramp, validated in both light and dark mode); status
 * colors appear only on the capability-verdict badge, icon + label, never color
 * alone. Every chart's data is also present as text, so nothing is
 * chart-only.
 */

/**
 * Chart.js is a runtime dependency; inline its UMD bundle for offline use.
 * The UMD file sits next to the exported entry but is not in the exports map,
 * so resolve the entry and read its sibling.
 */
function chartJsBundle(): string {
  const require = createRequire(import.meta.url);
  const path = join(dirname(require.resolve("chart.js")), "chart.umd.js");
  return readFileSync(path, "utf8").replace(/<\/script/g, "<\\/script");
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** JSON for a <script> block — `</script>` inside strings must not end it. */
function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function fmtTokensK(n: number): string {
  return n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n);
}

function pctBar(label: string, ratio: string, pct: number): string {
  return `<div class="row">
    <span class="row-label">${esc(label)}</span>
    <span class="row-ratio">${esc(ratio)}</span>
    <span class="row-pct">${pct}%</span>
    <span class="track"><span class="fill" style="width:${Math.max(0, Math.min(100, pct))}%"></span></span>
  </div>`;
}

function statTile(label: string, value: string, sub = ""): string {
  return `<div class="tile">
    <div class="tile-label">${esc(label)}</div>
    <div class="tile-value">${esc(value)}</div>
    ${sub ? `<div class="tile-sub">${esc(sub)}</div>` : ""}
  </div>`;
}

const STYLE = `
  :root {
    color-scheme: light;
    --page: #f9f9f7; --surface: #fcfcfb;
    --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781;
    --grid: #e1e0d9; --border: rgba(11,11,11,0.10);
    --blue: #2a78d6; --blue-light: #86b6ef;
    --good: #0ca30c; --good-text: #006300; --critical: #d03b3b;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --page: #0d0d0d; --surface: #1a1a19;
      --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
      --grid: #2c2c2a; --border: rgba(255,255,255,0.10);
      --blue: #3987e5; --blue-light: #9ec5f4;
      --good: #0ca30c; --good-text: #0ca30c; --critical: #d03b3b;
    }
  }
  * { box-sizing: border-box; margin: 0; }
  body {
    background: var(--page); color: var(--ink);
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    padding: 32px 16px;
  }
  main { max-width: 960px; margin: 0 auto; display: grid; gap: 16px; }
  header h1 { font-size: 20px; font-weight: 650; }
  header .sub { color: var(--ink-2); margin-top: 2px; }
  header .meta { color: var(--muted); font-size: 12.5px; margin-top: 2px; }
  section {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; padding: 20px;
  }
  h2 {
    font-size: 12.5px; font-weight: 650; letter-spacing: 0.06em;
    text-transform: uppercase; color: var(--ink-2); margin-bottom: 12px;
  }
  h2 .note { text-transform: none; letter-spacing: 0; font-weight: 400; color: var(--muted); }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
  .tile { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
  .tile-label { color: var(--ink-2); font-size: 12.5px; }
  .tile-value { font-size: 26px; font-weight: 650; margin-top: 2px; }
  .tile-sub { color: var(--muted); font-size: 12px; margin-top: 2px; }
  .badge {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 12.5px; font-weight: 600; border-radius: 999px;
    padding: 2px 10px; border: 1px solid var(--border); margin-top: 4px;
  }
  .badge.good { color: var(--good-text); }
  .badge.bad { color: var(--critical); }
  .row {
    display: grid; grid-template-columns: minmax(120px, 180px) 70px 48px 1fr;
    gap: 10px; align-items: center; padding: 3px 0;
  }
  .row-label { color: var(--ink); }
  .row-ratio { color: var(--muted); font-variant-numeric: tabular-nums; }
  .row-pct { color: var(--ink-2); text-align: right; font-variant-numeric: tabular-nums; }
  .track { height: 8px; background: var(--grid); border-radius: 4px; overflow: hidden; }
  .fill { display: block; height: 100%; background: var(--blue); border-radius: 4px; }
  .missing { color: var(--critical); font-size: 12.5px; margin: 2px 0 8px; }
  .fineprint { color: var(--muted); font-size: 12.5px; margin-top: 8px; }
  .charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
  .chart-title { color: var(--ink-2); font-size: 12.5px; margin-bottom: 6px; }
  .chart-box { position: relative; height: 240px; }
  table { border-collapse: collapse; width: 100%; margin-top: 10px; font-size: 12.5px; }
  th, td { text-align: right; padding: 3px 10px; font-variant-numeric: tabular-nums; }
  th:first-child, td:first-child { text-align: left; padding-left: 0; }
  th { color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--grid); }
  td { color: var(--ink-2); }
  details summary { color: var(--muted); font-size: 12.5px; cursor: pointer; margin-top: 8px; }
`;

/**
 * Runs in the browser. Colors are read from the CSS variables at draw time and
 * re-read when the OS theme flips, so both modes use their own validated
 * steps rather than an automatic inversion.
 */
const CHART_SCRIPT = `
  const css = (name) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  const charts = [];
  function makeChart(id, build) {
    const el = document.getElementById(id);
    if (!el) return;
    charts.push({ el, build, chart: new Chart(el, build()) });
  }

  function baseScales(xTitle, yTitle) {
    return {
      x: {
        title: { display: !!xTitle, text: xTitle, color: css("--muted") },
        ticks: { color: css("--muted") },
        grid: { display: false },
        border: { color: css("--grid") },
      },
      y: {
        beginAtZero: true,
        title: { display: !!yTitle, text: yTitle, color: css("--muted") },
        ticks: { color: css("--muted") },
        grid: { color: css("--grid") },
        border: { display: false },
      },
    };
  }
  const noLegend = { legend: { display: false } };

  function lineOptions(xTitle, yTitle) {
    return {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: noLegend,
      scales: baseScales(xTitle, yTitle),
    };
  }

  function lineDataset(values) {
    return {
      data: values,
      borderColor: css("--blue"),
      backgroundColor: css("--blue"),
      borderWidth: 2,
      pointRadius: 4,
      pointHoverRadius: 6,
      pointBorderColor: css("--surface"),
      pointBorderWidth: 2,
      spanGaps: false,
    };
  }

  if (REPORT.capability.categories.length > 0) {
    makeChart("capability-chart", () => ({
      type: "bar",
      data: {
        labels: REPORT.capability.categories.map((c) => CATEGORY_LABELS[c.category] ?? c.category),
        datasets: [{
          data: REPORT.capability.categories.map((c) => c.pct),
          backgroundColor: css("--blue"),
          borderRadius: 4,
          borderSkipped: "start",
          barThickness: 14,
        }],
      },
      options: {
        indexAxis: "y",
        maintainAspectRatio: false,
        plugins: {
          ...noLegend,
          tooltip: { callbacks: { label: (item) => {
            const c = REPORT.capability.categories[item.dataIndex];
            return c.pct + "% (" + c.passed + "/" + c.total + " samples)";
          } } },
        },
        scales: {
          x: { ...baseScales("", "").x, max: 100,
               ticks: { color: css("--muted"), callback: (v) => v + "%" },
               grid: { color: css("--grid") } },
          y: { ticks: { color: css("--ink-2") }, grid: { display: false },
               border: { color: css("--grid") } },
        },
      },
    }));
  }

  const scaling = (REPORT.bench && REPORT.bench.contextScaling) || [];
  const okPoints = scaling.filter((p) => !p.note);
  if (okPoints.length > 0) {
    const labels = okPoints.map((p) => "~" + fmtK(p.inputTokens ?? p.targetTokens));
    makeChart("context-decode-chart", () => ({
      type: "line",
      data: { labels, datasets: [lineDataset(okPoints.map((p) => p.decodeTokPerSec))] },
      options: lineOptions("prompt tokens", "decode tok/s"),
    }));
    makeChart("context-ttft-chart", () => ({
      type: "line",
      data: { labels, datasets: [lineDataset(okPoints.map((p) => p.ttftMs))] },
      options: lineOptions("prompt tokens", "time to first token, ms"),
    }));
  }

  const spec = REPORT.bench && REPORT.bench.speculative;
  if (spec) {
    makeChart("speculative-chart", () => ({
      type: "bar",
      data: {
        labels: ["predictable (echo)", "novel (invent)"],
        datasets: [{
          data: [spec.predictableTokPerSec, spec.novelTokPerSec],
          backgroundColor: [css("--blue"), css("--blue-light")],
          borderRadius: 4,
          borderSkipped: "start",
          barThickness: 32,
        }],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { ...noLegend,
          tooltip: { callbacks: { label: (item) => item.parsed.y + " tok/s" } } },
        scales: baseScales("", "decode tok/s"),
      },
    }));
  }

  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    for (const entry of charts) {
      entry.chart.destroy();
      entry.chart = new Chart(entry.el, entry.build());
    }
  });
`;

export function renderHtml(report: JsonReport): string {
  const target = [report.target.baseUrl, report.target.engine]
    .filter(Boolean)
    .join(" · ");

  const cap = report.capability;
  const conf = report.conformance;
  const bench = report.bench;
  const fid = report.fidelity;

  const badge =
    cap.verdict === "below-floor"
      ? `<span class="badge bad">✗ below floor</span>`
      : `<span class="badge good">✓ ${cap.verdict}</span>`;

  const tiles = [
    statTile(
      "Engine conformance",
      `${conf.pct}%`,
      `${conf.passed}/${conf.total} MUST assertions`,
    ),
    `<div class="tile">
      <div class="tile-label">Model capability</div>
      <div class="tile-value">${cap.pct}%</div>
      ${badge}
    </div>`,
    ...(fid
      ? [statTile("Engine fidelity", `${fid.pct}%`, "same-model comparisons only")]
      : []),
    ...(bench
      ? [
          statTile(
            "Decode",
            bench.decodeTokPerSec
              ? `${bench.decodeTokPerSec.median} tok/s`
              : "n/a",
            bench.decodeTokPerSec
              ? `${bench.decodeTokPerSec.min}–${bench.decodeTokPerSec.max} over ${bench.decodeTokPerSec.samples.length} runs`
              : "",
          ),
          statTile(
            "First token",
            bench.ttftMs ? `${bench.ttftMs.median} ms` : "n/a",
            bench.ttftMs ? `${bench.ttftMs.min}–${bench.ttftMs.max} ms` : "",
          ),
          statTile(
            "Prefill",
            bench.prefillTokPerSec
              ? `${Math.round(bench.prefillTokPerSec.median)} tok/s`
              : "n/a",
            bench.prefillPromptTokens
              ? `${bench.prefillPromptTokens}-token prompt`
              : "",
          ),
        ]
      : []),
  ].join("\n");

  const coverage = report.coverage.byTier
    .map((tier) => {
      const rows = pctBar(
        tier.tier.toUpperCase(),
        `${tier.supported}/${tier.total}`,
        tier.pct,
      );
      const missing =
        tier.missing.length > 0
          ? `<div class="missing">${tier.missing.map((m) => `✗ ${esc(m)}`).join("&ensp;")}</div>`
          : "";
      return rows + missing;
    })
    .join("\n");

  const credits = report.coverage.credits
    .map(
      (credit) =>
        `<div class="fineprint">○ ${esc(credit.label)} — detected, not scored</div>`,
    )
    .join("\n");

  const conformance = conf.bySurface
    .map((s) => pctBar(s.surface, `${s.passed}/${s.total}`, s.pct))
    .join("\n");

  const capabilityTable = `
    <details><summary>data table</summary><table>
      <tr><th>category</th><th>passed</th><th>total</th><th>%</th></tr>
      ${cap.categories
        .map((c) => {
          const label =
            CATEGORY_LABELS[c.category as EvalCategory] ?? c.category;
          return `<tr><td>${esc(label)}</td><td>${c.passed}</td><td>${c.total}</td><td>${c.pct}%</td></tr>`;
        })
        .join("\n")}
    </table></details>`;

  const capabilitySection =
    cap.categories.length === 0
      ? ""
      : `<section>
      <h2>Model capability <span class="note">— ${cap.pct}% overall</span></h2>
      <div class="chart-box" style="height:${40 + cap.categories.length * 30}px">
        <canvas id="capability-chart"></canvas>
      </div>
      ${capabilityTable}
    </section>`;

  let fidelitySection = "";
  if (fid) {
    const rows = fid.slices
      .map((s) =>
        s.measured
          ? pctBar(s.label, s.detail, Math.round(s.score * 10000) / 100)
          : `<div class="row"><span class="row-label">${esc(s.label)}</span><span class="row-ratio" style="grid-column: 2 / 5; text-align:left">${esc(s.detail)}</span></div>`,
      )
      .join("\n");

    const notes: string[] = [];
    if (fid.firstDivergence) {
      const d = fid.firstDivergence;
      notes.push(
        `<div class="missing">✗ greedy runs diverged at char ${d.charIndex} (${esc(d.itemId)}, ${d.runs} runs) — non-determinism at temperature 0</div>`,
      );
    }
    if (fid.unmeasured.length > 0) {
      notes.push(
        `<div class="fineprint">${fid.unmeasured.map(esc).join(", ")} not measured — engine exposed no logprobs</div>`,
      );
    }
    if (fid.reasoningCaveat) {
      notes.push(
        `<div class="fineprint">reasoning model — Confidence reads the post-thinking distribution, so the score is a floor</div>`,
      );
    }

    fidelitySection = `<section>
      <h2>Engine fidelity <span class="note">— ${fid.pct}% · same-model comparisons only, the number is the engine</span></h2>
      ${rows}
      ${notes.join("\n")}
    </section>`;
  }

  let benchSection = "";
  if (bench) {
    const machine = [
      bench.machine.cpu,
      `${bench.machine.memGB} GB`,
      `${bench.machine.platform} ${bench.machine.arch}`,
    ]
      .filter(Boolean)
      .join(" · ");

    const scaling = bench.contextScaling ?? [];
    const failed = scaling.filter((p) => p.note);
    const scalingCharts =
      scaling.length === 0
        ? ""
        : `<div class="charts">
        <div><div class="chart-title">Decode throughput vs context</div>
          <div class="chart-box"><canvas id="context-decode-chart"></canvas></div></div>
        <div><div class="chart-title">Time to first token vs context</div>
          <div class="chart-box"><canvas id="context-ttft-chart"></canvas></div></div>
      </div>
      ${failed
        .map(
          (p) =>
            `<div class="fineprint">✗ ~${fmtTokensK(p.targetTokens)} rung failed: ${esc(p.note ?? "")} — larger rungs not attempted</div>`,
        )
        .join("\n")}
      <table>
        <tr><th>prompt tokens</th><th>decode tok/s</th><th>first token, ms</th><th>runs</th></tr>
        ${scaling
          .map(
            (p) =>
              `<tr><td>~${fmtTokensK(p.inputTokens ?? p.targetTokens)}</td><td>${p.decodeTokPerSec ?? "n/a"}</td><td>${p.ttftMs ?? "n/a"}</td><td>${p.runs}</td></tr>`,
          )
          .join("\n")}
      </table>`;

    const spec = bench.speculative;
    const specBlock = spec
      ? `<div style="margin-top:20px"><div class="chart-title">Speculative decoding — ${spec.ratio}× (${spec.verdict})</div>
        <div class="chart-box" style="height:180px;max-width:420px"><canvas id="speculative-chart"></canvas></div>
        ${spec.reasoningCaveat ? `<div class="fineprint">reasoning model — the thinking phase is novel, so this understates real gains</div>` : ""}
      </div>`
      : "";

    benchSection = `<section>
      <h2>Performance <span class="note">— informational, not scored · ${esc(machine)}</span></h2>
      ${scalingCharts}
      ${specBlock}
    </section>`;
  }

  const footer = [
    report.usage
      ? `${(report.usage.inputTokens + report.usage.outputTokens).toLocaleString("en-US")} tokens`
      : "",
    `${Math.round(report.durationMs / 1000)}s`,
    `generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
  ]
    .filter(Boolean)
    .join(" · ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>llmprobe — ${esc(report.target.model)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <header>
    <h1>llmprobe report</h1>
    <div class="sub">${esc(report.target.model)}</div>
    <div class="meta">${esc(target)}</div>
  </header>

  <div class="tiles">${tiles}</div>

  <section>
    <h2>Surface coverage</h2>
    ${coverage}
    ${credits}
  </section>

  <section>
    <h2>Engine conformance <span class="note">— MUST assertions, implemented surfaces only</span></h2>
    ${conformance}
  </section>

  ${capabilitySection}
  ${fidelitySection}
  ${benchSection}

  <div class="fineprint">${esc(footer)}</div>
</main>
<script>${chartJsBundle()}</script>
<script>
const REPORT = ${embedJson(report)};
const CATEGORY_LABELS = ${embedJson(CATEGORY_LABELS)};
const fmtK = (n) => (n >= 1000 ? Math.round(n / 100) / 10 + "k" : String(n));
${CHART_SCRIPT}
</script>
</body>
</html>
`;
}
