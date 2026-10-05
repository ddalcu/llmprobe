import type { JsonReport, ReportRunScope } from "../json";
import { normalizeJsonReport } from "../json";
import { benchSection } from "./bench";
import { reasoningSection } from "./reasoning";
import { CARD_STYLE } from "./style.css";
import { engineSettingsSummary } from "../../engine-settings";
import { REPORT_SCRIPT } from "./report-script";
import {
  AGENTIC_FAILURE_GLOSS,
  CATEGORY_FLOOR_PCT,
  barFill,
  catLabel,
  confTableRows,
  coverageStatus,
  esc,
  embedJson,
  fmtDuration,
  fmtTokens,
  mustFailures,
  outcomeCounts,
  shortModel,
  statusPill,
  tier,
  toneForPct,
  verdictTone,
} from "./shared";

export interface CardHtmlOptions {
  /** Optional path/label for the source save file. */
  label?: string;
  /** When set, show ← Library linking here (e.g. "index.html"). */
  libraryHref?: string;
  baseline?: {
    label: string;
    regressions: string[];
    improvements: string[];
  };
}

function tierBlocks(report: JsonReport): string {
  const entries = report.coverage?.entries ?? [];
  return (report.coverage?.byTier ?? [])
    .map((t) => {
      const tone = toneForPct(t.pct);
      const tierEntries = entries.filter((e) => e.tier === t.tier);
      let rows = "";
      if (tierEntries.length > 0) {
        rows = tierEntries
          .slice()
          .sort((a, b) => {
            const rank = (e: (typeof tierEntries)[number]) =>
              coverageStatus(e) === "missing"
                ? 0
                : coverageStatus(e) === "not-probed"
                  ? 1
                  : 2;
            return (
              rank(a) - rank(b) ||
              (a.label || a.id).localeCompare(b.label || b.id)
            );
          })
          .map((e) => {
            const st = coverageStatus(e);
            return `<tr>
                  <td>${esc(e.label || e.id)}</td>
                  <td>${esc(e.kind || "—")}</td>
                  <td>${statusPill(st)}</td>
                  <td>${esc(e.detail || (st === "supported" ? "present" : st === "not-probed" ? "not probed at this depth" : "not supported"))}</td>
                </tr>`;
          })
          .join("");
      } else {
        rows = [
          ...(t.missing || []).map(
            (m) =>
              `<tr><td>${esc(m)}</td><td>—</td><td>${statusPill("missing")}</td><td>listed as missing on tier summary</td></tr>`,
          ),
          ...(t.unprobed || []).map(
            (m) =>
              `<tr><td>${esc(m)}</td><td>—</td><td>${statusPill("not-probed")}</td><td>not probed at this depth</td></tr>`,
          ),
        ].join("");
        if (!rows) {
          rows = `<tr><td colspan="4" class="fine">No entry detail in this save.</td></tr>`;
        }
      }

      const missing =
        t.missing?.length > 0
          ? `<div class="missing">${t.missing.map((m) => `<span>✗ ${esc(m)}</span>`).join("")}</div>`
          : "";
      const unprobed =
        (t.unprobed?.length ?? 0) > 0
          ? `<div class="fine">not probed: ${t.unprobed!.map(esc).join(", ")}</div>`
          : "";

      return `<div class="tier-block">
        <button type="button" class="tier-toggle" data-tier="${esc(t.tier)}" aria-expanded="false" aria-controls="tier-panel-${esc(t.tier)}">
          <div class="row">
            <span class="row-label"><span class="chev">▸</span>${esc(t.tier.toUpperCase())}</span>
            <span class="row-ratio">${t.supported}/${t.total}</span>
            <span class="row-pct ${tone}">${t.pct}%</span>
            ${barFill(t.pct)}
          </div>
        </button>
        ${missing}${unprobed}
        <div class="expand-panel" id="tier-panel-${esc(t.tier)}" hidden>
          <table class="drill-table">
            <thead><tr><th>Feature</th><th>Kind</th><th>Status</th><th>Detail</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
    })
    .join("");
}

/**
 * Self-contained intent-based report card HTML (drill-downs, filters).
 * Replaces the older perspective-based product HTML.
 */
export function renderCardHtml(
  reportIn: JsonReport,
  options: CardHtmlOptions = {},
): string {
  const report = normalizeJsonReport(reportIn);
  const model = report.target?.model ?? "unknown";
  const engine = report.target?.engine ?? null;
  const settings = engineSettingsSummary(report.target?.engineSettings);
  const baseUrl = report.target?.baseUrl ?? "";
  const core = tier(report, "core");
  const conf = report.conformance;
  const confMeasured = (conf?.total ?? 0) > 0;
  const cap = report.capability;
  const capMeasured = (cap?.categories?.length ?? 0) > 0;
  const agentic = report.agentic;
  const fidelity = report.fidelity;
  const must = mustFailures(report);
  const outcomes = outcomeCounts(report);
  const bench = report.bench;

  // What this run actually measured. A --bench-only or --quick run never
  // touched the scored phases, and rendering their empty cards reads as an
  // engine that failed everything rather than one nobody asked about.
  const phases = report.run?.phases;
  const ran = (key: keyof ReportRunScope["phases"]): boolean =>
    (phases?.[key]?.status ?? "measured") !== "not-run";
  const notRun = (
    ["conformance", "capability", "agentic", "fidelity"] as Array<
      keyof ReportRunScope["phases"]
    >
  ).filter((key) => !ran(key));
  const notRunReasons = [
    ...new Set(notRun.map((key) => phases?.[key]?.reason).filter(Boolean)),
  ] as string[];
  const scopeNote =
    notRun.length > 0
      ? `<p class="fine scope-note">Not run in this probe: ${notRun.join(", ")}${
          notRunReasons.length > 0 ? ` — ${esc(notRunReasons.join("; "))}` : ""
        }. Only what was measured is shown below.</p>`
      : "";

  const covTone = toneForPct(core?.pct);
  const confTone = confMeasured
    ? toneForPct(conf.pct, { perfect: true })
    : "neutral";
  const confToneStrict = confMeasured && conf.pct < 100 ? "critical" : confTone;
  const capTone = capMeasured ? verdictTone(cap.verdict) : "neutral";

  const coreHeadline = core ? `${core.pct}%` : "—";
  const confHeadline = confMeasured ? `${conf.pct}%` : "—";
  const capHeadline = capMeasured ? `${cap.pct}%` : "—";

  const nav = options.libraryHref
    ? `<a class="btn" href="${esc(options.libraryHref)}">← Library</a>`
    : "";

  const credits = (report.coverage?.credits ?? [])
    .map(
      (c) => `<div class="fine">○ ${esc(c.label)} — detected, not scored</div>`,
    )
    .join("");

  const surfaces = (conf?.bySurface ?? [])
    .map((s) => {
      const t = toneForPct(s.pct);
      const color =
        t === "good"
          ? "var(--good)"
          : t === "critical"
            ? "var(--critical)"
            : t === "caution"
              ? "var(--caution)"
              : "var(--ink)";
      return `<button type="button" class="surface" data-surface-filter="${esc(s.surface)}" title="Filter checks to ${esc(s.surface)}">
        <div class="n" style="color:${color}">${s.pct}%</div>
        <div class="l">${esc(s.surface)}</div>
        <div class="r">${s.passed}/${s.total} MUST</div>
      </button>`;
    })
    .join("");

  const evals = cap?.evals ?? [];
  const cats = (cap?.categories ?? [])
    .map((c) => {
      const weak = (cap.weakCategories ?? []).includes(c.category);
      const tone = weak ? "critical" : toneForPct(c.pct);
      const panelId = `cap-${c.category}`;
      const catEvals = evals
        .filter((e) => e.category === c.category)
        .slice()
        .sort((a, b) => {
          const aFail = a.passed < a.total ? 0 : 1;
          const bFail = b.passed < b.total ? 0 : 1;
          return (
            aFail - bFail || (a.name || a.id).localeCompare(b.name || b.id)
          );
        });
      const evalRows =
        catEvals.length > 0
          ? catEvals
              .map((e) => {
                const ok = e.passed >= e.total;
                const fails = (e.failures ?? [])
                  .map((f) => esc(typeof f === "string" ? f : String(f)))
                  .join("; ");
                return `<tr class="${ok ? "" : "fail-row"}">
                  <td>${esc(e.name || e.id)}</td>
                  <td>${e.passed}/${e.total}</td>
                  <td>${ok ? statusPill("pass") : statusPill("fail")}</td>
                  <td>${fails || (ok ? "—" : "sample failure")}</td>
                </tr>`;
              })
              .join("")
          : `<tr><td colspan="4" class="fine">No per-eval detail in this save for ${esc(catLabel(c.category))}.</td></tr>`;

      return `<div class="cat-block">
        <button type="button" class="cat-toggle" data-expand="${esc(panelId)}" aria-expanded="false" aria-controls="${esc(panelId)}">
          <div class="cat-row">
            <span class="row-label"><span class="chev">▸</span>${esc(catLabel(c.category))}</span>
            <span class="row-ratio">${c.passed}/${c.total}</span>
            <span class="row-pct ${tone}">${c.pct}%</span>
            <span class="floor-mark">${barFill(c.pct, "model")}</span>
          </div>
        </button>
        <div class="expand-panel" id="${esc(panelId)}" hidden>
          <table class="drill-table">
            <thead><tr><th>Eval</th><th>Samples</th><th>Status</th><th>Failure detail</th></tr></thead>
            <tbody>${evalRows}</tbody>
          </table>
        </div>
      </div>`;
    })
    .join("");

  const weakNote =
    (cap?.weakCategories?.length ?? 0) > 0
      ? `<div class="missing">below the floor: ${cap.weakCategories.map((c) => esc(catLabel(c))).join(", ")}</div>`
      : "";
  const unmeasNote =
    (cap?.unmeasured?.length ?? 0) > 0
      ? `<div class="fine">⚠ never measured: ${cap.unmeasured!.map((c) => esc(catLabel(c))).join(", ")} — not treated as pass</div>`
      : "";

  const tasks = agentic
    ? `<table class="drill-table task-table">
        <thead><tr><th></th><th>Task</th><th>Steps</th><th>Result</th></tr></thead>
        <tbody>${agentic.tasks
          .map((t) => {
            const gloss =
              !t.passed && t.failure ? AGENTIC_FAILURE_GLOSS[t.failure] : null;
            const result = t.passed
              ? ""
              : `<span class="chip">${esc(t.failure ?? "failed")}</span> ${esc([gloss, t.detail].filter(Boolean).join(" — "))}`;
            const violations = (t.violations ?? [])
              .map(
                (v) =>
                  `<div class="detail">${v.severity === "must" ? "✗" : "!"} ${esc(`${v.rule}${v.step !== null ? ` (step ${v.step})` : ""}: ${v.detail}`)}</div>`,
              )
              .join("");
            const calls = t.calls
              ? ` · ${t.calls.valid}/${t.calls.total} valid`
              : "";
            return `<tr>
              <td class="${t.passed ? "ok" : "bad"}">${t.passed ? "✓" : "✗"}</td>
              <td>${esc(t.name)}</td>
              <td class="steps">${t.steps}${calls}</td>
              <td>${result}${violations}</td>
            </tr>`;
          })
          .join("")}</tbody>
      </table>`
    : `<p class="fine">Agentic not measured in this run.</p>`;

  const fidSlices = fidelity
    ? fidelity.slices
        .map((s) => {
          const panelId = `fid-${s.id}`;
          const sp = s.measured ? Math.round(s.score * 10000) / 100 : null;
          const header = s.measured
            ? `<div class="row" style="grid-template-columns:minmax(140px,200px) 52px 1fr">
                <span class="row-label"><span class="chev">▸</span>${esc(s.label)}</span>
                <span class="row-pct ${toneForPct(sp)}">${sp}%</span>
                ${barFill(sp)}
              </div>`
            : `<div class="row" style="grid-template-columns:minmax(140px,200px) 1fr">
                <span class="row-label"><span class="chev">▸</span>${esc(s.label)}</span>
                <span class="fine" style="margin:0"><span class="status-pill not-probed">not measured</span> — ${esc(s.detail || s.unmeasuredReason || "")}</span>
              </div>`;

          const weightPct = Math.round((s.weight ?? 0) * 100);
          const checks: string[] = [];
          checks.push(
            `<tr><td>Measured</td><td>${s.measured ? statusPill("pass") : statusPill("unsupported")}</td><td>${esc(s.measured ? "included in fidelity headline" : "excluded from denominator (not zeroed)")}</td></tr>`,
          );
          checks.push(
            `<tr><td>Score</td><td>${s.measured ? `${sp}%` : "—"}</td><td>${esc(s.detail || "")}</td></tr>`,
          );
          checks.push(
            `<tr><td>Weight</td><td>${weightPct}%</td><td>blend weight among measured slices</td></tr>`,
          );
          if (!s.measured) {
            checks.push(
              `<tr><td>Why unmeasured</td><td colspan="2">${esc(s.unmeasuredReason || s.detail || "engine could not be measured on this slice")}</td></tr>`,
            );
          }
          if (s.id === "correctness" && fidelity.items != null) {
            checks.push(
              `<tr><td>Battery items</td><td>${esc(String(fidelity.items))}</td><td>${esc(s.detail || "graded for correctness")}</td></tr>`,
            );
          }
          if (s.id === "determinism" && fidelity.firstDivergence) {
            const d = fidelity.firstDivergence;
            checks.push(
              `<tr><td>First divergence</td><td class="fail-row">${esc(d.itemId)} @ char ${d.charIndex}</td><td>${d.runs} greedy runs disagreed — pure engine non-determinism at temperature 0</td></tr>`,
            );
          } else if (s.id === "determinism" && s.measured) {
            checks.push(
              `<tr><td>First divergence</td><td>${statusPill("pass")}</td><td>no temperature-0 divergence recorded</td></tr>`,
            );
          }
          if (s.id === "confidence" || s.id === "consistency") {
            checks.push(
              `<tr><td>Requires</td><td colspan="2">logprobs from the engine — absent → slice dropped, not scored zero</td></tr>`,
            );
          }

          return `<div class="fid-block">
            <button type="button" class="fid-toggle" data-expand="${esc(panelId)}" aria-expanded="false" aria-controls="${esc(panelId)}">
              ${header}
            </button>
            <div class="expand-panel" id="${esc(panelId)}" hidden>
              <table class="drill-table">
                <thead><tr><th>Check</th><th>Result</th><th>Detail</th></tr></thead>
                <tbody>${checks.join("")}</tbody>
              </table>
            </div>
          </div>`;
        })
        .join("")
    : `<p class="fine">Fidelity not measured in this run.</p>`;

  const confRows = confTableRows(report);
  const boot = { confRows };

  const footerBits = [
    report.usage
      ? `${fmtTokens(report.usage.inputTokens + report.usage.outputTokens)} tokens (${fmtTokens(report.usage.inputTokens)} in · ${fmtTokens(report.usage.outputTokens)} out)`
      : null,
    fmtDuration(report.durationMs),
    options.label ? `file: ${options.label}` : null,
  ].filter(Boolean);

  const tierPct = (name: string) => tier(report, name)?.pct;
  const agenticTone = agentic
    ? agentic.passed === agentic.total
      ? "good"
      : agentic.passed === 0
        ? "critical"
        : "caution"
    : "";
  const reasoning = report.reasoning;
  const reasoningPct =
    reasoning && reasoning.total > 0
      ? Math.round((100 * reasoning.passed) / reasoning.total)
      : 0;

  // One line per independent score, each linking to its section below.
  const summaryRows: Array<[string, string, string, string, string, string]> = [
    [
      "coverage",
      "Surface coverage",
      covTone,
      `Core ${coreHeadline}`,
      `core ${core ? `${core.supported}/${core.total}` : "—"}${core?.missing?.length ? ` <span class="badge critical">${core.missing.length} core gap${core.missing.length > 1 ? "s" : ""}</span>` : ""} · extended ${tierPct("extended") ?? "—"}% · frontier ${tierPct("frontier") ?? "—"}%`,
      "How much of the standard API surface exists; missing features are listed",
    ],
    ...(ran("conformance")
      ? ([
          [
            "conformance",
            "Engine conformance",
            confToneStrict,
            confHeadline,
            confMeasured
              ? `${conf.passed}/${conf.total} MUST${must.length ? ` <span class="badge critical">${must.length} violation${must.length > 1 ? "s" : ""}</span>` : ""}`
              : "not measured",
            "How correct the MUST behaviors are on surfaces that exist; unsupported ≠ fail",
          ],
          [
            "conformance",
            "Outcomes",
            "",
            "",
            `pass ${outcomes.pass} · <span class="critical">fail ${outcomes.fail}</span> · unsupported ${outcomes.unsupported} · <span class="caution">inconclusive ${outcomes.inconclusive}</span> · <span class="muted">skipped ${outcomes.skipped}</span>`,
            "Unsupported and inconclusive are neither zeros nor fails",
          ],
        ] as Array<[string, string, string, string, string, string]>)
      : []),
    ...(ran("capability")
      ? ([
          [
            "capability",
            "Model capability",
            capTone,
            capHeadline,
            capMeasured
              ? `${esc(cap.verdict)} · ${cap.categories.length} categories`
              : "not measured",
            "Practical floor for tools, JSON and instructions",
          ],
        ] as Array<[string, string, string, string, string, string]>)
      : []),
    ...(ran("agentic")
      ? ([
          [
            "agentic",
            "Agentic",
            agenticTone,
            agentic ? `${agentic.passed}/${agentic.total}` : "—",
            agentic ? "tasks passed" : "not measured",
            "Harder multi-step bar, never blended into capability",
          ],
        ] as Array<[string, string, string, string, string, string]>)
      : []),
    ...(ran("fidelity")
      ? ([
          [
            "fidelity",
            "Engine fidelity",
            fidelity ? toneForPct(fidelity.pct) : "",
            fidelity ? `${fidelity.pct}%` : "—",
            fidelity
              ? `${fidelity.slices.filter((x) => x.measured).length}/${fidelity.slices.length} slices measured`
              : "not measured",
            "Same model only: holds the model constant so the number is the engine",
          ],
        ] as Array<[string, string, string, string, string, string]>)
      : []),
    ...(bench
      ? ([
          [
            "performance",
            "Performance",
            "",
            bench.decodeTokPerSec
              ? `${Math.round(bench.decodeTokPerSec.median * 10) / 10} tok/s`
              : "—",
            `decode${bench.ttftMs ? ` · ${Math.round(bench.ttftMs.median)} ms first token` : ""}`,
            "Informational, hardware-dependent, never scored",
          ],
        ] as Array<[string, string, string, string, string, string]>)
      : []),
    ...(reasoning
      ? ([
          [
            "reasoning",
            "Reasoning",
            "",
            `${reasoningPct}%`,
            `${reasoning.passed}/${reasoning.total} correct${reasoning.stopped ? ` · ${reasoning.stopped} out of tokens` : ""}`,
            "GPQA Diamond, SuperGPQA, AIME 2025, COMPSEC subsets; never scored",
          ],
        ] as Array<[string, string, string, string, string, string]>)
      : []),
  ];
  const summaryTable = `<table class="summary" aria-label="Scores">
    <thead><tr><th>Score</th><th>Value</th><th>Detail</th><th>What it means</th></tr></thead>
    <tbody>${summaryRows
      .map(
        ([id, label, tone, value, detail, meaning]) => `<tr>
        <td><a href="#${id}">${esc(label)}</a></td>
        <td class="score-cell ${tone}">${esc(value)}</td>
        <td>${detail}</td>
        <td class="note">${esc(meaning)}</td>
      </tr>`,
      )
      .join("")}</tbody>
  </table>`;

  const baselineSection = options.baseline
    ? `<section class="section" id="baseline">
      <div class="section-head">
        <h2>Baseline changes <span class="tag">diff</span></h2>
        <div class="score">${esc(options.baseline.label)}</div>
      </div>
      ${
        options.baseline.regressions.length
          ? `<div class="findings">${options.baseline.regressions
              .map(
                (item) =>
                  `<div class="finding critical"><div class="finding-label">✗ Regressed</div><div class="finding-detail">${esc(item)}</div></div>`,
              )
              .join("")}</div>`
          : `<div class="fine">No regressions recorded.</div>`
      }
      ${
        options.baseline.improvements.length
          ? `<div class="findings" style="margin-top:8px">${options.baseline.improvements
              .map(
                (item) =>
                  `<div class="finding"><div class="finding-label">· Improved</div><div class="finding-detail">${esc(item)}</div></div>`,
              )
              .join("")}</div>`
          : ""
      }
    </section>`
    : "";

  const conformanceSection = ran("conformance")
    ? `    <section class="section" id="conformance">
      <div class="section-head">
        <h2>Engine conformance <span class="tag">engine</span></h2>
        <div class="score ${confToneStrict}">${esc(confHeadline)}</div>
      </div>
      <p class="lede">MUST assertions on implemented surfaces only. Click a surface tile to filter the table. Default view: failures only.</p>
      <div class="surface-grid">${surfaces || `<p class="fine">No surface breakdown.</p>`}</div>
      <p class="fine" style="margin-top:10px">Unsupported and inconclusive are not failures — they do not enter the conformance denominator. Use the filters below to inspect every check.</p>
      <div class="filter-bar" role="toolbar" aria-label="Filter conformance checks">
        <span class="label">Show</span>
        <button type="button" class="filter-chip active" data-outcome-filter="fail">Failures</button>
        <button type="button" class="filter-chip" data-outcome-filter="all">All checks</button>
        <button type="button" class="filter-chip" data-outcome-filter="pass">Pass</button>
        <button type="button" class="filter-chip" data-outcome-filter="unsupported">Unsupported</button>
        <button type="button" class="filter-chip" data-outcome-filter="inconclusive">Inconclusive</button>
        <button type="button" class="filter-chip" data-outcome-filter="skipped">Skipped</button>
        <button type="button" class="filter-chip" id="clear-surface-filter">Clear surface</button>
        <span class="filter-meta" id="conf-filter-count"></span>
      </div>
      <div class="conf-table-wrap" id="conf-table">
        <table class="drill-table">
          <thead>
            <tr>
              <th>Test</th>
              <th>Surface</th>
              <th>Assertion</th>
              <th>Evidence</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody id="conf-tbody"></tbody>
        </table>
      </div>
    </section>`
    : "";

  const capabilitySection = ran("capability")
    ? `    <section class="section" id="capability">
      <div class="section-head">
        <h2>Model capability <span class="tag">model</span></h2>
        <div class="score ${capTone}">${capMeasured ? `${esc(capHeadline)} · ${esc(cap.verdict)}` : "—"}</div>
      </div>
      <p class="lede">Floor check — not an intelligence rank. Category floor is ${CATEGORY_FLOOR_PCT}% (dashed line). Click a category to expand its evals (failures first).</p>
      ${capMeasured ? cats : `<p class="fine">Capability not measured.</p>`}
      ${weakNote}${unmeasNote}
    </section>`
    : "";

  const agenticSection = ran("agentic")
    ? `    <section class="section" id="agentic">
      <div class="section-head">
        <h2>Agentic <span class="tag">model</span></h2>
        <div class="score ${agentic ? (agentic.passed === agentic.total ? "good" : "caution") : ""}">${agentic ? `${agentic.passed}/${agentic.total} tasks` : "—"}</div>
      </div>
      <p class="lede">Multi-step tool use in a simulated workspace — harder than the capability floor, never blended into it.</p>
      ${tasks}
    </section>`
    : "";

  const fidelitySection = ran("fidelity")
    ? `    <section class="section" id="fidelity">
      <div class="section-head">
        <h2>Engine fidelity <span class="tag">engine</span></h2>
        <div class="score ${fidelity ? toneForPct(fidelity.pct) : ""}">${fidelity ? `${fidelity.pct}%` : "—"}</div>
      </div>
      <p class="lede">Same-model comparisons only. Click a slice to see what was measured. Unmeasured slices are named — never zeroed.</p>
      ${fidSlices}
      ${
        fidelity?.unmeasured?.length
          ? `<div class="fine">· ${fidelity.unmeasured.map(esc).join(", ")} not measured</div>`
          : ""
      }
    </section>`
    : "";

  const performanceSection = bench ? benchSection(bench) : "";
  const reasoningSectionHtml = report.reasoning
    ? reasoningSection(report.reasoning)
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>llmprobe · ${esc(shortModel(model))}</title>
<style>${CARD_STYLE}</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div>
      <div class="brand">llmprobe report card</div>
      <h1>${esc(model)}</h1>
      <div class="meta">
        ${engine ? `<span>${esc(engine)}</span>` : ""}
        ${settings ? `<span${report.target?.engineSettingsChanged ? ` class="badge" title="settings changed during the run; showing the end"` : ""}>${esc(settings)}</span>` : ""}
        ${baseUrl ? `<span>${esc(baseUrl)}</span>` : ""}
        ${report.run?.label && !report.run.labelAuto ? `<span class="badge">${esc(report.run.label)}</span>` : ""}
        ${report.run?.mode === "bench-only" ? `<span class="badge">benchmark only</span>` : ""}
        ${report.run?.mode === "eval-only" ? `<span class="badge">eval only</span>` : ""}
        ${report.run?.depth && report.run.depth !== "default" ? `<span class="badge">--${esc(report.run.depth)}</span>` : ""}
        ${fmtDuration(report.durationMs) ? `<span>ran in ${fmtDuration(report.durationMs)}</span>` : ""}
      </div>
      ${scopeNote}
    </div>
    <nav class="nav-links" aria-label="Reports">${nav}</nav>
  </header>

  <div class="overview-label">
    <h2>Overview</h2>
    <p>${
      ran("conformance") && ran("capability")
        ? "Three independent scores — never averaged"
        : "Only what this run measured — the scores stay independent"
    }</p>
  </div>
  ${summaryTable}

  <div class="story">
    ${baselineSection}
    <div class="trio">
    <section class="section" id="coverage">
      <div class="section-head">
        <h2>Surface coverage <span class="tag">engine</span></h2>
        <div class="score ${covTone}">Core ${esc(coreHeadline)}</div>
      </div>
      <p class="lede">Per tier, never averaged. Click a tier to expand every feature under it; missing features sort first.</p>
      ${tierBlocks(report)}
      ${credits}
    </section>
    ${capabilitySection}
    ${fidelitySection}
    </div>
    ${conformanceSection}
    ${agenticSection}
    ${performanceSection}
    ${reasoningSectionHtml}
  </div>

  <footer class="page">
    ${footerBits.map((b) => `<span>${esc(String(b))}</span>`).join('<span class="sep">·</span>')}
    <span>Scores stay independent — never averaged</span>
  </footer>
</div>
<script>window.__LLMPROBE__=${embedJson(boot)};</script>
<script>${REPORT_SCRIPT}</script>
</body>
</html>`;
}
