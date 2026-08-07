import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import type { EvalCategory } from "../outcome";
import { normalizeJsonReport, type JsonReport } from "./json";
import {
  CATEGORY_LABELS,
  PERSPECTIVES,
  type InsightFinding,
  type Perspective,
  buildPerspectiveInsights,
  phaseLabel,
} from "./insights";

export function chartJsBundle(): string {
  const require = createRequire(import.meta.url);
  const path = join(dirname(require.resolve("chart.js")), "chart.umd.js");
  return readFileSync(path, "utf8").replace(/<\/script/g, "<\\/script");
}

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function fmtTokensK(n: number): string {
  return n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n);
}

const pctBar = (label: string, ratio: string, pct: number): string =>
  `<div class="row"><span class="row-label">${esc(label)}</span><span class="row-ratio">${esc(ratio)}</span><span class="row-pct">${pct}%</span><span class="track"><span class="fill" style="width:${Math.max(0, Math.min(100, pct))}%"></span></span></div>`;

export const STYLE = `
  :root { color-scheme: light; --page:#f9f9f7; --surface:#fcfcfb; --ink:#0b0b0b; --ink-2:#52514e; --muted:#898781; --grid:#e1e0d9; --border:rgba(11,11,11,.10); --blue:#2a78d6; --blue-light:#86b6ef; --good-text:#006300; --critical:#d03b3b; }
  @media (prefers-color-scheme: dark) { :root { color-scheme:dark; --page:#0d0d0d; --surface:#1a1a19; --ink:#fff; --ink-2:#c3c2b7; --muted:#898781; --grid:#2c2c2a; --border:rgba(255,255,255,.10); --blue:#3987e5; --blue-light:#9ec5f4; --good-text:#0ca30c; --critical:#d03b3b; } }
  * { box-sizing:border-box; margin:0; } body { background:var(--page); color:var(--ink); font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; padding:32px 16px; } main { max-width:960px; margin:0 auto; display:grid; gap:16px; } header h1 { font-size:20px; font-weight:650; } header .sub { color:var(--ink-2); margin-top:2px; } header .meta { color:var(--muted); font-size:12.5px; margin-top:2px; }
  section { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:20px; } h2 { font-size:12.5px; font-weight:650; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-2); margin-bottom:12px; } h2 .note { text-transform:none; letter-spacing:0; font-weight:400; color:var(--muted); }
  .scope { color:var(--ink-2); font-size:12.5px; display:flex; flex-wrap:wrap; gap:6px 14px; margin-top:8px; } .scope span { white-space:nowrap; } .perspectives { display:flex; flex-wrap:wrap; gap:6px; margin-top:16px; } .perspectives a { color:var(--ink-2); text-decoration:none; border:1px solid var(--border); border-radius:999px; padding:5px 11px; font-size:12.5px; } .perspectives a.active { color:var(--ink); border-color:var(--blue); box-shadow:inset 0 0 0 1px var(--blue); }
  .question { color:var(--ink-2); font-size:16px; margin:-4px 0 14px; } .conclusion { border-left:3px solid var(--blue); padding:8px 12px; color:var(--ink); background:color-mix(in srgb,var(--blue) 7%,var(--surface)); } .signals { display:grid; grid-template-columns:repeat(auto-fit,minmax(145px,1fr)); gap:9px; margin-top:14px; } .signal { border:1px solid var(--border); border-radius:8px; padding:10px 12px; } .signal-label { color:var(--muted); font-size:11.5px; text-transform:uppercase; letter-spacing:.04em; } .signal-value { font-size:20px; font-weight:650; margin-top:2px; } .signal-detail { color:var(--muted); font-size:11.5px; margin-top:2px; } .signal.critical .signal-value,.finding.critical .finding-label { color:var(--critical); } .signal.good .signal-value { color:var(--good-text); } .signal.caution .signal-value,.finding.caution .finding-label { color:#9a6500; }
  .findings { display:grid; gap:7px; } .finding { border:1px solid var(--border); border-radius:7px; padding:8px 10px; } .finding-label { font-weight:600; } .finding-detail { color:var(--ink-2); font-size:12.5px; margin-top:2px; overflow-wrap:anywhere; } .row { display:grid; grid-template-columns:minmax(120px,180px) 70px 48px 1fr; gap:10px; align-items:center; padding:3px 0; } .row-label { color:var(--ink); } .row-ratio,.muted-row { color:var(--muted); } .row-pct { color:var(--ink-2); text-align:right; font-variant-numeric:tabular-nums; } .track { height:8px; background:var(--grid); border-radius:4px; overflow:hidden; } .fill { display:block; height:100%; background:var(--blue); border-radius:4px; } .missing { color:var(--critical); font-size:12.5px; margin:2px 0 8px; } .fineprint { color:var(--muted); font-size:12.5px; margin-top:8px; } .charts { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:20px; } .chart-title { color:var(--ink-2); font-size:12.5px; margin-bottom:6px; } .chart-box { position:relative; height:240px; } table { border-collapse:collapse; width:100%; margin-top:10px; font-size:12.5px; } th,td { text-align:right; padding:3px 10px; font-variant-numeric:tabular-nums; } th:first-child,td:first-child { text-align:left; padding-left:0; } th { color:var(--muted); font-weight:500; border-bottom:1px solid var(--grid); } td { color:var(--ink-2); } details summary { color:var(--muted); font-size:12.5px; cursor:pointer; margin-top:8px; } code { color:var(--ink-2); }
`;

const CHART_SCRIPT = `
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const charts = [];
  function makeChart(id, build) { const el = document.getElementById(id); if (!el) return; charts.push({el,build,chart:new Chart(el,build())}); }
  function scales(x,y) { return {x:{title:{display:!!x,text:x,color:css("--muted")},ticks:{color:css("--muted")},grid:{display:false},border:{color:css("--grid")}},y:{beginAtZero:true,title:{display:!!y,text:y,color:css("--muted")},ticks:{color:css("--muted")},grid:{color:css("--grid")},border:{display:false}}}; }
  const line = (values) => ({data:values,borderColor:css("--blue"),backgroundColor:css("--blue"),borderWidth:2,pointRadius:4,pointHoverRadius:6,pointBorderColor:css("--surface"),pointBorderWidth:2,spanGaps:false});
  if (REPORT.capability.categories.length > 0) makeChart("capability-chart", () => ({type:"bar",data:{labels:REPORT.capability.categories.map(c=>CATEGORY_LABELS[c.category]??c.category),datasets:[{data:REPORT.capability.categories.map(c=>c.pct),backgroundColor:css("--blue"),borderRadius:4,barThickness:14}]},options:{indexAxis:"y",maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{...scales("","").x,max:100,ticks:{color:css("--muted"),callback:v=>v+"%"}},y:{ticks:{color:css("--ink-2")},grid:{display:false}}}}));
  const points = (REPORT.bench && REPORT.bench.contextScaling || []).filter(p=>!p.note); const labels = points.map(p=>{const tokens=p.inputTokens??p.targetTokens;return "~"+(tokens>=1000?Math.round(tokens/100)/10+"k":tokens)});
  if (points.length > 0) { makeChart("context-decode-chart",()=>({type:"line",data:{labels,datasets:[line(points.map(p=>p.decodeTokPerSec))]},options:{maintainAspectRatio:false,plugins:{legend:{display:false}},scales:scales("prompt tokens","decode tok/s")}})); makeChart("context-ttft-chart",()=>({type:"line",data:{labels,datasets:[line(points.map(p=>p.ttftMs))]},options:{maintainAspectRatio:false,plugins:{legend:{display:false}},scales:scales("prompt tokens","first token, ms")}})); const pre=points.filter(p=>p.prefillTokPerSec!=null); if(pre.length) makeChart("context-prefill-chart",()=>({type:"line",data:{labels:pre.map(p=>"~"+p.inputTokens),datasets:[line(pre.map(p=>p.prefillTokPerSec))]},options:{maintainAspectRatio:false,plugins:{legend:{display:false}},scales:scales("prompt tokens","prefill tok/s")}})); const step=points.filter(p=>p.speculative&&p.speculative.tokensPerStep!=null); if(step.length) makeChart("context-step-chart",()=>({type:"line",data:{labels:step.map(p=>"~"+p.inputTokens),datasets:[line(step.map(p=>p.speculative.tokensPerStep))]},options:{maintainAspectRatio:false,plugins:{legend:{display:false}},scales:scales("prompt tokens","tokens per decode step")}})); }
  const spec = REPORT.bench && REPORT.bench.speculative; if(spec) makeChart("speculative-chart",()=>({type:"bar",data:{labels:["predictable (echo)","novel (invent)"],datasets:[{data:[spec.predictableTokPerSec,spec.novelTokPerSec],backgroundColor:[css("--blue"),css("--blue-light")],borderRadius:4,barThickness:32}]},options:{maintainAspectRatio:false,plugins:{legend:{display:false}},scales:scales("","decode tok/s")}}));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change",()=>charts.forEach(e=>{e.chart.destroy();e.chart=new Chart(e.el,e.build());}));
`;

export interface HtmlRenderOptions {
  baseline?: { label: string; regressions: string[]; improvements: string[] };
}

const renderFinding = (finding: InsightFinding): string =>
  `<div class="finding ${finding.kind}"><div class="finding-label">${finding.kind === "critical" ? "✗" : finding.kind === "caution" ? "⚠" : "·"} ${esc(finding.label)}</div><div class="finding-detail">${esc(finding.detail)}</div></div>`;

export function renderHtml(
  report: JsonReport,
  options: HtmlRenderOptions = {},
): string {
  report = normalizeJsonReport(report);
  const target = [report.target.baseUrl, report.target.engine]
    .filter(Boolean)
    .join(" · ");
  const perspectives = (Object.keys(PERSPECTIVES) as Perspective[]).map(
    (perspective) => buildPerspectiveInsights(report, perspective),
  );
  const machine = report.bench
    ? [
        report.bench.machine.cpu,
        `${report.bench.machine.memGB} GB`,
        `${report.bench.machine.platform} ${report.bench.machine.arch}`,
      ].join(" · ")
    : "hardware not recorded";
  const nav = perspectives
    .map(
      (item) =>
        `<a href="#${item.perspective}" data-perspective="${item.perspective}">${esc(item.title)}</a>`,
    )
    .join("");
  const summaries = perspectives
    .map(
      (item) =>
        `<section class="view-summary" data-view="${item.perspective}"><h2>${esc(item.title)}</h2><div class="question">${esc(item.question)}</div><div class="conclusion">${esc(item.conclusion)}</div><div class="signals">${item.signals.map((signal) => `<div class="signal ${signal.tone ?? "neutral"}"><div class="signal-label">${esc(signal.label)}</div><div class="signal-value">${esc(signal.value)}</div><div class="signal-detail">${esc(signal.detail ?? "")}</div></div>`).join("")}</div></section>`,
    )
    .join("");
  const findings = perspectives
    .map(
      (item) =>
        `<section class="view-findings" data-view="${item.perspective}"><h2>What needs attention <span class="note">— ${esc(item.title)}</span></h2>${item.findings.length > 0 ? `<div class="findings">${item.findings.map(renderFinding).join("")}</div>` : `<div class="muted-row">No findings recorded for this perspective.</div>`}</section>`,
    )
    .join("");
  const coverage = report.coverage.byTier
    .map(
      (tier) =>
        `${pctBar(tier.tier.toUpperCase(), `${tier.supported}/${tier.total}`, tier.pct)}${tier.missing.length ? `<div class="missing">${tier.missing.map((label) => `✗ ${esc(label)}`).join("&ensp;")}</div>` : ""}${tier.unprobed.length ? `<div class="fineprint">not probed: ${tier.unprobed.map(esc).join(", ")}</div>` : ""}`,
    )
    .join("");
  const credits = report.coverage.credits
    .map(
      (credit) =>
        `<div class="fineprint">○ ${esc(credit.label)} — detected, not scored</div>`,
    )
    .join("");
  const conformance = report.conformance.bySurface
    .map((surface) =>
      pctBar(
        surface.surface,
        `${surface.passed}/${surface.total}`,
        surface.pct,
      ),
    )
    .join("");
  const failures = report.conformance.results
    .flatMap((result) =>
      result.failures.map(
        (failure) =>
          `<tr><td>${esc(result.name ?? result.id)}</td><td>${esc(failure.severity)}</td><td>${esc(failure.label ?? failure.id)}</td><td>${esc(failure.message ?? "")}</td></tr>`,
      ),
    )
    .join("");
  const cap = report.capability;
  const capSection = `<section class="view-section" data-view-order="model,deploy,engine"><h2>Model capability <span class="note">— ${cap.categories.length ? `${cap.pct}% · ${esc(cap.verdict)}` : "not measured"}</span></h2>${cap.categories.length ? `<div class="chart-box" style="height:${40 + cap.categories.length * 30}px"><canvas id="capability-chart"></canvas></div><details><summary>category data</summary><table><tr><th>category</th><th>passed</th><th>total</th><th>%</th></tr>${cap.categories.map((category) => `<tr><td>${esc(CATEGORY_LABELS[category.category as EvalCategory] ?? category.category)}</td><td>${category.passed}</td><td>${category.total}</td><td>${category.pct}%</td></tr>`).join("")}</table></details>` : `<div class="muted-row">${esc(phaseLabel(report, "capability"))}</div>`}</section>`;
  const agenticSection = `<section class="view-section" data-view-order="model,deploy,engine"><h2>Agentic work <span class="note">— ${report.agentic ? `${report.agentic.passed}/${report.agentic.total} tasks` : "not measured"}</span></h2>${report.agentic ? report.agentic.tasks.map((task) => `<div class="row" style="grid-template-columns:16px 1fr 70px"><span>${task.passed ? "✓" : "✗"}</span><span class="row-label">${esc(task.name)}</span><span class="row-ratio">${task.steps} steps</span></div>${!task.passed && task.detail ? `<div class="missing">→ ${esc(task.detail)}</div>` : ""}`).join("") : `<div class="muted-row">${esc(phaseLabel(report, "agentic"))}</div>`}</section>`;
  const fidSection = `<section class="view-section" data-view-order="model,engine,deploy"><h2>Engine fidelity <span class="note">— ${report.fidelity ? `${report.fidelity.pct}% · same-model comparisons only` : "not measured"}</span></h2>${report.fidelity ? report.fidelity.slices.map((slice) => (slice.measured ? pctBar(slice.label, slice.detail, Math.round(slice.score * 10000) / 100) : `<div class="row"><span class="row-label">${esc(slice.label)}</span><span class="row-ratio" style="grid-column:2/5;text-align:left">${esc(slice.detail)}</span></div>`)).join("") : `<div class="muted-row">${esc(phaseLabel(report, "fidelity"))}</div>`}</section>`;
  const bench = report.bench;
  const perfSection = bench
    ? `<section class="view-section" data-view-order="deploy,model,engine"><h2>Performance <span class="note">— informational, same-machine comparisons only · ${esc(machine)}</span></h2>${bench.loadDrift && bench.loadDrift.verdict !== "steady" ? `<div class="missing">⚠ sustained load ${bench.loadDrift.firstTokPerSec} → ${bench.loadDrift.lastTokPerSec} tok/s (${bench.loadDrift.driftPct}%)</div>` : ""}${bench.decodeTokPerSec ? `<div class="signals"><div class="signal"><div class="signal-label">Decode</div><div class="signal-value">${bench.decodeTokPerSec.median} tok/s</div><div class="signal-detail">${bench.decodeTokPerSec.min}–${bench.decodeTokPerSec.max} range</div></div><div class="signal"><div class="signal-label">First token</div><div class="signal-value">${bench.ttftMs?.median ?? "n/a"} ms</div><div class="signal-detail">time to first token</div></div><div class="signal"><div class="signal-label">Prefill</div><div class="signal-value">${bench.prefillTokPerSec ? Math.round(bench.prefillTokPerSec.median) : "n/a"} tok/s</div><div class="signal-detail">${bench.prefillPromptTokens ?? "n/a"}-token prompt</div></div></div>` : ""}${bench.contextScaling?.length ? `<div class="charts"><div><div class="chart-title">Decode throughput vs context</div><div class="chart-box"><canvas id="context-decode-chart"></canvas></div></div><div><div class="chart-title">Time to first token vs context</div><div class="chart-box"><canvas id="context-ttft-chart"></canvas></div></div>${bench.contextScaling.some((point) => point.prefillTokPerSec != null) ? `<div><div class="chart-title">Prefill throughput vs context</div><div class="chart-box"><canvas id="context-prefill-chart"></canvas></div></div>` : ""}${bench.contextScaling.some((point) => point.speculative?.tokensPerStep != null) ? `<div><div class="chart-title">Tokens per decode step vs context</div><div class="chart-box"><canvas id="context-step-chart"></canvas></div></div>` : ""}</div><table><tr><th>prompt tokens</th><th>decode tok/s</th><th>first token, ms</th><th>prefill tok/s</th><th>tok/step</th><th>runs</th></tr>${bench.contextScaling.map((point) => `<tr><td>~${fmtTokensK(point.inputTokens ?? point.targetTokens)}</td><td>${point.decodeTokPerSec ?? "n/a"}</td><td>${point.ttftMs ?? "n/a"}</td><td>${point.prefillTokPerSec ?? "n/a"}</td><td>${point.speculative?.tokensPerStep ?? "n/a"}</td><td>${point.runs}</td></tr>`).join("")}</table>` : ""}${bench.speculative ? `<div style="margin-top:20px"><div class="chart-title">Speculative decoding — ${bench.speculative.ratio}× (${esc(bench.speculative.verdict)})</div><div class="chart-box" style="height:180px;max-width:420px"><canvas id="speculative-chart"></canvas></div></div>` : ""}</section>`
    : `<section class="view-section" data-view-order="deploy,model,engine"><h2>Performance</h2><div class="muted-row">${esc(phaseLabel(report, "performance"))}</div></section>`;
  const baseline = options.baseline
    ? `<section class="view-section" data-view-order="engine,deploy,model"><h2>Baseline changes <span class="note">— ${esc(options.baseline.label)}</span></h2>${options.baseline.regressions.length ? `<div class="findings">${options.baseline.regressions.map((item) => renderFinding({ kind: "critical", label: "Regressed", detail: item })).join("")}</div>` : `<div class="muted-row">No regressions recorded.</div>`}${options.baseline.improvements.length ? `<div class="findings">${options.baseline.improvements.map((item) => renderFinding({ kind: "note", label: "Improved", detail: item })).join("")}</div>` : ""}</section>`
    : "";
  const scope = report.run
    ? `<div class="scope"><span>depth: ${esc(report.run.depth)}</span><span>mode: ${esc(report.run.mode)}</span><span>started: ${esc(report.run.startedAt)}</span><span>machine: ${esc(machine)}</span>${report.run.budget?.limitTokens ? `<span>budget: ${report.run.budget.limitTokens.toLocaleString()} tokens${report.run.budget.exhausted ? " · exhausted" : ""}</span>` : ""}</div>`
    : `<div class="scope"><span>run scope not recorded in this report</span><span>machine: ${esc(machine)}</span></div>`;
  const footer = [
    report.usage
      ? `${(report.usage.inputTokens + report.usage.outputTokens).toLocaleString("en-US")} tokens`
      : "",
    `${Math.round(report.durationMs / 1000)}s`,
    report.run?.startedAt ? `measured ${report.run.startedAt}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>llmprobe — ${esc(report.target.model)}</title><style>${STYLE}</style></head><body><main><header><h1>llmprobe evidence report</h1><div class="sub">${esc(report.target.model)}</div><div class="meta">${esc(target)}</div>${scope}<nav class="perspectives" aria-label="Dashboard perspective">${nav}</nav></header>${summaries}${findings}${baseline}<section class="view-section" data-view-order="deploy,engine,model"><h2>Surface coverage <span class="note">— can client software integrate?</span></h2>${coverage}${credits}</section><section class="view-section" data-view-order="deploy,engine,model"><h2>Engine conformance <span class="note">— MUST assertions, implemented surfaces only</span></h2>${conformance}${failures ? `<details><summary>failure details</summary><table><tr><th>test</th><th>severity</th><th>assertion</th><th>evidence</th></tr>${failures}</table></details>` : ""}</section>${capSection}${agenticSection}${fidSection}${perfSection}<div class="fineprint">${esc(footer)}</div></main><script>${chartJsBundle()}</script><script>const REPORT=${embedJson(report)};const CATEGORY_LABELS=${embedJson(CATEGORY_LABELS)};const perspectiveLinks=[...document.querySelectorAll("[data-perspective]")];const summaries=[...document.querySelectorAll(".view-summary")];const findingPanels=[...document.querySelectorAll(".view-findings")];const ordered=[...document.querySelectorAll(".view-section")];function setPerspective(name){const chosen=["model","deploy","engine"].includes(name)?name:"model";perspectiveLinks.forEach(link=>{const active=link.dataset.perspective===chosen;link.classList.toggle("active",active);link.setAttribute("aria-current",active?"page":"false")});summaries.forEach(panel=>panel.hidden=panel.dataset.view!==chosen);findingPanels.forEach(panel=>panel.hidden=panel.dataset.view!==chosen);const main=document.querySelector("main");ordered.sort((a,b)=>{const rank=el=>{const values=(el.dataset.viewOrder||"").split(",");const index=values.indexOf(chosen);return index<0?99:index};return rank(a)-rank(b)}).forEach(el=>main?.appendChild(el))}setPerspective(location.hash.slice(1));window.addEventListener("hashchange",()=>setPerspective(location.hash.slice(1)));${CHART_SCRIPT}</script></body></html>`;
}
