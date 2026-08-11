export const COMPARE_PICKER_STYLE = `
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
