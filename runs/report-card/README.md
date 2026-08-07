# Model library (product output)

This directory is a **product** llmprobe library — not a separate design prototype.

Canonical implementation: `src/core/report/card/`  
CLI: `llmprobe --library <dir>`

## Open

| File                           | What                                                  |
| ------------------------------ | ----------------------------------------------------- |
| [index.html](./index.html)     | Model library — ranking, search, multi-select compare |
| `*.html` (model slug)          | Single-run report card                                |
| [compare.html](./compare.html) | Interactive compare (pickers + sticky freeze header)  |
| [library.json](./library.json) | Catalog marker (enables auto-sync into this folder)   |

## Rebuild / auto-sync

```bash
# Rebuild from JSON already in this folder (and unique saves in parent runs/)
npm run build:cli
llmprobe --library runs/report-card

# Same via thin wrapper
node runs/report-card/generate.mjs

# Probe and ingest in one shot
llmprobe localhost:8080 --library runs/report-card

# Auto-sync: --save/--html into a dir that already has library.json
llmprobe localhost:8080 --save runs/report-card/my-model.json
```

Probe JSON may live in this directory or the parent (`runs/*.json`). Unique models
from the parent are copied in on rebuild so the library stays self-contained.

## Library UX

- Sortable ranking table (headers or Sort by)
- Search filters the table (no typeahead dropdown)
- Columns: Model · Surface coverage (Core\|Ext\|Front) · Conformance · Capability · Agentic · Actions
- **View** → report card · **Compare** → dock → **Compare models**
- **Quick compare** → blank workbench with per-column model pickers
- **← Library** on cards and compare · themes: Light / Dark / Cyber

## Design principles

- Never blend Coverage, Conformance, and Capability
- fail ≠ unsupported ≠ inconclusive ≠ not measured
- Bench remains informational only
