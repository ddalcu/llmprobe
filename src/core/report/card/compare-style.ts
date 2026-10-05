export const COMPARE_PICKER_STYLE = `
/* Align with score tables: metric spacer | one column per run (2–4) */
.compare-pickers {
  display: grid; margin: 0 0 8px; align-items: stretch;
  grid-template-columns: 170px repeat(var(--n, 2), minmax(0, 1fr));
}
.compare-pickers::before { content: ""; }
.picker-card {
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
  padding: 4px 8px; min-width: 0; margin-left: 6px;
}
@media (max-width: 720px) {
  .compare-pickers { grid-template-columns: 72px repeat(var(--n, 2), minmax(0, 1fr)); }
}
.picker-card-top { display: flex; align-items: center; gap: 6px; }
.model-picker { display: block; width: 100%; margin: 2px 0; font-weight: 600; cursor: pointer; }
.picker-label { font-weight: 600; }
.picker-sub { color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
.open-report { font-size: 11px; }
.open-report.muted-slot { opacity: .35; pointer-events: none; color: var(--muted); }
.blank-cell { color: var(--muted) !important; font-weight: 400 !important; }

/* Spreadsheet-style freeze row once pickers scroll away */
.compare-sticky {
  position: fixed; left: 0; right: 0; top: 0; z-index: 40; display: none;
  padding: 0 16px; background: rgba(255,255,255,.94); border-bottom: 1px solid var(--line);
}
.compare-sticky.visible { display: block; }
.compare-sticky-inner {
  /* same width as .wrap, or the frozen row drifts off its columns on wide screens */
  max-width: 1400px; margin: 0 auto; display: grid; align-items: center;
  grid-template-columns: 170px repeat(var(--n, 2), minmax(0, 1fr));
}
.sticky-col {
  display: flex; align-items: center; gap: 6px; padding: 2px 6px; min-width: 0;
  font-weight: 600; border-left: 1px solid var(--line);
}
.sticky-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 720px) {
  .compare-sticky-inner { grid-template-columns: 72px repeat(var(--n, 2), minmax(0, 1fr)); }
}
/* Compare page: timing curves left, score bars right. */
.ctx-charts { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; }
.chart-col { display: grid; gap: 6px; min-width: 0; }
@media (max-width: 720px) { .ctx-charts { grid-template-columns: 1fr; } }
`;
