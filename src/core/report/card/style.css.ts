/**
 * Shared CSS for the report card, library and compare pages: one theme,
 * dense — hairline panels, ruled tables, small type, one accent colour.
 * Charts and scripts read the colour variables, so keep the names.
 */
export const CARD_STYLE = `
:root {
  color-scheme: light;
  --page: #f7f7f8;
  --surface: #fff;
  --surface-2: #f4f4f5;
  --ink: #18181b;
  --ink-2: #3f3f46;
  --muted: #71717a;
  --line: #e4e4e7;
  --line-strong: #d4d4d8;
  --track: #ececef;
  --engine: #2f6fde;
  --engine-soft: #eaf1fd;
  --model: #1f9d55;
  --model-soft: #e7f6ee;
  --good: #15803d;
  --good-bg: #e7f6ee;
  --caution: #b45309;
  --caution-bg: #fdf3e2;
  --critical: #dc2626;
  --critical-bg: #fdecec;
  --radius: 6px;
  --shadow: 0 1px 2px rgba(24,24,27,.04);
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
  --sans: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
* { box-sizing: border-box; margin: 0; }
body {
  font: 12.5px/1.45 var(--sans);
  background: var(--page); color: var(--ink);
  -webkit-font-smoothing: antialiased;
  font-variant-numeric: tabular-nums;
}
a { color: var(--engine); text-decoration: none; }
a:hover { text-decoration: underline; }
.wrap { max-width: 1400px; margin: 0 auto; padding: 12px 16px 28px; }
.good { color: var(--good); }
.caution { color: var(--caution); }
.critical { color: var(--critical); }
.muted { color: var(--muted); }
/* reasoning rows carry a tone class; colour one cell, not the row */
tr.good, tr.caution, tr.bad { color: inherit; }
button { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--engine); outline-offset: 1px; border-radius: 3px; }

/* header */
.top {
  display: flex; flex-wrap: wrap; gap: 4px 16px;
  justify-content: space-between; align-items: flex-end;
  padding-bottom: 10px; margin-bottom: 10px;
  border-bottom: 1px solid var(--line);
}
.top > div:first-child { min-width: 0; flex: 1 1 320px; }
.brand {
  font-size: 10.5px; font-weight: 600; letter-spacing: .08em;
  text-transform: uppercase; color: var(--muted);
}
.top h1 { font-size: 17px; font-weight: 650; letter-spacing: -.01em; line-height: 1.25; }
.meta { color: var(--muted); font-size: 11.5px; margin-top: 2px; }
.meta span + span::before { content: "·"; margin: 0 6px; color: var(--line-strong); }
.nav-links { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }

/* buttons: flat, small; active = filled ink */
.btn, .btn-sm, .filter-chip, .surface, .compare-dock .btn {
  display: inline-flex; align-items: center; gap: 5px;
  cursor: pointer; text-decoration: none; white-space: nowrap;
  font-size: 11.5px; font-weight: 500; line-height: 18px; padding: 1px 8px;
  background: var(--surface); color: var(--ink-2);
  border: 1px solid var(--line-strong); border-radius: 4px;
}
.btn:hover, .btn-sm:hover, .filter-chip:hover, .surface:hover {
  background: var(--surface-2); color: var(--ink); text-decoration: none;
}
.btn.primary, .filter-chip.active, .btn-sm.compare-add.active {
  background: var(--ink); color: #fff; border-color: var(--ink);
}
.surface.active { border-color: var(--engine); box-shadow: inset 0 0 0 1px var(--engine); background: var(--engine-soft); }
.btn:disabled, .btn-sm:disabled { opacity: .45; cursor: not-allowed; }

/* overview: one summary table */
.overview-label {
  display: flex; justify-content: space-between; gap: 12px;
  align-items: baseline; margin: 0 0 4px;
}
.overview-label h2 {
  font-size: 10.5px; font-weight: 600; letter-spacing: .07em;
  text-transform: uppercase; color: var(--muted);
}
.overview-label p { color: var(--muted); font-size: 11px; }
.summary { margin-bottom: 10px; }
.summary td:first-child { white-space: nowrap; }
.summary td:first-child a { color: var(--ink); font-weight: 600; }
.summary .score-cell { font-weight: 650; white-space: nowrap; text-align: right; }

/* tables: horizontal rules, muted header */
table { border-collapse: collapse; }
.drill-table, .rank-table, .fail-table, .summary { width: 100%; font-size: 11.5px; }
.summary, .rank-wrap, .conf-table-wrap {
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--radius); box-shadow: var(--shadow);
}
.summary { border-collapse: separate; border-spacing: 0; overflow: hidden; }
.drill-table th, .rank-table th, .fail-table th, .summary th {
  text-align: left; white-space: nowrap; padding: 4px 8px;
  font-size: 10.5px; font-weight: 600; letter-spacing: .04em;
  text-transform: uppercase; color: var(--muted);
  background: #fafafa; border-bottom: 1px solid var(--line);
}
.drill-table td, .rank-table td, .fail-table td, .summary td {
  padding: 3px 8px; border-bottom: 1px solid var(--line);
  vertical-align: top; overflow-wrap: anywhere;
}
.drill-table tr:last-child td, .rank-table tr:last-child td,
.fail-table tr:last-child td, .summary tr:last-child td { border-bottom: 0; }
.drill-table tbody tr:hover td, .summary tbody tr:hover td { background: #fafafa; }
.drill-table tr.fail-row td:first-child { color: var(--critical); }
.drill-table tr.bad td:nth-child(4) { color: var(--critical); }
.drill-table tr.caution td:nth-child(4) { color: var(--caution); }
.expand-panel .drill-table, .section > .drill-table {
  border: 1px solid var(--line); border-radius: 4px;
  border-collapse: separate; border-spacing: 0;
}
.note { color: var(--muted); }

/* status: coloured dot + word */
.status-pill { display: inline-flex; align-items: center; gap: 5px; font-weight: 550; white-space: nowrap; }
.status-pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.status-pill.pass, .status-pill.supported { color: var(--good); }
.status-pill.fail, .status-pill.unsupported { color: var(--critical); }
.status-pill.inconclusive, .status-pill.skipped, .status-pill.partial { color: var(--caution); }
.status-pill.not-probed { color: var(--muted); font-weight: 400; }

/* labels */
.badge, .chip, .tag {
  display: inline-block; font-size: 10.5px; font-weight: 550; line-height: 16px;
  padding: 0 6px; margin-left: 5px; border-radius: 4px; vertical-align: 1px;
  background: var(--surface-2); color: var(--ink-2);
}
.badge:first-child { margin-left: 0; }
.badge.critical { background: var(--critical-bg); color: var(--critical); }
.badge.caution, .chip { background: var(--caution-bg); color: var(--caution); }
.badge.good { background: var(--good-bg); color: var(--good); }
.tag { color: var(--muted); font-weight: 500; text-transform: lowercase; letter-spacing: 0; }

/* bars */
.track { display: block; height: 6px; background: var(--track); border-radius: 3px; overflow: hidden; min-width: 40px; }
.fill { display: block; height: 100%; background: var(--engine); border-radius: 3px; }
.fill.model { background: var(--model); }
.fill.caution { background: #e8a33d; }
.fill.critical { background: var(--critical); }

/* sections: hairline panels */
.story { display: grid; gap: 10px; }
.trio {
  display: grid; gap: 10px; align-items: start;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr));
}
.section {
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--radius); box-shadow: var(--shadow);
  padding: 0 10px 8px; min-width: 0;
}
.section-head {
  display: flex; flex-wrap: wrap; gap: 2px 10px;
  justify-content: space-between; align-items: baseline;
  border-bottom: 1px solid var(--line);
  margin: 0 -10px 6px; padding: 6px 10px;
}
.section-head h2 {
  font-size: 10.5px; font-weight: 600; letter-spacing: .07em;
  text-transform: uppercase; color: var(--ink-2);
}
.section-head .score { font-weight: 650; font-size: 13px; }
.lede, .fine, .hint-click, .scope-note, .expand-note {
  color: var(--muted); font-size: 11px; margin: 2px 0 6px;
}
.scope-note { margin-top: 3px; }
.missing { color: var(--critical); font-size: 11px; margin: 0 0 4px 12px; }
.missing span { display: inline-block; margin-right: 10px; }

/* expandable rows */
.tier-toggle, .cat-toggle, .fid-toggle, .task-toggle {
  display: block; width: 100%; border: 0; background: none;
  text-align: left; cursor: pointer; padding: 0; border-radius: 4px;
}
.tier-toggle:hover, .cat-toggle:hover, .fid-toggle:hover { background: #fafafa; }
.chev { display: inline-block; width: 12px; font-size: 9px; color: var(--muted); transition: transform .12s; }
[aria-expanded="true"] .chev { transform: rotate(90deg); }
.row, .cat-row {
  display: grid; gap: 8px; align-items: center; padding: 2px 0;
  grid-template-columns: minmax(110px, 170px) 48px 44px 1fr;
}
.tier-block + .tier-block, .cat-block + .cat-block, .fid-block + .fid-block { border-top: 1px solid var(--line); }
.row-label { font-weight: 600; }
.row-ratio { color: var(--muted); }
.row-pct { text-align: right; font-weight: 650; }
.floor-mark { position: relative; display: block; }
.floor-mark::after {
  content: ""; position: absolute; left: 50%; top: -2px; bottom: -2px;
  border-left: 1px dashed var(--ink-2); opacity: .5;
}
.expand-panel { display: none; margin: 2px 0 8px 12px; }
.expand-panel.open { display: block; }
.expand-panel[hidden] { display: none !important; }

/* conformance */
.surface-grid { display: flex; flex-wrap: wrap; gap: 6px; margin: 2px 0 6px; }
.surface { text-align: left; }
.surface .n { font-weight: 650; }
.surface .l { color: var(--ink-2); }
.surface .r { color: var(--muted); }
.filter-bar { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin: 6px 0; }
.filter-bar .label { font-size: 10.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin-right: 4px; }
.filter-meta { color: var(--muted); margin-left: auto; }
.conf-table-wrap { max-height: 420px; overflow: auto; box-shadow: none; }
.conf-table-wrap th { position: sticky; top: 0; z-index: 1; }
.empty-filter { padding: 8px; color: var(--muted); }
.findings { display: grid; gap: 2px; }
.finding { display: flex; gap: 8px; font-size: 11.5px; }
.finding-label { font-weight: 600; white-space: nowrap; }
.finding.critical .finding-label { color: var(--critical); }

/* agentic */
.task-table td:first-child { width: 16px; text-align: center; font-weight: 700; }
.task-table .ok { color: var(--good); }
.task-table .bad { color: var(--critical); }
.task-table .steps { white-space: nowrap; color: var(--muted); }
.task-table .detail { color: var(--critical); }

/* performance stat boxes and charts */
.secondary { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 6px; }
.sec-card { border: 1px solid var(--line); border-radius: var(--radius); padding: 4px 10px; min-width: 150px; }
.card-kicker { font-size: 10px; font-weight: 600; letter-spacing: .06em; color: var(--muted); text-transform: uppercase; }
.card-value { font-size: 16px; font-weight: 650; letter-spacing: -.01em; }
.card-note { font-size: 11px; color: var(--muted); }
.ctx-charts {
  display: grid; gap: 8px; margin: 6px 0;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}
.ctx-chart { width: 100%; height: auto; display: block; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
.chart-legend { display: flex; flex-wrap: wrap; gap: 2px 12px; margin: 2px 0; font-size: 11px; color: var(--muted); }
.swatch { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; vertical-align: 0; }
details summary { cursor: pointer; }

footer.page {
  margin-top: 10px; padding-top: 6px; border-top: 1px solid var(--line);
  color: var(--muted); font-size: 11px; display: flex; flex-wrap: wrap; gap: 4px 10px;
}
footer.page .sep { color: var(--line-strong); }

/* compare */
.compare-hero {
  display: grid; margin-bottom: 10px; overflow: hidden;
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
  grid-template-columns: 170px repeat(var(--n, 2), minmax(0, 1fr));
}
@media (max-width: 720px) { .compare-hero { display: block; } }
.compare-hero .cell { padding: 3px 8px; border-bottom: 1px solid var(--line); border-left: 1px solid var(--line); min-width: 0; }
.compare-hero .metric {
  border-left: 0; background: #fafafa; display: flex; align-items: center;
  font-size: 11.5px; font-weight: 600; color: var(--ink-2);
}
.compare-hero .run-head { font-weight: 600; }
.compare-hero .run-head .sub, .compare-hero .hint { color: var(--muted); font-size: 11px; font-weight: 400; }
.compare-hero .big { font-size: 14px; font-weight: 650; }
.compare-hero .big.best { color: var(--good); }
.compare-hero .big.worst { color: var(--critical); }
.narrative {
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
  padding: 6px 10px; margin-bottom: 10px;
}
.narrative h2 { font-size: 10.5px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); margin-bottom: 2px; }
.narrative .lead { font-weight: 600; margin-bottom: 2px; }
.narrative ul { padding-left: 16px; color: var(--ink-2); }

/* library */
.library-toolbar {
  display: flex; flex-wrap: wrap; gap: 6px 12px;
  align-items: center; justify-content: space-between; margin: 0 0 6px;
}
.library-toolbar .sort-ctrl { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.library-toolbar label { font-size: 10.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.library-toolbar select, .library-search input, .model-picker {
  font: inherit; font-size: 11.5px; padding: 2px 6px;
  border: 1px solid var(--line-strong); border-radius: 4px; background: var(--surface); color: var(--ink);
}
.library-count { color: var(--muted); }
.visually-hidden {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}
.library-search { position: relative; flex: 1 1 220px; max-width: 320px; }
.library-search input { width: 100%; padding-right: 22px; }
.library-search .search-clear {
  position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
  border: 0; background: none; color: var(--muted); cursor: pointer; display: none;
}
.library-search .search-clear.visible { display: block; }
.rank-wrap { overflow: auto; margin-bottom: 10px; }
/* Eleven columns: the wrap scrolls rather than crushing the numbers. */
.rank-table { min-width: 1080px; }
.rank-table th { position: sticky; top: 0; z-index: 1; cursor: pointer; user-select: none; }
.rank-table th:hover { color: var(--ink); }
.rank-table th .sort-ind { margin-left: 2px; font-size: 9px; opacity: .5; }
.rank-table th.active { color: var(--ink); }
.rank-table th.active .sort-ind { opacity: 1; color: var(--engine); }
.rank-table td { vertical-align: middle; }
.rank-table tbody tr:hover td { background: #fafafa; }
.rank-table tr.selected td { background: var(--engine-soft); }
.rank-num { color: var(--muted); width: 28px; white-space: nowrap; }
.rank-model { display: block; font-weight: 600; color: var(--ink); }
.rank-model .sub { display: block; font-weight: 400; font-size: 10.5px; color: var(--muted); }
.tier-stack { font-family: var(--mono); font-size: 11px; white-space: nowrap; }
.tier-stack .sep { color: var(--line-strong); margin: 0 1px; }
.tier-stack .t.neutral { color: var(--muted); }
.metric-cell { font-weight: 650; }
.metric-cell .verdict { display: block; font-size: 10.5px; font-weight: 400; color: var(--muted); }
.perf-cell { font-family: var(--mono); font-size: 11px; white-space: nowrap; }
.when-cell { color: var(--muted); white-space: nowrap; }
.row-actions { display: flex; gap: 4px; justify-content: flex-end; }

/* floating compare dock */
.compare-dock {
  position: fixed; right: 16px; bottom: 16px; z-index: 50;
  width: min(420px, calc(100vw - 32px)); display: none;
  background: var(--surface); border: 1px solid var(--line-strong); border-radius: 8px;
  box-shadow: 0 8px 24px rgba(24,24,27,.12); padding: 8px 10px;
}
.compare-dock.visible { display: block; }
.compare-dock h3 { font-size: 10.5px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); margin-bottom: 4px; }
.compare-dock .picks { display: grid; gap: 3px; margin-bottom: 6px; }
.compare-dock .pick {
  display: flex; justify-content: space-between; align-items: center;
  gap: 8px; padding: 2px 6px; border: 1px solid var(--line); border-radius: 4px; font-weight: 500;
}
.compare-dock .pick .rm { border: 0; background: none; cursor: pointer; color: var(--muted); }
.compare-dock .pick .rm:hover { color: var(--critical); }
.compare-dock .empty-slot { color: var(--muted); font-style: italic; }
.compare-dock .dock-actions { display: flex; gap: 4px; justify-content: flex-end; }
body.has-dock { padding-bottom: 110px; }
`;
