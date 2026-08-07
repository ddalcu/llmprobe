# Intent-based report cards (prototype)

CLI story in visual form. Product `--html` is unchanged until this is approved.

## Open these

| File | What |
|------|------|
| [index.html](./index.html) | **Model library** — ranking table, sort, multi-select compare |
| `*.html` (model slug) | Single-run report card |
| `compare-*-vs-*.html` | Pairwise compare pages |
| [compare.html](./compare.html) | Interactive compare — pick models per column |
| [library.json](./library.json) | Catalog snapshot of discovered runs |

## Auto-sync

```bash
# After any probe save into runs/
llmprobe localhost:8080 --save runs/my-new-model.json

# Rebuild the library + report cards + all compare pairs
node runs/report-card/generate.mjs
```

The generator scans **`runs/*.json`** (top-level only) for valid llmprobe saves
(`target` + `coverage.byTier`). Each model gets a report page; every pair gets a
compare page; `index.html` lists them all.

```bash
# Or pass explicit saves only
node runs/report-card/generate.mjs path/a.json path/b.json
```

## Library UX

- **Sortable ranking table** — click column headers or use Sort by / direction
- Columns: Model · Surface coverage (`Core|Ext|Front` color-coded) · Conformance · Capability · Agentic · Actions
- **View** — open that model’s report card
- **Compare** — select up to two models; floating dock → **Compare models** (`compare.html?a=&b=`)
- **Quick compare** — opens blank compare workbench; choose Model A / Model B from dropdowns
- Once a column has a model, **open report →** links to that model’s card
- Report + compare pages link **← Library** back to the index

Color scale for % cells: green ≥90 · yellow ≥70 · red below.

## Themes

Header dropdown (persists in `localStorage` as `llmprobe-theme`):

| Theme | Notes |
|-------|--------|
| **Light** | Default — current warm editorial look |
| **Dark** | Same layout, dark tokens |
| **Cyber** | Neon cyan/magenta HUD palette + mono type (colors/fonts only) |

Layout and information architecture are unchanged across themes.

## Single-run layout

**Overview (top)** — Coverage · Conformance · Capability (never averaged), then
Agentic / Fidelity / Outcomes honesty, then CLI-order drill-down sections.

## Design principles

- Never blend the three primary scores  
- fail ≠ unsupported ≠ inconclusive ≠ not measured  
- Engine accent (blue) vs model accent (green) as domain cues only  
- Offline single-file HTML  
