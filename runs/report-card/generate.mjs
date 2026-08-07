#!/usr/bin/env node
/**
 * Intent-true report cards that mirror the CLI story, visually.
 *
 *   node runs/report-card/generate.mjs
 *     Auto-discovers llmprobe --save JSON under runs/*.json (and optional paths).
 *   node runs/report-card/generate.mjs path/a.json path/b.json …
 *   node runs/report-card/generate.mjs --compare a.json b.json
 *
 * Writes only under runs/report-card/.
 */
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CATEGORY_FLOOR_PCT,
  CATEGORY_LABELS,
  AGENTIC_FAILURE_GLOSS,
  buildHistoryNarrative,
  detectCompareAxis,
  machinesComparable,
} from "./view-model.mjs";

function mustFailures(report) {
  const out = [];
  for (const result of report.conformance?.results ?? []) {
    for (const failure of result.failures ?? []) {
      if (failure.severity === "MUST") out.push({ result, failure });
    }
  }
  return out;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = __dirname;
const DEFAULTS = {
  laguna: join(__dirname, "..", "my-run.json"),
  qwen: join(__dirname, "..", "my-run-qwen36b.json"),
};

// ── helpers ──────────────────────────────────────────────────────────────────

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const tier = (report, name) =>
  report.coverage?.byTier?.find((t) => t.tier === name) ?? null;

const pct = (n) => (n == null ? "—" : `${n}%`);

const toneForPct = (n, { perfect = true } = {}) => {
  if (n == null) return "neutral";
  if (perfect && n === 100) return "good";
  if (n >= 90) return "good";
  if (n >= 70) return "caution";
  return "critical";
};

const verdictTone = (v) =>
  v === "below-floor" ? "critical" : v === "strong" || v === "capable" ? "good" : "neutral";

const catLabel = (id) => CATEGORY_LABELS[id] ?? id;

const shortModel = (name) => {
  if (!name) return "run";
  return name
    .replace(/-MLX-4bit$/i, "")
    .replace(/-NVFP4-mlx$/i, "")
    .replace(/-mlx$/i, "");
};

const slug = (name) =>
  shortModel(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "run";

function load(path) {
  const abs = resolve(path);
  if (!existsSync(abs)) {
    console.error(`not found: ${abs}`);
    process.exit(1);
  }
  return { path: abs, report: JSON.parse(readFileSync(abs, "utf8")) };
}

function write(name, content) {
  writeFileSync(join(OUT, name), content);
  console.log("wrote", name);
}

function fmtDuration(ms) {
  if (ms == null) return null;
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

function fmtTokens(n) {
  return n == null ? null : n.toLocaleString("en-US");
}

function outcomeCounts(report) {
  const c = { pass: 0, fail: 0, unsupported: 0, inconclusive: 0, skipped: 0 };
  for (const r of report.conformance?.results ?? []) {
    if (r.outcome in c) c[r.outcome] += 1;
  }
  if (c.inconclusive === 0 && report.conformance?.inconclusive?.length)
    c.inconclusive = report.conformance.inconclusive.length;
  return c;
}

// ── shared CSS ───────────────────────────────────────────────────────────────

const STYLE = `
/* Theme tokens — switched via data-theme on <html> (dropdown, not OS) */
:root, [data-theme="light"] {
  color-scheme: light;
  --page: #f3f2ed;
  --page-2: #ebe9e2;
  --surface: #fffcf7;
  --surface-2: #f7f5ef;
  --ink: #141413;
  --ink-2: #3f3e3a;
  --muted: #7a7870;
  --line: rgba(20,20,19,.10);
  --line-strong: rgba(20,20,19,.16);
  --track: #e4e1d8;
  --engine: #1f6feb;
  --engine-soft: rgba(31,111,235,.10);
  --model: #0d7a45;
  --model-soft: rgba(13,122,69,.10);
  --good: #0d7a45;
  --good-bg: rgba(13,122,69,.10);
  --caution: #9a6700;
  --caution-bg: rgba(154,103,0,.12);
  --critical: #c42b2b;
  --critical-bg: rgba(196,43,43,.10);
  --shadow: 0 1px 2px rgba(20,20,19,.04), 0 8px 24px rgba(20,20,19,.05);
  --radius: 14px;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --sans: "Segoe UI", system-ui, -apple-system, sans-serif;
  --btn-on-ink: #fffcf7;
  --fill-engine: linear-gradient(90deg, var(--engine), color-mix(in srgb, var(--engine) 60%, #8ec5ff));
  --fill-model: linear-gradient(90deg, var(--model), color-mix(in srgb, var(--model) 55%, #8dffc4));
  --fill-caution: linear-gradient(90deg, #c98a00, #e0b000);
  --fill-critical: linear-gradient(90deg, #b42318, #e04a3f);
  --glow: none;
  --panel-glow: none;
}
[data-theme="dark"] {
  color-scheme: dark;
  --page: #0c0c0b;
  --page-2: #141412;
  --surface: #161614;
  --surface-2: #1c1c19;
  --ink: #f4f3ee;
  --ink-2: #c8c6bb;
  --muted: #8e8c83;
  --line: rgba(255,255,255,.09);
  --line-strong: rgba(255,255,255,.14);
  --track: #2a2a26;
  --engine: #6cb0ff;
  --engine-soft: rgba(108,176,255,.12);
  --model: #3ecf8e;
  --model-soft: rgba(62,207,142,.12);
  --good: #3ecf8e;
  --good-bg: rgba(62,207,142,.12);
  --caution: #f0b429;
  --caution-bg: rgba(240,180,41,.12);
  --critical: #f07167;
  --critical-bg: rgba(240,113,103,.12);
  --shadow: 0 1px 2px rgba(0,0,0,.3), 0 10px 28px rgba(0,0,0,.28);
  --btn-on-ink: #111;
  --fill-engine: linear-gradient(90deg, var(--engine), color-mix(in srgb, var(--engine) 60%, #8ec5ff));
  --fill-model: linear-gradient(90deg, var(--model), color-mix(in srgb, var(--model) 55%, #8dffc4));
  --fill-caution: linear-gradient(90deg, #c98a00, #e0b000);
  --fill-critical: linear-gradient(90deg, #b42318, #e04a3f);
  --glow: none;
  --panel-glow: none;
}
/* Cyber HUD — neon cyan / magenta on deep navy (colors/fonts only) */
[data-theme="cyber"] {
  color-scheme: dark;
  --page: #050a12;
  --page-2: #07101c;
  --surface: #0a1422;
  --surface-2: #0d1a2c;
  --ink: #e8f7ff;
  --ink-2: #9ec9e0;
  --muted: #5f8aa3;
  --line: rgba(0,229,255,.14);
  --line-strong: rgba(0,229,255,.28);
  --track: #122033;
  --engine: #00e5ff;
  --engine-soft: rgba(0,229,255,.12);
  --model: #ff2bd6;
  --model-soft: rgba(255,43,214,.12);
  --good: #39ff14;
  --good-bg: rgba(57,255,20,.12);
  --caution: #ffe566;
  --caution-bg: rgba(255,229,102,.12);
  --critical: #ff4d6d;
  --critical-bg: rgba(255,77,109,.14);
  --shadow: 0 0 0 1px rgba(0,229,255,.08), 0 8px 32px rgba(0,0,0,.45);
  --radius: 10px;
  --mono: "SF Mono", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace;
  --sans: "SF Mono", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace;
  --btn-on-ink: #050a12;
  --fill-engine: linear-gradient(90deg, #00e5ff, #39ff14);
  --fill-model: linear-gradient(90deg, #ff2bd6, #00e5ff);
  --fill-caution: linear-gradient(90deg, #c98a00, #ffe566);
  --fill-critical: linear-gradient(90deg, #ff2bd6, #ff4d6d);
  --glow: 0 0 18px rgba(0,229,255,.35);
  --panel-glow: 0 0 24px rgba(0,229,255,.08);
}
* { box-sizing: border-box; margin: 0; }
html { scroll-behavior: smooth; }
body {
  font: 15px/1.5 var(--sans);
  background:
    radial-gradient(1200px 500px at 10% -10%, var(--engine-soft), transparent 55%),
    radial-gradient(900px 420px at 90% 0%, var(--model-soft), transparent 50%),
    var(--page);
  color: var(--ink);
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--engine); text-decoration: none; }
a:hover { text-decoration: underline; }
.wrap { max-width: 1080px; margin: 0 auto; padding: 28px 18px 72px; }

/* header */
.top {
  display: flex; flex-wrap: wrap; gap: 14px 24px;
  justify-content: space-between; align-items: flex-start;
  margin-bottom: 22px;
}
.top > div:first-child { min-width: 0; flex: 1 1 220px; }
.top .nav-links {
  flex: 0 0 auto;
  margin-left: auto;
  justify-content: flex-end;
}
.brand {
  font-size: 12px; font-weight: 700; letter-spacing: .12em;
  text-transform: uppercase; color: var(--muted);
}
.top h1 {
  font-size: clamp(1.45rem, 2.6vw, 1.85rem);
  font-weight: 750; letter-spacing: -0.02em; line-height: 1.2;
  margin-top: 4px; max-width: 28ch;
}
.meta { color: var(--muted); font-size: 13px; margin-top: 6px; }
.meta span + span::before { content: "·"; margin: 0 0.45em; color: var(--line-strong); }
.nav-links { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.nav-links a.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 12px; border-radius: 999px;
  border: 1px solid var(--line-strong); background: var(--surface);
  color: var(--ink-2); font-size: 13px; font-weight: 600;
  text-decoration: none; box-shadow: var(--shadow);
}
.nav-links a.btn:hover { border-color: var(--engine); color: var(--ink); text-decoration: none; }
.nav-links a.btn.primary { background: var(--ink); color: var(--btn-on-ink); border-color: transparent; }

/* theme switcher */
.theme-switch {
  display: inline-flex; align-items: center; gap: 6px;
  margin-left: 2px;
}
.theme-switch label {
  font-size: 11px; font-weight: 700; letter-spacing: .08em;
  text-transform: uppercase; color: var(--muted);
}
.theme-switch select {
  font: inherit; font-size: 13px; font-weight: 650;
  border: 1px solid var(--line-strong); background: var(--surface);
  color: var(--ink); border-radius: 999px; padding: 7px 12px;
  box-shadow: var(--shadow); cursor: pointer;
}
.theme-switch select:focus-visible {
  outline: 2px solid var(--engine); outline-offset: 2px;
}

/* overview strip */
.overview-label {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: 12px; margin: 8px 0 10px;
}
.overview-label h2 {
  font-size: 11px; letter-spacing: .14em; text-transform: uppercase;
  color: var(--muted); font-weight: 700;
}
.overview-label p { color: var(--muted); font-size: 12.5px; }

.hero {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}
@media (max-width: 820px) { .hero { grid-template-columns: 1fr; } }

.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 18px 18px 16px;
  min-width: 0;
  position: relative;
  overflow: hidden;
}
.card::before {
  content: "";
  position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
  background: var(--accent, var(--line-strong));
}
.card.engine { --accent: var(--engine); }
.card.model { --accent: var(--model); }
.card.neutral { --accent: var(--muted); }

.card-kicker {
  font-size: 11px; font-weight: 750; letter-spacing: .1em;
  text-transform: uppercase; color: var(--muted);
}
.card-value {
  font-size: clamp(2.1rem, 4vw, 2.65rem);
  font-weight: 780; letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  line-height: 1.05; margin-top: 6px;
}
.card-value.good { color: var(--good); }
.card-value.caution { color: var(--caution); }
.card-value.critical { color: var(--critical); }
.card-sub {
  color: var(--ink-2); font-size: 13.5px; margin-top: 6px;
  display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center;
}
.card-note { color: var(--muted); font-size: 12.5px; margin-top: 8px; line-height: 1.4; }
.badge {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px; font-weight: 700; padding: 2px 9px;
  border-radius: 999px; border: 1px solid var(--line);
  background: var(--surface-2); color: var(--ink-2);
}
.badge.good { color: var(--good); background: var(--good-bg); border-color: transparent; }
.badge.caution { color: var(--caution); background: var(--caution-bg); border-color: transparent; }
.badge.critical { color: var(--critical); background: var(--critical-bg); border-color: transparent; }

.mini-tiers { display: grid; gap: 7px; margin-top: 12px; }
.mini-tier {
  display: grid; grid-template-columns: 64px 1fr 44px;
  gap: 8px; align-items: center; font-size: 12px;
}
.mini-tier .name { color: var(--muted); font-weight: 600; }
.mini-tier .n { text-align: right; font-variant-numeric: tabular-nums; color: var(--ink-2); font-weight: 650; }
.track {
  height: 8px; background: var(--track); border-radius: 999px; overflow: hidden;
}
.fill {
  display: block; height: 100%; border-radius: 999px;
  background: var(--fill-engine);
  min-width: 0;
  box-shadow: var(--glow);
}
.fill.model { background: var(--fill-model); }
.fill.caution { background: var(--fill-caution); }
.fill.critical { background: var(--fill-critical); }

.secondary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 28px;
}
@media (max-width: 820px) { .secondary { grid-template-columns: 1fr; } }
.sec-card {
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  border: 1px dashed var(--line-strong);
  border-radius: 12px;
  padding: 14px 16px;
}
.sec-card .card-kicker { margin-bottom: 2px; }
.sec-card .card-value { font-size: 1.55rem; margin-top: 2px; }
.sec-card .card-note { margin-top: 4px; }
.outcome-lines { display: grid; gap: 5px; margin-top: 10px; }
.outcome-line {
  display: flex; justify-content: space-between; gap: 10px;
  font-size: 13px; font-variant-numeric: tabular-nums;
}
.outcome-line .ol-label { color: var(--ink-2); }
.outcome-line .ol-n { font-weight: 750; color: var(--ink); }
.outcome-line.muted .ol-label, .outcome-line.muted .ol-n { color: var(--muted); }
.outcome-line.critical .ol-n { color: var(--critical); }
.outcome-line.caution .ol-n { color: var(--caution); }
.outcome-line.good .ol-n { color: var(--good); }

/* interactive expand / filter */
.tier-block { border-top: 1px solid var(--line); }
.tier-block:first-of-type { border-top: 0; }
.tier-toggle, .cat-toggle, .task-toggle, .fid-toggle {
  width: 100%; border: 0; background: transparent; color: inherit;
  font: inherit; text-align: left; cursor: pointer; padding: 0;
}
.tier-toggle:hover .row-label,
.cat-toggle:hover .row-label,
.task-toggle:hover .name,
.fid-toggle:hover .row-label { color: var(--engine); }
.tier-toggle:focus-visible,
.cat-toggle:focus-visible,
.task-toggle:focus-visible,
.fid-toggle:focus-visible,
.surface:focus-visible,
.filter-chip:focus-visible {
  outline: 2px solid var(--engine); outline-offset: 2px; border-radius: 6px;
}
.chev {
  display: inline-flex; align-items: center; justify-content: center;
  width: 1.15em; color: var(--engine); font-weight: 800;
  font-size: 16px; line-height: 1; margin-right: 8px;
  transition: transform .15s; vertical-align: -1px;
  opacity: 0.9;
}
.tier-toggle:hover .chev,
.cat-toggle:hover .chev,
.fid-toggle:hover .chev { opacity: 1; color: var(--engine); }
[aria-expanded="true"] .chev { transform: rotate(90deg); }
.expand-panel {
  display: none; padding: 4px 0 12px;
  border-top: 1px dashed var(--line);
  margin-top: 2px;
}
.expand-panel.open { display: block; }
.expand-panel[hidden] { display: none !important; }
.drill-table {
  width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 8px;
}
.drill-table th {
  text-align: left; color: var(--muted); font-weight: 600;
  padding: 6px 8px 6px 0; border-bottom: 1px solid var(--line);
  font-size: 11px; letter-spacing: .05em; text-transform: uppercase;
}
.drill-table td {
  padding: 7px 8px 7px 0; border-bottom: 1px solid var(--line);
  vertical-align: top; color: var(--ink-2);
}
.drill-table tr:last-child td { border-bottom: 0; }
.drill-table td:first-child { color: var(--ink); font-weight: 600; }
.status-pill {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; font-weight: 750; padding: 2px 8px;
  border-radius: 999px; white-space: nowrap;
}
.status-pill.pass, .status-pill.supported { color: var(--good); background: var(--good-bg); }
.status-pill.fail, .status-pill.unsupported { color: var(--critical); background: var(--critical-bg); }
.status-pill.inconclusive, .status-pill.skipped, .status-pill.partial {
  color: var(--caution); background: var(--caution-bg);
}
.status-pill.not-probed { color: var(--muted); background: var(--surface-2); border: 1px solid var(--line); }
.hint-click { color: var(--muted); font-size: 12px; margin: 0 0 10px; }
.surface {
  border: 1px solid var(--line); border-radius: 10px;
  padding: 10px 12px; background: var(--surface-2);
  cursor: pointer; transition: border-color .12s, box-shadow .12s, background .12s;
  text-align: left; width: 100%; font: inherit; color: inherit;
}
.surface:hover { border-color: var(--engine); }
.surface.active {
  /* Keep fill as-is; selection is a glowing perimeter only */
  background: var(--surface-2);
  border-color: var(--engine);
  box-shadow:
    0 0 0 2px var(--engine),
    0 0 0 4px color-mix(in srgb, var(--engine) 28%, transparent),
    0 0 18px color-mix(in srgb, var(--engine) 45%, transparent);
}
.surface .n { font-size: 1.25rem; font-weight: 750; font-variant-numeric: tabular-nums; }
.surface .l { color: var(--muted); font-size: 12px; margin-top: 2px; text-transform: capitalize; }
.surface .r { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.filter-bar {
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
  margin: 14px 0 10px;
}
.filter-bar .label {
  font-size: 12px; font-weight: 700; letter-spacing: .06em;
  text-transform: uppercase; color: var(--muted); margin-right: 2px;
}
.filter-chip {
  border: 1px solid var(--line); background: var(--surface-2);
  color: var(--ink-2); border-radius: 999px; padding: 5px 11px;
  font-size: 12.5px; font-weight: 650; cursor: pointer; font: inherit;
}
.filter-chip:hover { border-color: var(--engine); color: var(--ink); }
.filter-chip.active {
  background: var(--ink); color: var(--btn-on-ink); border-color: transparent;
}
.filter-meta { color: var(--muted); font-size: 12.5px; margin-left: auto; }
.conf-table-wrap {
  max-height: 480px; overflow: auto; border: 1px solid var(--line);
  border-radius: 10px; margin-top: 4px;
}
.conf-table-wrap .drill-table { margin: 0; }
.conf-table-wrap th {
  position: sticky; top: 0; background: var(--surface); z-index: 1;
  padding: 8px 10px;
}
.conf-table-wrap td { padding: 8px 10px; }
.conf-table-wrap tr.fail-row td:first-child { color: var(--critical); }
.empty-filter { padding: 16px; color: var(--muted); font-size: 13.5px; }
.expand-note {
  color: var(--muted); font-size: 12.5px; margin-top: 8px;
  padding: 8px 10px; background: var(--surface-2); border-radius: 8px;
  border: 1px solid var(--line);
}
.step-list { display: grid; gap: 8px; margin-top: 8px; }
.step-item {
  border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px;
  background: var(--surface-2); font-size: 13px;
}
.step-item .step-h { font-weight: 700; color: var(--ink); margin-bottom: 2px; }
.step-item .step-b { color: var(--ink-2); white-space: pre-wrap; overflow-wrap: anywhere; }
.cat-block + .cat-block { border-top: 1px solid var(--line); }
.task-block + .task-block { border-top: 1px solid var(--line); }
.fid-block + .fid-block { border-top: 1px solid var(--line); padding-top: 4px; }

/* story sections */
.story { display: grid; gap: 14px; }
.section {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 20px 22px;
}
.section-head {
  display: flex; flex-wrap: wrap; gap: 8px 16px;
  justify-content: space-between; align-items: baseline;
  margin-bottom: 14px; padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}
.section-head h2 {
  font-size: 13px; letter-spacing: .1em; text-transform: uppercase;
  font-weight: 750; color: var(--ink-2);
}
.section-head h2 .tag {
  display: inline-block; margin-left: 8px; font-size: 10px;
  letter-spacing: .08em; padding: 2px 7px; border-radius: 999px;
  vertical-align: 1px;
}
.section-head h2 .tag.engine { background: var(--engine-soft); color: var(--engine); }
.section-head h2 .tag.model { background: var(--model-soft); color: var(--model); }
.section-head .score {
  font-size: 1.35rem; font-weight: 750;
  font-variant-numeric: tabular-nums; letter-spacing: -0.02em;
}
.section-head .score.good { color: var(--good); }
.section-head .score.caution { color: var(--caution); }
.section-head .score.critical { color: var(--critical); }
.lede { color: var(--muted); font-size: 13px; margin: -6px 0 14px; }

.row {
  display: grid;
  grid-template-columns: minmax(100px, 140px) 72px 52px 1fr;
  gap: 10px; align-items: center;
  padding: 7px 0;
}
.row + .row { border-top: 1px solid var(--line); }
.row-label { font-weight: 600; color: var(--ink); }
.row-ratio { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 13px; }
.row-pct {
  text-align: right; font-variant-numeric: tabular-nums;
  font-weight: 700; font-size: 13px; color: var(--ink-2);
}
.row-pct.good { color: var(--good); }
.row-pct.critical { color: var(--critical); }
.row-pct.caution { color: var(--caution); }
.missing {
  color: var(--critical); font-size: 13px; margin: 2px 0 6px 0;
  padding-left: 0; line-height: 1.45;
}
.missing span { margin-right: 12px; white-space: nowrap; }
.fine { color: var(--muted); font-size: 12.5px; margin: 2px 0 6px; }

.surface-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px; margin-top: 4px;
}

.fail-table {
  width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px;
}
.fail-table th {
  text-align: left; color: var(--muted); font-weight: 600;
  padding: 6px 10px 6px 0; border-bottom: 1px solid var(--line);
  font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
}
.fail-table td {
  padding: 8px 10px 8px 0; border-bottom: 1px solid var(--line);
  vertical-align: top; color: var(--ink-2);
}
.fail-table td:first-child { color: var(--ink); font-weight: 600; }
.fail-table tr:last-child td { border-bottom: 0; }

.taxonomy {
  display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 4px;
}
.tax {
  font-size: 12.5px; padding: 5px 10px; border-radius: 999px;
  border: 1px solid var(--line); color: var(--ink-2); background: var(--surface-2);
}
.tax strong { font-variant-numeric: tabular-nums; }

.cat-row {
  display: grid;
  grid-template-columns: minmax(140px, 200px) 64px 48px 1fr;
  gap: 10px; align-items: center; padding: 6px 0;
}
.cat-row + .cat-row { border-top: 1px solid var(--line); }
.floor-mark {
  position: relative;
}
.floor-mark::after {
  content: "";
  position: absolute; left: 50%; top: -3px; bottom: -3px; width: 1.5px;
  background: color-mix(in srgb, var(--caution) 70%, transparent);
  opacity: .7;
}

.task {
  display: grid; grid-template-columns: 28px 1fr auto;
  gap: 10px; align-items: start; padding: 10px 0;
}
.task + .task { border-top: 1px solid var(--line); }
.task .icon {
  width: 28px; height: 28px; border-radius: 50%;
  display: grid; place-items: center; font-weight: 800; font-size: 14px;
}
.task .icon.ok { background: var(--good-bg); color: var(--good); }
.task .icon.bad { background: var(--critical-bg); color: var(--critical); }
.task .name { font-weight: 650; }
.task .steps { color: var(--muted); font-size: 12.5px; font-variant-numeric: tabular-nums; }
.task .detail { color: var(--critical); font-size: 13px; margin-top: 4px; grid-column: 2 / -1; }
.chip {
  display: inline-block; font-size: 11px; font-weight: 700;
  padding: 2px 8px; border-radius: 999px; margin-left: 6px;
  background: var(--caution-bg); color: var(--caution); vertical-align: 1px;
}

details.more { margin-top: 10px; }
details.more summary {
  cursor: pointer; color: var(--muted); font-size: 13px; font-weight: 600;
  list-style: none;
}
details.more summary::-webkit-details-marker { display: none; }
details.more summary::before { content: "▸ "; }
details.more[open] summary::before { content: "▾ "; }

footer.page {
  margin-top: 28px; color: var(--muted); font-size: 12.5px;
  display: flex; flex-wrap: wrap; gap: 6px 14px;
}
footer.page .sep { opacity: .4; }

/* compare */
.compare-hero {
  display: grid;
  grid-template-columns: 180px repeat(var(--n, 2), minmax(0, 1fr));
  gap: 0; margin-bottom: 18px;
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden;
}
@media (max-width: 720px) {
  .compare-hero { display: block; }
  .compare-hero .cell { border-right: 0; }
}
.compare-hero .cell {
  padding: 14px 16px; border-right: 1px solid var(--line);
  border-bottom: 1px solid var(--line); min-width: 0;
}
.compare-hero .cell:last-child { border-right: 0; }
.compare-hero .metric {
  font-size: 12px; font-weight: 700; letter-spacing: .06em;
  text-transform: uppercase; color: var(--muted);
  display: flex; align-items: center;
}
.compare-hero .run-head {
  font-weight: 750; font-size: 14px; line-height: 1.3;
}
.compare-hero .run-head .sub { color: var(--muted); font-size: 12px; font-weight: 500; margin-top: 2px; }
.compare-hero .big {
  font-size: 1.8rem; font-weight: 780; font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em; line-height: 1.1;
}
.compare-hero .big.best { color: var(--good); }
.compare-hero .big.worst { color: var(--critical); }
.compare-hero .hint { color: var(--muted); font-size: 12px; margin-top: 4px; }
.swatch {
  display: inline-block; width: 9px; height: 9px; border-radius: 2px;
  margin-right: 6px; vertical-align: 1px;
}
.narrative {
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--radius); padding: 16px 18px; margin-bottom: 18px;
  box-shadow: var(--shadow);
}
.narrative h2 {
  font-size: 11px; letter-spacing: .12em; text-transform: uppercase;
  color: var(--muted); margin-bottom: 8px;
}
.narrative .lead { font-weight: 700; margin-bottom: 8px; }
.narrative ul { padding-left: 1.15rem; color: var(--ink-2); }
.narrative li { margin: 4px 0; }

.hub-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 14px; margin-top: 18px;
}
.hub-card {
  display: block; background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--radius); padding: 18px; box-shadow: var(--shadow);
  color: inherit; text-decoration: none; transition: border-color .15s, transform .15s;
}
.hub-card:hover { border-color: var(--engine); transform: translateY(-1px); text-decoration: none; }
.hub-card h3 { font-size: 1.1rem; font-weight: 750; margin-bottom: 6px; }
.hub-card p { color: var(--muted); font-size: 13.5px; }
.hub-stats {
  display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px;
}
.hub-stats span {
  font-size: 12px; font-weight: 700; padding: 4px 9px; border-radius: 999px;
  background: var(--surface-2); border: 1px solid var(--line);
  font-variant-numeric: tabular-nums;
}

/* library ranking table */
.library-toolbar {
  display: flex; flex-wrap: wrap; gap: 10px 16px;
  align-items: center; justify-content: space-between;
  margin: 8px 0 12px;
}
.library-toolbar .sort-ctrl {
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
}
.library-toolbar label {
  font-size: 12px; font-weight: 700; letter-spacing: .06em;
  text-transform: uppercase; color: var(--muted);
}
.library-toolbar select {
  font: inherit; font-size: 13.5px; font-weight: 600;
  border: 1px solid var(--line-strong); background: var(--surface);
  color: var(--ink); border-radius: 8px; padding: 7px 10px;
  box-shadow: var(--shadow);
}
.library-count { color: var(--muted); font-size: 13px; }
.visually-hidden {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}
.library-search {
  position: relative;
  flex: 1 1 220px;
  min-width: min(100%, 220px);
  max-width: 360px;
}
.library-search input {
  width: 100%;
  font: inherit; font-size: 14px; font-weight: 500;
  border: 1px solid var(--line-strong); background: var(--surface);
  color: var(--ink); border-radius: 10px;
  padding: 9px 36px 9px 12px;
  box-shadow: var(--shadow);
}
.library-search input::placeholder { color: var(--muted); }
.library-search input:focus {
  outline: 2px solid var(--engine); outline-offset: 1px;
  border-color: var(--engine);
}
.library-search .search-clear {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  border: 0; background: transparent; color: var(--muted);
  cursor: pointer; font-size: 16px; line-height: 1; padding: 4px 6px;
  display: none;
}
.library-search .search-clear.visible { display: block; }
.library-search .search-clear:hover { color: var(--critical); }
.rank-wrap {
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--radius); box-shadow: var(--shadow);
  overflow: auto; margin-bottom: 20px;
}
.rank-table {
  width: 100%; border-collapse: collapse; font-size: 13.5px;
  min-width: 860px;
}
.rank-table th {
  text-align: left; padding: 12px 12px;
  font-size: 11px; letter-spacing: .07em; text-transform: uppercase;
  color: var(--muted); font-weight: 700;
  border-bottom: 1px solid var(--line);
  background: var(--surface-2); white-space: nowrap;
  position: sticky; top: 0; z-index: 1;
  cursor: pointer; user-select: none;
}
.rank-table th:hover { color: var(--ink); }
.rank-table th .sort-ind { opacity: .35; margin-left: 4px; font-size: 10px; }
.rank-table th.active .sort-ind { opacity: 1; color: var(--engine); }
.rank-table td {
  padding: 12px; border-bottom: 1px solid var(--line);
  vertical-align: middle; color: var(--ink-2);
}
.rank-table tr:last-child td { border-bottom: 0; }
.rank-table tr:hover td { background: color-mix(in srgb, var(--engine-soft) 55%, transparent); }
.rank-table tr.selected td {
  background: var(--engine-soft);
}
.rank-num {
  font-weight: 780; font-variant-numeric: tabular-nums;
  color: var(--muted); width: 36px;
}
.rank-model {
  font-weight: 750; color: var(--ink); line-height: 1.25;
}
.rank-model .sub {
  display: block; font-weight: 500; font-size: 12px; color: var(--muted);
  margin-top: 2px;
}
.tier-stack {
  display: inline-flex; align-items: center; gap: 4px;
  font-variant-numeric: tabular-nums; font-weight: 750; font-size: 12.5px;
  font-family: var(--mono);
}
.tier-stack .t {
  padding: 2px 6px; border-radius: 6px; min-width: 3.2em; text-align: center;
}
.tier-stack .sep { color: var(--muted); opacity: .5; }
.tier-stack .t.good { color: var(--good); background: var(--good-bg); }
.tier-stack .t.caution { color: var(--caution); background: var(--caution-bg); }
.tier-stack .t.critical { color: var(--critical); background: var(--critical-bg); }
.tier-stack .t.neutral { color: var(--muted); background: var(--surface-2); }
.metric-cell {
  font-weight: 750; font-variant-numeric: tabular-nums; font-size: 14px;
}
.metric-cell.good { color: var(--good); }
.metric-cell.caution { color: var(--caution); }
.metric-cell.critical { color: var(--critical); }
.metric-cell .verdict {
  display: block; font-size: 11px; font-weight: 650; color: var(--muted);
  text-transform: none; margin-top: 1px;
}
.row-actions {
  display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end;
}
.row-actions .btn-sm {
  font: inherit; font-size: 12.5px; font-weight: 700;
  border-radius: 999px; padding: 6px 11px; cursor: pointer;
  border: 1px solid var(--line-strong); background: var(--surface);
  color: var(--ink-2); text-decoration: none; display: inline-flex;
}
.row-actions .btn-sm:hover { border-color: var(--engine); color: var(--ink); text-decoration: none; }
.row-actions .btn-sm.view {
  background: var(--ink); color: var(--btn-on-ink); border-color: transparent;
}
.row-actions .btn-sm.compare-add.active {
  background: var(--engine); color: #fff; border-color: transparent;
}
.row-actions .btn-sm:disabled {
  opacity: .4; cursor: not-allowed;
}

/* floating compare dock */
.compare-dock {
  position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%);
  z-index: 50; width: min(560px, calc(100vw - 24px));
  background: var(--surface); border: 1px solid var(--line-strong);
  border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,.18);
  padding: 14px 16px; display: none;
}
.compare-dock.visible { display: block; animation: dock-in .18s ease-out; }
@keyframes dock-in {
  from { opacity: 0; transform: translateX(-50%) translateY(10px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}
.compare-dock h3 {
  font-size: 11px; letter-spacing: .1em; text-transform: uppercase;
  color: var(--muted); font-weight: 750; margin-bottom: 8px;
}
.compare-dock .picks {
  display: grid; gap: 6px; margin-bottom: 12px;
}
.compare-dock .pick {
  display: flex; justify-content: space-between; align-items: center;
  gap: 10px; padding: 8px 10px; border-radius: 10px;
  background: var(--surface-2); border: 1px solid var(--line);
  font-weight: 650; font-size: 13.5px;
}
.compare-dock .pick .rm {
  border: 0; background: transparent; color: var(--muted);
  cursor: pointer; font-size: 16px; line-height: 1; padding: 2px 6px;
}
.compare-dock .pick .rm:hover { color: var(--critical); }
.compare-dock .empty-slot {
  color: var(--muted); font-size: 13px; font-style: italic; padding: 6px 2px;
}
.compare-dock .dock-actions {
  display: flex; gap: 8px; justify-content: flex-end; align-items: center;
}
.compare-dock .dock-actions .btn {
  font: inherit; font-size: 13px; font-weight: 700;
  border-radius: 999px; padding: 8px 14px; cursor: pointer;
  border: 1px solid var(--line-strong); background: var(--surface-2);
  color: var(--ink-2);
}
.compare-dock .dock-actions .btn.primary {
  background: var(--ink); color: var(--btn-on-ink); border-color: transparent;
}
.compare-dock .dock-actions .btn.primary:disabled {
  opacity: .4; cursor: not-allowed;
}
body.has-dock { padding-bottom: 110px; }

/* Cyber-only polish (colors / type / glow — no layout changes) */
[data-theme="cyber"] body {
  background:
    radial-gradient(900px 420px at 8% -5%, rgba(0,229,255,.10), transparent 55%),
    radial-gradient(800px 380px at 92% 0%, rgba(255,43,214,.08), transparent 50%),
    linear-gradient(180deg, #050a12 0%, #07101c 100%);
  letter-spacing: 0.01em;
}
[data-theme="cyber"] .brand {
  color: var(--engine); letter-spacing: .16em; text-shadow: 0 0 12px rgba(0,229,255,.35);
}
[data-theme="cyber"] .top h1 {
  letter-spacing: .04em; text-transform: uppercase;
  text-shadow: 0 0 20px rgba(0,229,255,.25);
  font-size: clamp(1.25rem, 2.4vw, 1.65rem);
}
[data-theme="cyber"] .card,
[data-theme="cyber"] .section,
[data-theme="cyber"] .rank-wrap,
[data-theme="cyber"] .narrative,
[data-theme="cyber"] .compare-hero,
[data-theme="cyber"] .compare-dock,
[data-theme="cyber"] .sec-card {
  box-shadow: var(--panel-glow);
  border-color: var(--line-strong);
}
[data-theme="cyber"] .card-value {
  text-shadow: 0 0 22px rgba(0,229,255,.35);
  font-family: var(--mono);
}
[data-theme="cyber"] .card-kicker,
[data-theme="cyber"] .section-head h2,
[data-theme="cyber"] .overview-label h2 {
  letter-spacing: .14em; color: var(--model);
}
[data-theme="cyber"] .section-head h2 .tag.engine { color: var(--engine); background: var(--engine-soft); }
[data-theme="cyber"] .section-head h2 .tag.model { color: var(--model); background: var(--model-soft); }
[data-theme="cyber"] .score { text-shadow: 0 0 16px rgba(0,229,255,.3); font-family: var(--mono); }
[data-theme="cyber"] .metric-cell,
[data-theme="cyber"] .rank-num,
[data-theme="cyber"] .tier-stack { font-family: var(--mono); }
[data-theme="cyber"] .filter-chip.active {
  background: var(--engine); color: var(--btn-on-ink); border-color: transparent;
  box-shadow: 0 0 16px rgba(0,229,255,.35);
}
[data-theme="cyber"] .surface.active {
  background: var(--surface-2);
  color: inherit;
  border-color: var(--engine);
  box-shadow:
    0 0 0 2px var(--engine),
    0 0 0 4px rgba(0,229,255,.25),
    0 0 22px rgba(0,229,255,.55);
}
[data-theme="cyber"] .chev { color: var(--engine); text-shadow: 0 0 8px rgba(0,229,255,.5); }
[data-theme="cyber"] .nav-links a.btn.primary {
  background: var(--engine); color: var(--btn-on-ink);
  box-shadow: 0 0 16px rgba(0,229,255,.3);
}
[data-theme="cyber"] .theme-switch select {
  border-color: var(--line-strong); color: var(--engine);
  font-family: var(--mono); letter-spacing: .04em; text-transform: uppercase;
  font-size: 11px;
}
`;

/** Early FOUC guard + dropdown wiring (localStorage). */
const THEME_BOOT = `(function(){try{var t=localStorage.getItem("llmprobe-theme");if(t==="dark"||t==="cyber"||t==="light")document.documentElement.setAttribute("data-theme",t);else document.documentElement.setAttribute("data-theme","light");}catch(e){document.documentElement.setAttribute("data-theme","light");}})();`;

const THEME_SCRIPT = `
(function () {
  var KEY = "llmprobe-theme";
  var root = document.documentElement;
  function apply(theme) {
    if (theme !== "dark" && theme !== "cyber") theme = "light";
    root.setAttribute("data-theme", theme);
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    document.querySelectorAll("[data-theme-select]").forEach(function (el) {
      el.value = theme;
    });
  }
  var current = root.getAttribute("data-theme") || "light";
  apply(current);
  document.querySelectorAll("[data-theme-select]").forEach(function (el) {
    el.addEventListener("change", function () { apply(el.value); });
  });
})();
`;

function themeSwitcherHtml() {
  return `<div class="theme-switch">
    <label for="theme-select">Theme</label>
    <select id="theme-select" data-theme-select aria-label="Color theme">
      <option value="light">Light</option>
      <option value="dark">Dark</option>
      <option value="cyber">Cyber</option>
    </select>
  </div>`;
}

function htmlShellStart(title) {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<script>${THEME_BOOT}</script>
<style>${STYLE}</style>
</head>
<body>`;
}

function htmlShellEnd(...extraScripts) {
  const extras = extraScripts.filter(Boolean).join("\n");
  return `${extras}
<script>${THEME_SCRIPT}</script>
</body>
</html>`;
}

// ── bar helpers ──────────────────────────────────────────────────────────────

function barFill(p, kind = "engine") {
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

function embedJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function statusPill(outcome) {
  const map = {
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

function coverageStatus(entry) {
  if (entry.probed === false) return "not-probed";
  if (entry.supported) return "supported";
  return "missing";
}

function tierBlocks(report) {
  const entries = report.coverage?.entries ?? [];
  return (report.coverage?.byTier ?? [])
    .map((t) => {
      const tone = toneForPct(t.pct);
      const tierEntries = entries.filter((e) => e.tier === t.tier);
      // Prefer full entry list; fall back to missing/unprobed labels
      let rows = "";
      if (tierEntries.length > 0) {
        rows = tierEntries
          .slice()
          .sort((a, b) => {
            const rank = (e) =>
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
        t.unprobed?.length > 0
          ? `<div class="fine">not probed: ${t.unprobed.map(esc).join(", ")}</div>`
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

function miniTiers(report) {
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

/** Flatten conformance results into assertion-level rows for the filter table. */
function confTableRows(report) {
  const rows = [];
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

const REPORT_SCRIPT = `
(function () {
  const data = window.__LLMPROBE__;
  if (!data) return;

  function setExpanded(btn, panel, open) {
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    panel.hidden = !open;
    panel.classList.toggle("open", open);
  }

  // Generic expand toggles
  document.querySelectorAll("[data-expand]").forEach((btn) => {
    const id = btn.getAttribute("data-expand");
    const panel = document.getElementById(id);
    if (!panel) return;
    btn.addEventListener("click", () => {
      const open = btn.getAttribute("aria-expanded") !== "true";
      setExpanded(btn, panel, open);
    });
  });

  // Tier expand (coverage)
  document.querySelectorAll(".tier-toggle").forEach((btn) => {
    const panel = document.getElementById(btn.getAttribute("aria-controls"));
    if (!panel) return;
    btn.addEventListener("click", () => {
      const open = btn.getAttribute("aria-expanded") !== "true";
      setExpanded(btn, panel, open);
    });
  });

  // Conformance filter table
  const tbody = document.getElementById("conf-tbody");
  const countEl = document.getElementById("conf-filter-count");
  const rows = data.confRows || [];
  let outcomeFilter = "fail"; // default: failures
  let surfaceFilter = "";

  function escHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function pill(status) {
    const cls = ["pass","fail","unsupported","inconclusive","skipped"].includes(status)
      ? status : "not-probed";
    return '<span class="status-pill ' + cls + '">' + escHtml(status) + '</span>';
  }

  function matches(row) {
    if (surfaceFilter && row.surface !== surfaceFilter) return false;
    if (outcomeFilter === "all") return true;
    if (outcomeFilter === "fail") return row.status === "fail" || row.outcome === "fail";
    return row.outcome === outcomeFilter || row.status === outcomeFilter;
  }

  function renderConf() {
    if (!tbody) return;
    const filtered = rows.filter(matches);
    if (countEl) {
      countEl.textContent = filtered.length + " of " + rows.length + " rows";
    }
    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5"><div class="empty-filter">No checks match this filter.</div></td></tr>';
      return;
    }
    tbody.innerHTML = filtered.map((row) => {
      const failCls = row.status === "fail" ? " class=\\"fail-row\\"" : "";
      return "<tr" + failCls + ">" +
        "<td>" + escHtml(row.test) + "</td>" +
        "<td>" + escHtml(row.surface) + "</td>" +
        "<td>" + escHtml(row.assertion) + (row.severity ? ' <span class="fine">(' + escHtml(row.severity) + ")</span>" : "") + "</td>" +
        "<td>" + escHtml(row.evidence || "—") + "</td>" +
        "<td>" + pill(row.status) + "</td>" +
        "</tr>";
    }).join("");
  }

  document.querySelectorAll("[data-outcome-filter]").forEach((chip) => {
    chip.addEventListener("click", () => {
      outcomeFilter = chip.getAttribute("data-outcome-filter");
      document.querySelectorAll("[data-outcome-filter]").forEach((c) =>
        c.classList.toggle("active", c === chip),
      );
      renderConf();
    });
  });

  document.querySelectorAll("[data-surface-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const surface = btn.getAttribute("data-surface-filter");
      if (surfaceFilter === surface) {
        surfaceFilter = "";
        btn.classList.remove("active");
      } else {
        surfaceFilter = surface;
        document.querySelectorAll("[data-surface-filter]").forEach((b) =>
          b.classList.toggle("active", b === btn),
        );
      }
      // When picking a surface, default outcome to all so the surface isn't empty of fails
      if (surfaceFilter) {
        outcomeFilter = "all";
        document.querySelectorAll("[data-outcome-filter]").forEach((c) =>
          c.classList.toggle("active", c.getAttribute("data-outcome-filter") === "all"),
        );
      }
      renderConf();
      const table = document.getElementById("conf-table");
      if (table) table.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });

  const clearSurface = document.getElementById("clear-surface-filter");
  if (clearSurface) {
    clearSurface.addEventListener("click", () => {
      surfaceFilter = "";
      document.querySelectorAll("[data-surface-filter]").forEach((b) => b.classList.remove("active"));
      renderConf();
    });
  }

  renderConf();
})();
`;

// ── single-run report ────────────────────────────────────────────────────────

function renderReport(report, { label } = {}) {
  const model = report.target?.model ?? "unknown";
  const engine = report.target?.engine ?? null;
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

  const covTone = toneForPct(core?.pct);
  const confTone = confMeasured ? toneForPct(conf.pct, { perfect: true }) : "neutral";
  // Conformance under 100 is always a problem for engines
  const confToneStrict =
    confMeasured && conf.pct < 100 ? "critical" : confTone;
  const capTone = capMeasured ? verdictTone(cap.verdict) : "neutral";

  const coreHeadline = core ? `${core.pct}%` : "—";
  const confHeadline = confMeasured ? `${conf.pct}%` : "—";
  const capHeadline = capMeasured ? `${cap.pct}%` : "—";

  // Keep chrome minimal: Library + Theme only (model list would get noisy).
  const nav = `<a class="btn" href="index.html">← Library</a>`;

  const credits = (report.coverage?.credits ?? [])
    .map(
      (c) =>
        `<div class="fine">○ ${esc(c.label)} — detected, not scored</div>`,
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
          return aFail - bFail || (a.name || a.id).localeCompare(b.name || b.id);
        });
      const evalRows =
        catEvals.length > 0
          ? catEvals
              .map((e) => {
                const ok = e.passed >= e.total;
                const fails = (e.failures ?? [])
                  .map((f) => esc(typeof f === "string" ? f : f.message || f))
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
      ? `<div class="fine">⚠ never measured: ${cap.unmeasured.map((c) => esc(catLabel(c))).join(", ")} — not treated as pass</div>`
      : "";

  const tasks = agentic
    ? agentic.tasks
        .map((t) => {
          const icon = t.passed
            ? `<span class="icon ok">✓</span>`
            : `<span class="icon bad">✗</span>`;
          const chip =
            !t.passed && t.failure
              ? `<span class="chip">${esc(t.failure)}</span>`
              : "";
          const gloss =
            !t.passed && t.failure && AGENTIC_FAILURE_GLOSS[t.failure]
              ? AGENTIC_FAILURE_GLOSS[t.failure]
              : null;
          const detail = !t.passed
            ? `<div class="detail">→ ${esc([gloss, t.detail].filter(Boolean).join(" — ") || "failed")}</div>`
            : "";
          return `<div class="task">
            ${icon}
            <div>
              <div class="name">${esc(t.name)}${chip}</div>
            </div>
            <div class="steps">${t.steps} steps</div>
            ${detail}
          </div>`;
        })
        .join("")
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
          const checks = [];
          checks.push(`<tr><td>Measured</td><td>${s.measured ? statusPill("pass") : statusPill("unsupported")}</td><td>${esc(s.measured ? "included in fidelity headline" : "excluded from denominator (not zeroed)")}</td></tr>`);
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
  const boot = {
    confRows,
  };

  const footerBits = [
    report.usage
      ? `${fmtTokens(report.usage.inputTokens + report.usage.outputTokens)} tokens (${fmtTokens(report.usage.inputTokens)} in · ${fmtTokens(report.usage.outputTokens)} out)`
      : null,
    fmtDuration(report.durationMs),
    label ? `file: ${label}` : null,
  ].filter(Boolean);

  const outcomeHonesty = `<div class="outcome-lines">
    <div class="outcome-line good"><span class="ol-label">Pass</span><span class="ol-n">${outcomes.pass}</span></div>
    <div class="outcome-line critical"><span class="ol-label">Fail</span><span class="ol-n">${outcomes.fail}</span></div>
    <div class="outcome-line critical"><span class="ol-label">Unsupported</span><span class="ol-n">${outcomes.unsupported}</span></div>
    <div class="outcome-line caution"><span class="ol-label">Inconclusive</span><span class="ol-n">${outcomes.inconclusive}</span></div>
    <div class="outcome-line muted"><span class="ol-label">Skipped</span><span class="ol-n">${outcomes.skipped}</span></div>
  </div>
  <div class="card-note">Unsupported and inconclusive are not zeros and not fails.</div>`;

  return `${htmlShellStart(`llmprobe · ${shortModel(model)}`)}
<div class="wrap">
  <header class="top">
    <div>
      <div class="brand">llmprobe report card</div>
      <h1>${esc(model)}</h1>
      <div class="meta">
        ${engine ? `<span>${esc(engine)}</span>` : ""}
        ${baseUrl ? `<span>${esc(baseUrl)}</span>` : ""}
      </div>
    </div>
    <nav class="nav-links" aria-label="Reports">${nav}${themeSwitcherHtml()}</nav>
  </header>

  <div class="overview-label">
    <h2>Overview</h2>
    <p>Three independent scores — never averaged</p>
  </div>
  <div class="hero" aria-label="Primary scores">
    <article class="card engine">
      <div class="card-kicker">Surface coverage</div>
      <div class="card-value ${covTone}">${esc(coreHeadline)}</div>
      <div class="card-sub">
        <span>Core ${core ? `${core.supported}/${core.total}` : "—"}</span>
        ${core?.missing?.length ? `<span class="badge critical">${core.missing.length} core gap${core.missing.length > 1 ? "s" : ""}</span>` : `<span class="badge good">core complete</span>`}
      </div>
      ${miniTiers(report)}
      <div class="card-note">How much of the standard API surface exists. Missing features are listed on purpose.</div>
    </article>

    <article class="card engine">
      <div class="card-kicker">Engine conformance</div>
      <div class="card-value ${confToneStrict}">${esc(confHeadline)}</div>
      <div class="card-sub">
        ${confMeasured ? `<span>${conf.passed}/${conf.total} MUST</span>` : `<span>not measured</span>`}
        ${must.length ? `<span class="badge critical">${must.length} violation${must.length > 1 ? "s" : ""}</span>` : confMeasured ? `<span class="badge good">no MUST fails</span>` : ""}
      </div>
      <div class="card-note">Of the surfaces that exist, how correct are the MUST behaviors. Unsupported ≠ fail.</div>
    </article>

    <article class="card model">
      <div class="card-kicker">Model capability</div>
      <div class="card-value ${capTone}">${esc(capHeadline)}</div>
      <div class="card-sub">
        ${capMeasured ? `<span class="badge ${capTone}">${esc(cap.verdict)}</span>` : `<span>not measured</span>`}
        ${capMeasured ? `<span>${cap.categories.length} categories</span>` : ""}
      </div>
      <div class="card-note">Practical floor for tools, JSON, instructions — graded below floor / capable / strong.</div>
    </article>
  </div>

  <div class="secondary" aria-label="Secondary signals">
    <div class="sec-card">
      <div class="card-kicker">Agentic</div>
      <div class="card-value ${agentic ? (agentic.passed === agentic.total ? "good" : agentic.passed === 0 ? "critical" : "caution") : ""}">${agentic ? `${agentic.passed}/${agentic.total}` : "—"}</div>
      <div class="card-note">Harder multi-step bar. Never blended into capability.</div>
    </div>
    <div class="sec-card">
      <div class="card-kicker">Engine fidelity</div>
      <div class="card-value ${fidelity ? toneForPct(fidelity.pct) : ""}">${fidelity ? `${fidelity.pct}%` : "—"}</div>
      <div class="card-note">Same-model only — holds the model constant so the number is the engine.</div>
    </div>
    <div class="sec-card">
      <div class="card-kicker">Outcomes honesty</div>
      ${outcomeHonesty}
    </div>
  </div>

  <div class="story">
    <section class="section" id="coverage">
      <div class="section-head">
        <h2>Surface coverage <span class="tag engine">engine</span></h2>
        <div class="score ${covTone}">Core ${esc(coreHeadline)}</div>
      </div>
      <p class="lede">Per tier, never averaged. Click Core / Extended / Frontier to expand every feature under that tier.</p>
      <p class="hint-click">Click a tier row to expand · missing features sort first</p>
      ${tierBlocks(report)}
      ${credits}
    </section>

    <section class="section" id="conformance">
      <div class="section-head">
        <h2>Engine conformance <span class="tag engine">engine</span></h2>
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
    </section>

    <section class="section" id="capability">
      <div class="section-head">
        <h2>Model capability <span class="tag model">model</span></h2>
        <div class="score ${capTone}">${capMeasured ? `${esc(capHeadline)} · ${esc(cap.verdict)}` : "—"}</div>
      </div>
      <p class="lede">Floor check — not an intelligence rank. Category floor is ${CATEGORY_FLOOR_PCT}%. Click a category to expand its evals (failures first).</p>
      <p class="hint-click">Click a category row to expand evals</p>
      ${capMeasured ? cats : `<p class="fine">Capability not measured.</p>`}
      ${weakNote}${unmeasNote}
    </section>

    <section class="section" id="agentic">
      <div class="section-head">
        <h2>Agentic <span class="tag model">model</span></h2>
        <div class="score ${agentic ? (agentic.passed === agentic.total ? "good" : "caution") : ""}">${agentic ? `${agentic.passed}/${agentic.total} tasks` : "—"}</div>
      </div>
      <p class="lede">Multi-step tool use in a simulated workspace — harder than the capability floor, never blended into it.</p>
      ${tasks}
    </section>

    <section class="section" id="fidelity">
      <div class="section-head">
        <h2>Engine fidelity <span class="tag engine">engine</span></h2>
        <div class="score ${fidelity ? toneForPct(fidelity.pct) : ""}">${fidelity ? `${fidelity.pct}%` : "—"}</div>
      </div>
      <p class="lede">Same-model comparisons only. Click a slice to see what was measured. Unmeasured slices are named — never zeroed.</p>
      ${fidSlices}
      ${
        fidelity?.unmeasured?.length
          ? `<div class="fine">· ${fidelity.unmeasured.map(esc).join(", ")} not measured</div>`
          : ""
      }
    </section>
  </div>

  <footer class="page">
    ${footerBits.map((b) => `<span>${esc(b)}</span>`).join('<span class="sep">·</span>')}
    <span>Scores stay independent — never averaged</span>
  </footer>
</div>
${htmlShellEnd(
  `<script>window.__LLMPROBE__=${embedJson(boot)};</script>`,
  `<script>${REPORT_SCRIPT}</script>`,
)}`;
}

// ── compare page (interactive model pickers) ─────────────────────────────────

const SERIES = ["#1f6feb", "#0d7a45", "#c98a00", "#9b59b6", "#e05a3c"];

/** Compact per-run payload for client-side compare. */
function compareEntry(run) {
  const r = run.report;
  const core = tier(r, "core");
  const ext = tier(r, "extended");
  const front = tier(r, "frontier");
  const confMeasured = (r.conformance?.total ?? 0) > 0;
  const capMeasured = (r.capability?.categories?.length ?? 0) > 0;
  return {
    slug: run.slug,
    href: run.href,
    short: shortModel(r.target?.model ?? run.label),
    model: r.target?.model ?? run.label,
    engine: r.target?.engine ?? null,
    baseUrl: r.target?.baseUrl ?? null,
    core: core?.pct ?? null,
    extended: ext?.pct ?? null,
    frontier: front?.pct ?? null,
    missing: {
      core: core?.missing ?? [],
      extended: ext?.missing ?? [],
      frontier: front?.missing ?? [],
    },
    conformance: confMeasured ? r.conformance.pct : null,
    confPassed: confMeasured ? r.conformance.passed : null,
    confTotal: confMeasured ? r.conformance.total : null,
    bySurface: (r.conformance?.bySurface ?? []).map((s) => ({
      surface: s.surface,
      pct: s.pct,
      passed: s.passed,
      total: s.total,
    })),
    capability: capMeasured ? r.capability.pct : null,
    verdict: capMeasured ? r.capability.verdict : null,
    categories: (r.capability?.categories ?? []).map((c) => ({
      category: c.category,
      label: catLabel(c.category),
      pct: c.pct,
    })),
    agenticPassed: r.agentic?.passed ?? null,
    agenticTotal: r.agentic?.total ?? null,
    fidelity: r.fidelity?.pct ?? null,
    mustViolations: mustFailures(r).length,
  };
}

/**
 * Interactive compare: columns start empty; each column has a model dropdown.
 * Optional URL ?a=slug&b=slug prefills (from library dock).
 */
function renderCompareWorkbench(runs) {
  const catalog = runs.map(compareEntry);
  const categoryLabels = { ...CATEGORY_LABELS };

  const compareScript = `
(function () {
  const catalog = window.__COMPARE__;
  const CAT_LABELS = window.__CAT_LABELS__ || {};
  const SERIES = ${embedJson(SERIES)};
  if (!catalog || !catalog.length) return;

  const root = document.getElementById("compare-root");
  const pickersEl = document.getElementById("compare-pickers");
  const stickyEl = document.getElementById("compare-sticky");
  const stickyInner = document.getElementById("compare-sticky-inner");
  const titleEl = document.getElementById("compare-title");
  const metaEl = document.getElementById("compare-meta");
  const narrativeEl = document.getElementById("compare-narrative");
  let selected = ["", ""]; // slugs for col 0 and 1
  let stickyBound = false;

  function bySlug(slug) {
    return catalog.find((r) => r.slug === slug) || null;
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function readPrefill() {
    const params = new URLSearchParams(location.search);
    const a = params.get("a") || "";
    const b = params.get("b") || "";
    if (a && bySlug(a)) selected[0] = a;
    if (b && bySlug(b)) selected[1] = b;
    // avoid same model twice from bad URL
    if (selected[0] && selected[0] === selected[1]) selected[1] = "";
  }

  function writeUrl() {
    const params = new URLSearchParams();
    if (selected[0]) params.set("a", selected[0]);
    if (selected[1]) params.set("b", selected[1]);
    const q = params.toString();
    const next = location.pathname + (q ? "?" + q : "") + location.hash;
    history.replaceState(null, "", next);
  }

  function rankClass(vals, i, higher) {
    const present = vals.filter((v) => v != null && !Number.isNaN(v));
    if (present.length < 2 || vals[i] == null) return "";
    const best = higher ? Math.max.apply(null, present) : Math.min.apply(null, present);
    const worst = higher ? Math.min.apply(null, present) : Math.max.apply(null, present);
    if (best === worst) return "";
    if (vals[i] === best) return "best";
    if (vals[i] === worst) return "worst";
    return "";
  }

  function optionsHtml(col) {
    const other = selected[col === 0 ? 1 : 0];
    return (
      '<option value="">' + (col === 0 ? "Select model A…" : "Select model B…") + "</option>" +
      catalog
        .map((r) => {
          const disabled = other && r.slug === other ? " disabled" : "";
          const sel = r.slug === selected[col] ? " selected" : "";
          return (
            '<option value="' +
            esc(r.slug) +
            '"' +
            sel +
            disabled +
            ">" +
            esc(r.short || r.model) +
            "</option>"
          );
        })
        .join("")
    );
  }

  function pickerCard(col) {
    const row = bySlug(selected[col]);
    const color = SERIES[col % SERIES.length];
    const link =
      row && row.href
        ? '<a class="open-report" href="' + esc(row.href) + '">open report →</a>'
        : '<span class="open-report muted-slot">open report →</span>';
    const sub = row
      ? esc(row.engine || row.baseUrl || "")
      : "Choose a model to load scores";
    return (
      '<div class="picker-card" data-col="' +
      col +
      '">' +
      '<div class="picker-card-top">' +
      '<span class="swatch" style="background:' +
      color +
      '"></span>' +
      '<label class="picker-label" for="cmp-pick-' +
      col +
      '">Model ' +
      (col === 0 ? "A" : "B") +
      "</label>" +
      "</div>" +
      '<select class="model-picker" id="cmp-pick-' +
      col +
      '" data-col="' +
      col +
      '">' +
      optionsHtml(col) +
      "</select>" +
      '<div class="picker-sub">' +
      sub +
      "</div>" +
      link +
      "</div>"
    );
  }

  function stickyLabel(col) {
    const row = bySlug(selected[col]);
    const color = SERIES[col % SERIES.length];
    const name = row ? row.short || row.model : "—";
    return (
      '<div class="sticky-col">' +
      '<span class="swatch" style="background:' +
      color +
      '"></span>' +
      '<span class="sticky-name">' +
      esc(name) +
      "</span>" +
      "</div>"
    );
  }

  function bindPickers() {
    if (!pickersEl) return;
    pickersEl.querySelectorAll(".model-picker").forEach((sel) => {
      sel.addEventListener("change", () => {
        const col = Number(sel.getAttribute("data-col"));
        selected[col] = sel.value || "";
        if (selected[0] && selected[0] === selected[1]) {
          selected[col === 0 ? 1 : 0] = "";
        }
        writeUrl();
        render();
      });
    });
  }

  function bindStickyObserver() {
    if (stickyBound || !pickersEl || !stickyEl) return;
    stickyBound = true;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        // Show freeze header once the picker block leaves the top of the viewport
        const show = e && e.boundingClientRect.bottom < 8;
        stickyEl.classList.toggle("visible", !!show);
        stickyEl.setAttribute("aria-hidden", show ? "false" : "true");
      },
      { root: null, threshold: [0, 0.01, 1], rootMargin: "0px" },
    );
    io.observe(pickersEl);
  }

  function cellBig(rows, vals, i, higher, textFn) {
    if (!rows[i]) {
      return '<div class="cell"><div class="big blank-cell">—</div></div>';
    }
    const cls = rankClass(vals, i, higher);
    const text = textFn(vals[i], rows[i]);
    return (
      '<div class="cell"><div class="big ' +
      cls +
      '">' +
      text +
      "</div></div>"
    );
  }

  function row(label, vals, higher, textFn) {
    const rows = selected.map((slug) => bySlug(slug));
    const cells = [0, 1]
      .map((i) => cellBig(rows, vals, i, higher, textFn))
      .join("");
    return '<div class="cell metric">' + esc(label) + "</div>" + cells;
  }

  function pctText(v) {
    return v == null ? "—" : v + "%";
  }

  function buildNarrative(a, b) {
    if (!a || !b) {
      return {
        lead: "Pick two models to compare.",
        lines: [
          "Each column starts empty — choose a model from the dropdown above that column.",
          "Scores stay independent: Coverage, Conformance, and Capability are never averaged.",
        ],
      };
    }
    const lines = [];
    const delta = (label, x, y, unit) => {
      if (x == null || y == null) return;
      if (x === y) {
        lines.push(label + " tied at " + x + (unit || "%") + ".");
        return;
      }
      const d = Math.round((y - x) * 10) / 10;
      const sign = d > 0 ? "+" : "";
      lines.push(
        label +
          " " +
          x +
          (unit || "%") +
          " → " +
          y +
          (unit || "%") +
          " (" +
          sign +
          d +
          (unit === "" ? "" : "pp") +
          ") · " +
          a.short +
          " → " +
          b.short +
          ".",
      );
    };
    delta("Coverage core", a.core, b.core);
    delta("Coverage extended", a.extended, b.extended);
    delta("Coverage frontier", a.frontier, b.frontier);
    delta("Conformance", a.conformance, b.conformance);
    if (a.capability != null && b.capability != null) {
      if (a.verdict === b.verdict && a.capability === b.capability) {
        lines.push("Capability stayed " + a.verdict + " at " + a.capability + "%.");
      } else if (a.verdict === b.verdict) {
        delta("Capability (" + a.verdict + ")", a.capability, b.capability);
      } else {
        lines.push(
          "Capability " +
            a.verdict +
            " " +
            a.capability +
            "% → " +
            b.verdict +
            " " +
            b.capability +
            "% · " +
            a.short +
            " → " +
            b.short +
            ".",
        );
      }
    }
    if (a.agenticPassed != null && b.agenticPassed != null) {
      if (
        a.agenticPassed !== b.agenticPassed ||
        a.agenticTotal !== b.agenticTotal
      ) {
        lines.push(
          "Agentic " +
            a.agenticPassed +
            "/" +
            a.agenticTotal +
            " → " +
            b.agenticPassed +
            "/" +
            b.agenticTotal +
            ".",
        );
      }
    }
    if (a.mustViolations !== b.mustViolations) {
      lines.push(
        "MUST violations " + a.mustViolations + " → " + b.mustViolations + ".",
      );
    }
    if (!lines.length) {
      lines.push("No measured score deltas between these two runs.");
    }
    const sameModel = a.model === b.model;
    const sameEngine =
      (a.engine || a.baseUrl || "") === (b.engine || b.baseUrl || "");
    let lead = "Mixed models and engines";
    if (sameModel && !sameEngine) lead = "Same model, different engines";
    else if (!sameModel && sameEngine) lead = "Same engine, different models";
    else if (sameModel && sameEngine)
      lead = "Same model and engine — treat as before/after or depth change";
    return { lead, lines };
  }

  function render() {
    const a = bySlug(selected[0]);
    const b = bySlug(selected[1]);

    if (titleEl) {
      titleEl.textContent =
        a && b
          ? (a.short || a.model) + " vs " + (b.short || b.model)
          : a
            ? (a.short || a.model) + " vs …"
            : b
              ? "… vs " + (b.short || b.model)
              : "Compare models";
    }
    if (metaEl) {
      const bits = [];
      if (a && b) bits.push("2 models selected");
      else if (a || b) bits.push("1 of 2 models selected");
      else bits.push("Select models in each column");
      bits.push(catalog.length + " in library");
      metaEl.innerHTML = bits.map((t) => "<span>" + esc(t) + "</span>").join("");
    }

    const narr = buildNarrative(a, b);
    if (narrativeEl) {
      narrativeEl.innerHTML =
        "<h2>What changed</h2>" +
        '<p class="lead">' +
        esc(narr.lead) +
        "</p>" +
        "<ul>" +
        narr.lines.map((l) => "<li>" + esc(l) + "</li>").join("") +
        "</ul>";
    }

    // Pickers once at the top
    if (pickersEl) {
      pickersEl.innerHTML = pickerCard(0) + pickerCard(1);
      bindPickers();
      bindStickyObserver();
    }
    // Freeze-row labels (spreadsheet-style sticky header)
    if (stickyInner) {
      stickyInner.innerHTML =
        '<div class="sticky-metric"></div>' + stickyLabel(0) + stickyLabel(1);
    }

    const rowsA = [a, b];
    const coreVals = rowsA.map((r) => (r ? r.core : null));
    const confVals = rowsA.map((r) => (r ? r.conformance : null));
    const capVals = rowsA.map((r) => (r ? r.capability : null));
    const agentVals = rowsA.map((r) =>
      r && r.agenticTotal != null
        ? r.agenticPassed / Math.max(1, r.agenticTotal)
        : null,
    );
    const fidVals = rowsA.map((r) => (r ? r.fidelity : null));
    const mustVals = rowsA.map((r) => (r ? r.mustViolations : null));

    let html = "";

    html +=
      '<div class="overview-label"><h2>Primary scores</h2><p>Scores stay independent — never averaged</p></div>';
    html +=
      '<div class="compare-hero" style="--n:2">' +
      row("Coverage (Core)", coreVals, true, pctText) +
      row("Conformance", confVals, true, pctText) +
      row("Capability", capVals, true, (v, r) =>
        v == null
          ? "—"
          : v + "%" + (r && r.verdict ? ' <span class="hint">' + esc(r.verdict) + "</span>" : ""),
      ) +
      row("Agentic", agentVals, true, (v, r) =>
        r && r.agenticTotal != null
          ? r.agenticPassed + "/" + r.agenticTotal
          : "—",
      ) +
      row("Fidelity", fidVals, true, pctText) +
      row("MUST violations", mustVals, false, (v) =>
        v == null ? "—" : String(v),
      ) +
      "</div>";

    html +=
      '<div class="overview-label"><h2>Coverage detail</h2><p>Core · Extended · Frontier</p></div>';
    html +=
      '<div class="compare-hero" style="--n:2">' +
      row("Coverage · core", rowsA.map((r) => (r ? r.core : null)), true, pctText) +
      row(
        "Coverage · extended",
        rowsA.map((r) => (r ? r.extended : null)),
        true,
        pctText,
      ) +
      row(
        "Coverage · frontier",
        rowsA.map((r) => (r ? r.frontier : null)),
        true,
        pctText,
      );

    ["core", "extended", "frontier"].forEach((t) => {
      const cells = rowsA
        .map((r) => {
          if (!r) {
            return '<div class="cell"><div class="hint blank-cell">—</div></div>';
          }
          const miss = (r.missing && r.missing[t]) || [];
          return (
            '<div class="cell"><div class="hint" style="color:var(--ink-2)">' +
            (miss.length
              ? miss.map((m) => "✗ " + esc(m)).join("<br>")
              : '<span style="color:var(--good)">none</span>') +
            "</div></div>"
          );
        })
        .join("");
      html +=
        '<div class="cell metric">Missing · ' + esc(t) + "</div>" + cells;
    });
    html += "</div>";

    // categories
    const catIds = [];
    rowsA.forEach((r) => {
      if (!r) return;
      (r.categories || []).forEach((c) => {
        if (!catIds.includes(c.category)) catIds.push(c.category);
      });
    });
    html +=
      '<div class="overview-label"><h2>Capability categories</h2><p>Side-by-side floor check</p></div>';
    html += '<div class="compare-hero" style="--n:2">';
    if (!catIds.length) {
      html +=
        '<div class="cell metric">Categories</div>' +
        '<div class="cell"><span class="hint blank-cell">—</span></div>' +
        '<div class="cell"><span class="hint blank-cell">—</span></div>';
    } else {
      catIds.forEach((cat) => {
        const vals = rowsA.map((r) => {
          if (!r) return null;
          const hit = (r.categories || []).find((c) => c.category === cat);
          return hit ? hit.pct : null;
        });
        const label =
          (rowsA.find((r) => r && (r.categories || []).some((c) => c.category === cat))
            ?.categories || []
          ).find((c) => c.category === cat)?.label ||
          CAT_LABELS[cat] ||
          cat;
        html += row(label, vals, true, pctText);
      });
    }
    html += "</div>";

    // surfaces
    const surfaces = [];
    rowsA.forEach((r) => {
      if (!r) return;
      (r.bySurface || []).forEach((s) => {
        if (!surfaces.includes(s.surface)) surfaces.push(s.surface);
      });
    });
    html +=
      '<div class="overview-label"><h2>Conformance by surface</h2></div>';
    html += '<div class="compare-hero" style="--n:2">';
    if (!surfaces.length) {
      html +=
        '<div class="cell metric">Surfaces</div>' +
        '<div class="cell"><span class="hint blank-cell">—</span></div>' +
        '<div class="cell"><span class="hint blank-cell">—</span></div>';
    } else {
      surfaces.forEach((surface) => {
        const vals = rowsA.map((r) => {
          if (!r) return null;
          const hit = (r.bySurface || []).find((s) => s.surface === surface);
          return hit ? hit.pct : null;
        });
        html += row(surface, vals, true, pctText);
      });
    }
    html += "</div>";

    root.innerHTML = html;
  }

  readPrefill();
  render();
})();
`;

  // CSS bits for pickers + freeze header
  const pickerStyle = `
/* Align with score tables: metric spacer | col A | col B */
.compare-pickers {
  display: grid;
  grid-template-columns: 180px 1fr 1fr;
  gap: 0;
  margin: 0 0 20px;
  align-items: stretch;
}
.compare-pickers::before {
  content: "";
  /* empty metric column so pickers sit over their data columns */
}
.picker-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 14px 16px;
  min-width: 0;
  margin-left: 6px;
}
.picker-card:last-child { margin-right: 0; }
@media (max-width: 720px) {
  .compare-pickers {
    grid-template-columns: 72px 1fr 1fr;
  }
  .picker-card { padding: 10px 10px; margin-left: 4px; }
}
.picker-card-top {
  display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
}
.model-picker {
  display: block; width: 100%; max-width: 100%;
  margin: 6px 0 6px;
  font: inherit; font-size: 14px; font-weight: 700;
  border: 1px solid var(--line-strong); background: var(--surface-2);
  color: var(--ink); border-radius: 8px; padding: 9px 10px;
  box-shadow: var(--shadow); cursor: pointer;
}
.model-picker:focus-visible {
  outline: 2px solid var(--engine); outline-offset: 1px;
}
.picker-label {
  font-size: 11px; font-weight: 750;
  letter-spacing: .08em; text-transform: uppercase;
  color: var(--muted);
}
.picker-sub {
  color: var(--muted); font-size: 12.5px; margin-bottom: 6px;
  overflow-wrap: anywhere;
}
.open-report {
  font-size: 13px; font-weight: 650; color: var(--engine);
  text-decoration: none;
}
.open-report:hover { text-decoration: underline; }
.open-report.muted-slot { opacity: .35; pointer-events: none; color: var(--muted); }
.blank-cell { color: var(--muted) !important; font-weight: 500 !important; opacity: .75; }

/* Spreadsheet-style freeze row once pickers scroll away */
.compare-sticky {
  position: fixed; left: 0; right: 0; top: 0; z-index: 40;
  display: none;
  padding: 0 18px;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--line-strong);
  box-shadow: 0 8px 24px rgba(0,0,0,.08);
}
.compare-sticky.visible { display: block; }
.compare-sticky-inner {
  max-width: 1080px; margin: 0 auto;
  display: grid;
  grid-template-columns: 180px 1fr 1fr;
  gap: 0;
  align-items: center;
  min-height: 48px;
}
.sticky-metric { /* spacer aligned with metric column */ }
.sticky-col {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; min-width: 0;
  font-weight: 750; font-size: 13.5px;
  border-left: 1px solid var(--line);
}
.sticky-name {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
@media (max-width: 720px) {
  .compare-sticky-inner { grid-template-columns: 72px 1fr 1fr; }
  .sticky-col { font-size: 12px; padding: 8px 6px; }
}
body.has-sticky-pad { /* reserved if needed */ }
`;

  return `${htmlShellStart("llmprobe · compare models")}
<style>${pickerStyle}</style>
<div class="wrap">
  <header class="top">
    <div>
      <div class="brand">llmprobe compare</div>
      <h1 id="compare-title">Compare models</h1>
      <div class="meta" id="compare-meta">
        <span>Select models in each column</span>
        <span>${catalog.length} in library</span>
      </div>
    </div>
    <nav class="nav-links" aria-label="Compare navigation">
      <a class="btn" href="index.html">← Library</a>
      ${themeSwitcherHtml()}
    </nav>
  </header>

  <div class="narrative" id="compare-narrative">
    <h2>What changed</h2>
    <p class="lead">Pick two models to compare.</p>
    <ul>
      <li>Choose models once at the top — columns stay aligned as you scroll.</li>
      <li>Scores stay independent: Coverage, Conformance, and Capability are never averaged.</li>
    </ul>
  </div>

  <div id="compare-pickers" class="compare-pickers" aria-label="Model pickers"></div>

  <div id="compare-sticky" class="compare-sticky" aria-hidden="true">
    <div id="compare-sticky-inner" class="compare-sticky-inner"></div>
  </div>

  <div id="compare-root"></div>

  <footer class="page">
    <span>Best/worst marked green/red per row only when both columns have a model</span>
    <span class="sep">·</span>
    <span>Never a blended overall score</span>
  </footer>
</div>
${htmlShellEnd(
  `<script>window.__COMPARE__=${embedJson(catalog)};window.__CAT_LABELS__=${embedJson(categoryLabels)};</script>`,
  `<script>${compareScript}</script>`,
)}`;
}

/** @deprecated pair pages — workbench is the compare UI */
function renderCompare(inputs) {
  // Adapt legacy {label, report, href} inputs into workbench runs shape
  const runs = inputs.map((i, idx) => ({
    slug: slug(i.report?.target?.model || i.label || `run-${idx + 1}`),
    label: i.label,
    report: i.report,
    href: i.href || `${slug(i.report?.target?.model || i.label)}.html`,
    src: i.path || i.href || "",
  }));
  // disambiguate slugs
  const seen = new Map();
  for (const r of runs) {
    const n = (seen.get(r.slug) ?? 0) + 1;
    seen.set(r.slug, n);
    if (n > 1) r.slug = `${r.slug}-${n}`;
  }
  return renderCompareWorkbench(runs);
}

// ── library discovery + hub ──────────────────────────────────────────────────

function isJsonReport(obj) {
  return (
    obj &&
    typeof obj === "object" &&
    obj.target &&
    (obj.target.model || obj.target.baseUrl) &&
    obj.coverage &&
    Array.isArray(obj.coverage.byTier)
  );
}

/**
 * Load valid llmprobe --save reports.
 * @param {{ paths?: string[], scanRunsDir?: boolean }} opts
 */
function discoverRunFiles(opts = {}) {
  const { paths = [], scanRunsDir = true } = opts;
  const runsDir = join(__dirname, "..");
  const found = new Map(); // abs path -> true

  const consider = (abs) => {
    const resolved = resolve(abs);
    if (!existsSync(resolved) || !statSync(resolved).isFile()) return;
    if (extname(resolved).toLowerCase() !== ".json") return;
    found.set(resolved, true);
  };

  if (scanRunsDir) {
    try {
      for (const name of readdirSync(runsDir)) {
        if (!name.endsWith(".json")) continue;
        // Only top-level runs/*.json — not report-card artifacts or nested skins
        consider(join(runsDir, name));
      }
    } catch {
      /* ignore */
    }
  }

  for (const p of paths) consider(p);

  if (found.size === 0 && scanRunsDir) {
    for (const p of [DEFAULTS.laguna, DEFAULTS.qwen]) consider(p);
  }

  const runs = [];
  const usedSlugs = new Map();

  for (const abs of [...found.keys()].sort()) {
    let report;
    try {
      report = JSON.parse(readFileSync(abs, "utf8"));
    } catch {
      continue;
    }
    if (!isJsonReport(report)) continue;

    let s = slug(report.target?.model || basename(abs, ".json"));
    const n = (usedSlugs.get(s) ?? 0) + 1;
    usedSlugs.set(s, n);
    if (n > 1) s = `${s}-${n}`;

    runs.push({
      slug: s,
      label: shortModel(report.target?.model) || s,
      report,
      href: `${s}.html`,
      src: abs,
    });
  }

  return runs;
}

function pairHref(slugA, slugB) {
  const [a, b] = [slugA, slugB].sort();
  return `compare-${a}-vs-${b}.html`;
}

function pctToneClass(n) {
  if (n == null || Number.isNaN(n)) return "neutral";
  if (n >= 90) return "good";
  if (n >= 70) return "caution";
  return "critical";
}

function runSummary(run) {
  const r = run.report;
  const core = tier(r, "core");
  const ext = tier(r, "extended");
  const front = tier(r, "frontier");
  const confMeasured = (r.conformance?.total ?? 0) > 0;
  const capMeasured = (r.capability?.categories?.length ?? 0) > 0;
  return {
    slug: run.slug,
    href: run.href,
    model: r.target?.model ?? run.label,
    short: shortModel(r.target?.model ?? run.label),
    engine: r.target?.engine ?? null,
    baseUrl: r.target?.baseUrl ?? null,
    source: basename(run.src),
    core: core?.pct ?? null,
    extended: ext?.pct ?? null,
    frontier: front?.pct ?? null,
    conformance: confMeasured ? r.conformance.pct : null,
    capability: capMeasured ? r.capability.pct : null,
    verdict: capMeasured ? r.capability.verdict : null,
    agenticPassed: r.agentic?.passed ?? null,
    agenticTotal: r.agentic?.total ?? null,
    agenticRatio:
      r.agentic && r.agentic.total > 0
        ? r.agentic.passed / r.agentic.total
        : null,
    fidelity: r.fidelity?.pct ?? null,
  };
}

function renderHub(runs) {
  const catalog = runs.map(runSummary);

  const libraryScript = `
(function () {
  const catalog = window.__LIBRARY__;
  if (!catalog || !catalog.length) return;

  const tbody = document.getElementById("rank-body");
  const sortSelect = document.getElementById("sort-key");
  const dirSelect = document.getElementById("sort-dir");
  const countEl = document.getElementById("library-count");
  const filterMeta = document.getElementById("filter-meta");
  const searchInput = document.getElementById("model-search");
  const searchClear = document.getElementById("search-clear");
  const dock = document.getElementById("compare-dock");
  const picksEl = document.getElementById("compare-picks");
  const goBtn = document.getElementById("compare-go");
  const clearBtn = document.getElementById("compare-clear");

  let sortKey = "capability";
  let sortDir = "desc";
  let query = "";
  /** @type {string[]} */
  let selected = [];

  const tone = (n) => {
    if (n == null || Number.isNaN(n)) return "neutral";
    if (n >= 90) return "good";
    if (n >= 70) return "caution";
    return "critical";
  };

  const pairHref = (a, b) => {
    return "compare.html?a=" + encodeURIComponent(a) + "&b=" + encodeURIComponent(b);
  };

  function haystack(row) {
    return [
      row.short,
      row.model,
      row.engine,
      row.baseUrl,
      row.source,
      row.slug,
      row.verdict,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function matchesQuery(row, q) {
    if (!q) return true;
    const h = haystack(row);
    // space-separated tokens all must match (typeahead-friendly)
    return q
      .toLowerCase()
      .trim()
      .split(/\\s+/)
      .filter(Boolean)
      .every((tok) => h.includes(tok));
  }

  function valueOf(row, key) {
    switch (key) {
      case "model": return (row.short || row.model || "").toLowerCase();
      case "core": return row.core;
      case "extended": return row.extended;
      case "frontier": return row.frontier;
      case "coverage": {
        // Rank by core first, then extended, then frontier — not a blended display score
        const c = row.core ?? -1;
        const e = row.extended ?? -1;
        const f = row.frontier ?? -1;
        return c * 1e6 + e * 1e3 + f;
      }
      case "conformance": return row.conformance;
      case "capability": return row.capability;
      case "agentic": return row.agenticRatio;
      case "fidelity": return row.fidelity;
      default: return row.capability;
    }
  }

  function filtered() {
    return catalog.filter((row) => matchesQuery(row, query));
  }

  function sorted() {
    const rows = filtered();
    rows.sort((a, b) => {
      const av = valueOf(a, sortKey);
      const bv = valueOf(b, sortKey);
      const aNull = av == null || Number.isNaN(av);
      const bNull = bv == null || Number.isNaN(bv);
      if (aNull && bNull) return (a.short || "").localeCompare(b.short || "");
      if (aNull) return 1;
      if (bNull) return -1;
      if (typeof av === "string" || typeof bv === "string") {
        const cmp = String(av).localeCompare(String(bv));
        return sortDir === "asc" ? cmp : -cmp;
      }
      if (av === bv) return (a.short || "").localeCompare(b.short || "");
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return rows;
  }

  function fmtPct(n) {
    return n == null ? "—" : n + "%";
  }

  function tierCell(row) {
    const parts = [
      ["core", row.core],
      ["extended", row.extended],
      ["frontier", row.frontier],
    ];
    return '<span class="tier-stack" title="Core | Extended | Frontier">' +
      parts.map((p, i) => {
        const t = tone(p[1]);
        const bit = '<span class="t ' + t + '">' + fmtPct(p[1]) + "</span>";
        return i ? '<span class="sep">|</span>' + bit : bit;
      }).join("") +
      "</span>";
  }

  function renderTable() {
    const rows = sorted();
    const total = catalog.length;
    if (countEl) {
      countEl.textContent =
        rows.length === total
          ? total + " model" + (total === 1 ? "" : "s")
          : rows.length + " of " + total + " model" + (total === 1 ? "" : "s");
    }
    if (filterMeta) {
      filterMeta.textContent = query.trim()
        ? "Filtered by “" + query.trim() + "” · click headers to sort · select up to 2 to compare"
        : "Click column headers to sort · select up to 2 models to compare";
    }
    if (searchClear) {
      searchClear.classList.toggle("visible", query.trim().length > 0);
    }
    // mark active header
    document.querySelectorAll(".rank-table th[data-sort]").forEach((th) => {
      const key = th.getAttribute("data-sort");
      th.classList.toggle("active", key === sortKey);
      const ind = th.querySelector(".sort-ind");
      if (ind) ind.textContent = key === sortKey ? (sortDir === "asc" ? "▲" : "▼") : "↕";
    });
    if (sortSelect) sortSelect.value = sortKey;
    if (dirSelect) dirSelect.value = sortDir;

    if (rows.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="7"><div class="empty-filter">No models match your search. Clear the filter to see the full library.</div></td></tr>';
      return;
    }

    tbody.innerHTML = rows.map((row, i) => {
      const isSel = selected.includes(row.slug);
      const confT = tone(row.conformance);
      const capT = tone(row.capability);
      const agent =
        row.agenticPassed == null
          ? "—"
          : row.agenticPassed + "/" + row.agenticTotal;
      const agentT =
        row.agenticRatio == null
          ? "neutral"
          : row.agenticRatio === 1
            ? "good"
            : row.agenticRatio === 0
              ? "critical"
              : "caution";
      const compareDisabled =
        !isSel && selected.length >= 2 ? " disabled" : "";
      return (
        '<tr data-slug="' + row.slug + '"' + (isSel ? ' class="selected"' : "") + ">" +
        '<td class="rank-num">' + (i + 1) + "</td>" +
        '<td><div class="rank-model">' + escText(row.short) +
          '<span class="sub">' + escText(row.engine || row.baseUrl || row.source || "") + "</span></div></td>" +
        "<td>" + tierCell(row) + "</td>" +
        '<td class="metric-cell ' + confT + '">' + fmtPct(row.conformance) + "</td>" +
        '<td class="metric-cell ' + capT + '">' + fmtPct(row.capability) +
          (row.verdict ? '<span class="verdict">' + escText(row.verdict) + "</span>" : "") +
        "</td>" +
        '<td class="metric-cell ' + agentT + '">' + agent + "</td>" +
        '<td><div class="row-actions">' +
          '<a class="btn-sm view" href="' + escText(row.href) + '">View</a>' +
          '<button type="button" class="btn-sm compare-add' + (isSel ? " active" : "") +
            '" data-add="' + escText(row.slug) + '"' + compareDisabled + ">" +
            (isSel ? "Selected" : "Compare") +
          "</button>" +
        "</div></td>" +
        "</tr>"
      );
    }).join("");
  }

  function escText(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setQuery(next) {
    query = next;
    if (searchInput && searchInput.value !== next) searchInput.value = next;
    renderTable();
  }

  function bySlug(slug) {
    return catalog.find((r) => r.slug === slug);
  }

  function renderDock() {
    document.body.classList.toggle("has-dock", selected.length > 0);
    if (!dock) return;
    dock.classList.toggle("visible", selected.length > 0);
    if (!picksEl) return;
    if (selected.length === 0) {
      picksEl.innerHTML = "";
      if (goBtn) goBtn.disabled = true;
      return;
    }
    const slots = selected.map((slug) => {
      const row = bySlug(slug);
      const name = row ? row.short : slug;
      return (
        '<div class="pick"><span>' + escText(name) + "</span>" +
        '<button type="button" class="rm" data-rm="' + escText(slug) + '" aria-label="Remove">×</button></div>'
      );
    });
    if (selected.length === 1) {
      slots.push('<div class="empty-slot">Select one more model to compare</div>');
    }
    picksEl.innerHTML = slots.join("");
    if (goBtn) {
      goBtn.disabled = selected.length !== 2;
      if (selected.length === 2) {
        goBtn.dataset.href = pairHref(selected[0], selected[1]);
      }
    }
  }

  function toggleSelect(slug) {
    const idx = selected.indexOf(slug);
    if (idx >= 0) {
      selected.splice(idx, 1);
    } else if (selected.length < 2) {
      selected.push(slug);
    }
    renderTable();
    renderDock();
  }

  tbody.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-add]");
    if (!btn || btn.disabled) return;
    toggleSelect(btn.getAttribute("data-add"));
  });

  if (picksEl) {
    picksEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-rm]");
      if (!btn) return;
      toggleSelect(btn.getAttribute("data-rm"));
    });
  }

  if (goBtn) {
    goBtn.addEventListener("click", () => {
      if (selected.length !== 2) return;
      const href = pairHref(selected[0], selected[1]);
      window.location.href = href;
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      selected = [];
      renderTable();
      renderDock();
    });
  }

  function setSort(key, dir) {
    if (key) sortKey = key;
    if (dir) sortDir = dir;
    renderTable();
  }

  if (sortSelect) {
    sortSelect.addEventListener("change", () => setSort(sortSelect.value, null));
  }
  if (dirSelect) {
    dirSelect.addEventListener("change", () => setSort(null, dirSelect.value));
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      setQuery(searchInput.value);
    });
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && query) {
        e.preventDefault();
        setQuery("");
      }
    });
  }
  if (searchClear) {
    searchClear.addEventListener("click", () => {
      setQuery("");
      if (searchInput) searchInput.focus();
    });
  }

  document.querySelectorAll(".rank-table th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-sort");
      if (sortKey === key) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortKey = key;
        sortDir = key === "model" ? "asc" : "desc";
      }
      renderTable();
    });
  });

  renderTable();
  renderDock();
})();
`;

  return `${htmlShellStart("llmprobe · model library")}
<div class="wrap">
  <header class="top">
    <div>
      <div class="brand">llmprobe</div>
      <h1>Model library</h1>
      <div class="meta">
        <span id="library-count">${catalog.length} model${catalog.length === 1 ? "" : "s"}</span>
        <span>auto-synced from runs/*.json</span>
        <span>scores stay independent</span>
      </div>
    </div>
    <nav class="nav-links">
      <a class="btn" href="index.html">Library</a>
      ${
        catalog.length >= 1
          ? `<a class="btn primary" href="compare.html">Quick compare</a>`
          : ""
      }
      ${themeSwitcherHtml()}
    </nav>
  </header>

  <div class="narrative">
    <h2>How to use this library</h2>
    <p class="lead">Rank models by any column. Open a full report, or pick two models to compare.</p>
    <ul>
      <li><strong>Surface coverage</strong> shows Core | Extended | Frontier (green ≥90%, yellow ≥70%, red below).</li>
      <li><strong>Conformance</strong> and <strong>Capability</strong> stay separate — never averaged into one score.</li>
      <li>Use <strong>Compare</strong> on two rows, then hit <strong>Compare models</strong> in the dock.</li>
    </ul>
  </div>

  <div class="library-toolbar">
    <div class="library-search" role="search">
      <label class="visually-hidden" for="model-search">Search models</label>
      <input
        id="model-search"
        type="search"
        placeholder="Search models…"
        autocomplete="off"
        spellcheck="false"
      />
      <button type="button" class="search-clear" id="search-clear" aria-label="Clear search">×</button>
    </div>
    <div class="sort-ctrl">
      <label for="sort-key">Sort by</label>
      <select id="sort-key">
        <option value="capability">Model capability</option>
        <option value="conformance">Engine conformance</option>
        <option value="coverage">Coverage (Core→Ext→Front)</option>
        <option value="core">Core coverage</option>
        <option value="extended">Extended coverage</option>
        <option value="frontier">Frontier coverage</option>
        <option value="agentic">Agentic</option>
        <option value="fidelity">Fidelity</option>
        <option value="model">Model name</option>
      </select>
      <select id="sort-dir">
        <option value="desc">High → low</option>
        <option value="asc">Low → high</option>
      </select>
    </div>
    <div class="library-count" id="filter-meta">Click column headers to sort · select up to 2 models to compare</div>
  </div>

  <div class="rank-wrap">
    <table class="rank-table" aria-label="Model rankings">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col" data-sort="model">Model <span class="sort-ind">↕</span></th>
          <th scope="col" data-sort="coverage" title="Core | Extended | Frontier">Surface coverage <span class="sort-ind">↕</span></th>
          <th scope="col" data-sort="conformance">Conformance <span class="sort-ind">↕</span></th>
          <th scope="col" data-sort="capability" class="active">Capability <span class="sort-ind">▼</span></th>
          <th scope="col" data-sort="agentic">Agentic <span class="sort-ind">↕</span></th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody id="rank-body"></tbody>
    </table>
  </div>

  <p class="fine" style="margin-top:4px">
    Regenerate after new probes:
    <code>node runs/report-card/generate.mjs</code>
    — drops new <code>runs/*.json</code> saves into this table automatically.
  </p>
</div>

<div class="compare-dock" id="compare-dock" role="dialog" aria-label="Compare selection">
  <h3>Compare selection</h3>
  <div class="picks" id="compare-picks"></div>
  <div class="dock-actions">
    <button type="button" class="btn" id="compare-clear">Clear</button>
    <button type="button" class="btn primary" id="compare-go" disabled>Compare models</button>
  </div>
</div>

${htmlShellEnd(
  `<script>window.__LIBRARY__=${embedJson(catalog)};</script>`,
  `<script>${libraryScript}</script>`,
)}`;
}

// ── main ─────────────────────────────────────────────────────────────────────

function main() {
  mkdirSync(OUT, { recursive: true });
  const argv = process.argv.slice(2);

  if (argv[0] === "--compare") {
    const files = argv.slice(1);
    if (files.length < 2) {
      console.error("need at least two JSON files");
      process.exit(1);
    }
    const inputs = files.map((f) => {
      const { path, report } = load(f);
      return {
        label: shortModel(report.target?.model) || basename(f, ".json"),
        report,
        path,
        href: null,
      };
    });
    write("compare.html", renderCompare(inputs));
    return;
  }

  // Explicit paths: use only those. Otherwise scan runs/*.json.
  const extra = argv.filter((a) => !a.startsWith("--"));
  const runs =
    extra.length > 0
      ? discoverRunFiles({ paths: extra, scanRunsDir: false })
      : discoverRunFiles({ scanRunsDir: true });

  if (runs.length === 0) {
    console.error(
      "no llmprobe --save JSON found under runs/*.json — pass paths explicitly",
    );
    process.exit(1);
  }

  // Library catalog snapshot
  write(
    "library.json",
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        runs: runs.map((r) => ({
          ...runSummary(r),
          sourcePath: r.src,
        })),
      },
      null,
      2,
    ) + "\n",
  );

  copyFileSync(runs[0].src, join(OUT, "report.json"));

  for (const run of runs) {
    write(
      run.href,
      renderReport(run.report, {
        label: basename(run.src),
      }),
    );
  }

  // Interactive compare workbench (blank columns + model dropdowns)
  write("compare.html", renderCompareWorkbench(runs));

  write("index.html", renderHub(runs));

  console.log(
    `library: ${runs.length} run(s) → ${runs.map((r) => r.href).join(", ")} · compare.html`,
  );
}

main();
