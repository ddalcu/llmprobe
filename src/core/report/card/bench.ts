import type { BenchReport, BenchStat } from "../../outcome";
import { esc, statusPill } from "./shared";

/** 16384 → "16.4k". Matches the terminal report's context ladder. */
function fmtTokensK(n: number): string {
  return n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n);
}

function round(n: number): string {
  return String(Math.round(n * 10) / 10);
}

function fmtLatency(ms: number): string {
  return ms >= 1000 ? `${round(ms / 1000)}s` : `${Math.round(ms)}ms`;
}

/** Median headline plus the spread it came from — one sample is not a rate. */
function statCell(stat: BenchStat | null, unit: string): string {
  if (!stat) return `<span class="fine">not measured</span>`;
  const spread =
    stat.samples.length > 1
      ? `<span class="note">${round(stat.min)}–${round(stat.max)} over ${stat.samples.length}</span>`
      : `<span class="note">single sample</span>`;
  return `${round(stat.median)} ${esc(unit)} ${spread}`;
}

function tile(kicker: string, stat: BenchStat | null, unit: string): string {
  const value = stat ? `${round(stat.median)}` : "—";
  const sub = stat
    ? `${esc(unit)} · median of ${stat.samples.length}`
    : "not measured";
  return `<div class="sec-card">
    <div class="card-kicker">${esc(kicker)}</div>
    <div class="card-value">${value}</div>
    <div class="card-note">${sub}</div>
  </div>`;
}

/** One rung of the context ladder, or the engine's own reason it stopped. */
function ladderRows(
  points: NonNullable<BenchReport["contextScaling"]>,
): string {
  return points
    .map((p) => {
      const size = `~${fmtTokensK(p.inputTokens ?? p.targetTokens)}`;
      if (p.note) {
        return `<tr class="fail-row">
          <td>${esc(size)}</td>
          <td colspan="4">✗ ${esc(p.note)}</td>
        </tr>`;
      }
      const spec = p.speculative;
      const specBits = [
        spec?.tokensPerStep != null ? `${spec.tokensPerStep} tok/step` : null,
        spec?.ratio != null ? `${spec.ratio}× ceiling` : null,
        spec?.note ?? null,
      ].filter(Boolean);
      return `<tr>
        <td>${esc(size)}</td>
        <td>${p.decodeTokPerSec != null ? `${round(p.decodeTokPerSec)} tok/s` : "n/a"}</td>
        <td>${p.ttftMs != null ? fmtLatency(p.ttftMs) : "n/a"}</td>
        <td>${p.prefillTokPerSec != null ? `${round(p.prefillTokPerSec)} tok/s` : "n/a"}</td>
        <td>${specBits.length > 0 ? esc(specBits.join(" · ")) : "—"}</td>
      </tr>`;
    })
    .join("");
}

type ChartPoint = { x: number; y: number };

/**
 * Small inline SVG line chart: log-x (prompt tokens), linear-y. No external
 * libraries so the file stays self-contained; colors come from CSS vars so the
 * chart follows the theme.
 */
export function lineChartSvg(
  title: string,
  unit: string,
  series: Array<{ label: string; color: string; points: ChartPoint[] }>,
  opts: { width?: number; height?: number } = {},
): string {
  const W = opts.width ?? 420;
  const H = opts.height ?? 200;
  const pad = { l: 46, r: 14, t: 26, b: 30 };
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return "";
  const xs = all.map((p) => Math.log10(Math.max(1, p.x)));
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const yMax = Math.max(...all.map((p) => p.y)) * 1.12 || 1;
  const sx = (x: number) =>
    x1 === x0
      ? pad.l + (W - pad.l - pad.r) / 2
      : pad.l +
        ((Math.log10(Math.max(1, x)) - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const sy = (y: number) => H - pad.b - (y / yMax) * (H - pad.t - pad.b);
  const r1 = (n: number) => Math.round(n * 10) / 10;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = yMax * f;
    const y = r1(sy(v));
    return (
      `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="var(--line)" stroke-width="1"/>` +
      `<text x="${pad.l - 6}" y="${y + 3}" text-anchor="end" font-size="10" fill="var(--muted)">${v >= 1000 ? `${r1(v / 1000)}k` : Math.round(v)}</text>`
    );
  });
  // One x label per distinct rung — the ladder is short, every rung is news.
  const xVals = [...new Set(all.map((p) => p.x))].sort((a, b) => a - b);
  const xTicks = xVals.map(
    (v) =>
      `<text x="${r1(sx(v))}" y="${H - pad.b + 16}" text-anchor="middle" font-size="10" fill="var(--muted)">${fmtTokensK(v)}</text>`,
  );

  const lines = series
    .filter((s) => s.points.length > 0)
    .map((s) => {
      const pts = [...s.points].sort((a, b) => a.x - b.x);
      const d = pts.map((p) => `${r1(sx(p.x))},${r1(sy(p.y))}`).join(" ");
      const dots = pts
        .map(
          (p) =>
            `<circle cx="${r1(sx(p.x))}" cy="${r1(sy(p.y))}" r="3" fill="${s.color}"><title>${esc(s.label)} · ${fmtTokensK(p.x)} tok → ${r1(p.y)} ${esc(unit)}</title></circle>`,
        )
        .join("");
      return `<polyline points="${d}" fill="none" stroke="${s.color}" stroke-width="2"/>${dots}`;
    })
    .join("");

  return `<svg class="ctx-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
    <text x="${pad.l}" y="15" font-size="11" font-weight="700" fill="var(--ink)">${esc(title)}</text>
    <text x="${W - pad.r}" y="15" text-anchor="end" font-size="10" fill="var(--muted)">${esc(unit)}</text>
    ${yTicks.join("")}
    ${xTicks.join("")}
    ${lines}
  </svg>`;
}

/** Context-scaling curves for one run: decode and first-token latency. */
function contextChartsHtml(
  points: NonNullable<BenchReport["contextScaling"]>,
): string {
  const measured = points.filter((p) => !p.note);
  if (measured.length < 2) return "";
  const x = (p: (typeof measured)[number]) => p.inputTokens ?? p.targetTokens;
  const decode = measured
    .filter((p) => p.decodeTokPerSec != null)
    .map((p) => ({ x: x(p), y: p.decodeTokPerSec! }));
  const ttft = measured
    .filter((p) => p.ttftMs != null)
    .map((p) => ({ x: x(p), y: p.ttftMs! }));
  const charts = [
    decode.length >= 2
      ? lineChartSvg("Decode vs context", "tok/s", [
          { label: "decode", color: "var(--engine)", points: decode },
        ])
      : "",
    ttft.length >= 2
      ? lineChartSvg("First token vs context", "ms", [
          { label: "ttft", color: "var(--caution, #c98a00)", points: ttft },
        ])
      : "",
  ]
    .filter(Boolean)
    .join("");
  return charts ? `<div class="ctx-charts">${charts}</div>` : "";
}

/**
 * The four probes that answer yes/no questions about the engine rather than
 * producing a rate: does the prefix cache work, does it batch, does speculation
 * pay, did the box hold its speed while all of this was measured.
 */
function signalRows(bench: BenchReport): string {
  const rows: string[] = [];

  const cache = bench.prefixCache;
  if (cache) {
    const detail =
      cache.verdict === "unknown"
        ? "not measurable on this engine"
        : `${cache.speedup}× — ${fmtLatency(cache.coldTtftMs!)} cold → ${fmtLatency(cache.warmTtftMs!)} warm` +
          (cache.cachedTokens != null
            ? `; usage reports ${cache.cachedTokens} of ${cache.promptTokens ?? "?"} prompt tokens cached`
            : "");
    rows.push(
      `<tr><td>Prefix cache</td><td>${statusPill(cache.verdict === "active" ? "pass" : cache.verdict === "none" ? "fail" : "not-probed")} ${esc(cache.verdict === "none" ? "not detected" : cache.verdict)}</td><td>${esc(detail)}</td></tr>`,
    );
  }

  const batch = bench.batching;
  if (batch) {
    const detail = [
      batch.efficiency != null ? `${batch.efficiency} efficiency` : null,
      batch.aggregateTokPerSec != null
        ? `${round(batch.aggregateTokPerSec)} tok/s aggregate vs ${round(batch.singleTokPerSec ?? 0)} alone`
        : null,
      batch.worstTtftMs != null
        ? `slowest first token ${fmtLatency(batch.worstTtftMs)}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
    rows.push(
      `<tr><td>Concurrency (${batch.streams} streams)</td><td>${statusPill(batch.verdict === "batched" ? "pass" : batch.verdict === "unknown" ? "not-probed" : "partial")} ${esc(batch.verdict)}</td><td>${esc(detail || "no aggregate measured")}</td></tr>`,
    );
  }

  const spec = bench.speculative;
  if (spec) {
    const detail = [
      `predictable ${round(spec.predictableTokPerSec)} tok/s vs novel ${round(spec.novelTokPerSec)} tok/s`,
      spec.tokensPerStep != null
        ? `${spec.tokensPerStep} tokens per decode step`
        : `tokens per decode step: ${spec.tokensPerStepNote ?? "unavailable"}`,
      spec.reasoningCaveat
        ? "reasoning model — the thinking phase is novel, so this understates real gains"
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
    rows.push(
      `<tr><td>Speculative decode</td><td>${statusPill(spec.verdict === "effective" ? "pass" : spec.verdict === "marginal" ? "partial" : "not-probed")} ${spec.ratio}× ${esc(spec.verdict)}</td><td>${esc(detail)}</td></tr>`,
    );
  }

  const drift = bench.loadDrift;
  if (drift && drift.driftPct != null) {
    const sign = drift.driftPct > 0 ? "+" : "";
    rows.push(
      `<tr><td>Sustained load</td><td>${statusPill(drift.verdict === "steady" ? "pass" : "partial")} ${esc(drift.verdict)}</td><td>${esc(
        `${round(drift.firstTokPerSec ?? 0)} → ${round(drift.lastTokPerSec ?? 0)} tok/s over ${Math.round(drift.elapsedMs / 1000)}s (${sign}${drift.driftPct}%)`,
      )}</td></tr>`,
    );
  }

  return rows.join("");
}

/** Headline for the section head: decode throughput is the number people quote. */
function benchHeadline(bench: BenchReport): string | null {
  return bench.decodeTokPerSec
    ? `${round(bench.decodeTokPerSec.median)} tok/s`
    : null;
}

/**
 * Performance section — informational, never scored. Everything here is
 * hardware-dependent, so the machine is named before any of its numbers are.
 */
export function benchSection(bench: BenchReport): string {
  const machine = [
    bench.machine.cpu,
    `${bench.machine.memGB} GB`,
    `${bench.machine.platform} ${bench.machine.arch}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const drift = bench.loadDrift;
  // Above the figures it qualifies: a box that slowed while they were taken is
  // the first thing to know about all of them.
  const caveats = [
    drift && drift.verdict !== "steady" && drift.driftPct != null
      ? `⚠ the machine ${drift.verdict === "degraded" ? "slowed" : "sped up"} mid-run (${drift.driftPct > 0 ? "+" : ""}${drift.driftPct}%) — treat the figures below as a range`
      : null,
    bench.streamCaveat ? `⚠ ${bench.streamCaveat}` : null,
  ].filter(Boolean) as string[];

  const ladder =
    bench.contextScaling && bench.contextScaling.length > 0
      ? `<p class="fine" style="margin-top:16px">Context scaling — decode, first-token latency and speculation as the prompt grows. A failed rung ends the ladder; larger sizes were not attempted.</p>
      ${contextChartsHtml(bench.contextScaling)}
      <table class="drill-table">
        <thead><tr><th>Prompt</th><th>Decode</th><th>First token</th><th>Prefill</th><th>Speculation</th></tr></thead>
        <tbody>${ladderRows(bench.contextScaling)}</tbody>
      </table>`
      : "";

  const signals = signalRows(bench);
  const signalTable = signals
    ? `<table class="drill-table" style="margin-top:16px">
        <thead><tr><th>Signal</th><th>Verdict</th><th>Detail</th></tr></thead>
        <tbody>${signals}</tbody>
      </table>`
    : "";

  const headline = benchHeadline(bench);

  return `<section class="section" id="performance">
      <div class="section-head">
        <h2>Performance <span class="tag engine">engine</span></h2>
        <div class="score">${headline ? esc(headline) : "—"}</div>
      </div>
      <p class="lede">Informational — never scored and never part of the exit code. Hardware-dependent: only comparable against runs on the same machine.</p>
      <div class="fine">machine: ${esc(machine)}</div>
      ${caveats.map((line) => `<div class="missing">${esc(line)}</div>`).join("")}
      <div class="secondary" style="margin:12px 0 0">
        ${tile("Decode throughput", bench.decodeTokPerSec, "tok/s")}
        ${tile("Time to first token", bench.ttftMs, "ms")}
        ${tile("Prefill throughput", bench.prefillTokPerSec, "tok/s")}
      </div>
      <table class="drill-table" style="margin-top:16px">
        <thead><tr><th>Measurement</th><th>Result</th><th>How it was taken</th></tr></thead>
        <tbody>
          <tr><td>Decode throughput</td><td>${statCell(bench.decodeTokPerSec, "tok/s")}</td><td>steady-state generation while writing code</td></tr>
          <tr><td>Time to first token</td><td>${statCell(bench.ttftMs, "ms")}</td><td>latency before the first generated token</td></tr>
          <tr><td>Prefill throughput</td><td>${statCell(bench.prefillTokPerSec, "tok/s")}</td><td>${bench.prefillPromptTokens ? `measured on a ${bench.prefillPromptTokens}-token prompt` : "prompt ingestion rate"}</td></tr>
        </tbody>
      </table>
      ${signalTable}
      ${ladder}
    </section>`;
}
