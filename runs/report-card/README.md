# Model library (local output)

Empty stub directory for an llmprobe **model library**. No sample probe data is
shipped here — run your own probes to populate it.

Implementation lives in product code: `src/core/report/card/`.

## First-time setup

```bash
npm run build:cli

# Probe and create the library in one shot
llmprobe localhost:8080 --library runs/report-card

# Or save JSON elsewhere, then rebuild
llmprobe localhost:8080 --save runs/report-card/my-engine.json
llmprobe --library runs/report-card
```

After the first successful sync you get (gitignored):

| File | Role |
|------|------|
| `index.html` | Ranking table, search, multi-select compare |
| `compare.html` | Interactive compare workbench |
| `<model-slug>.html` | Per-run report cards |
| `<model-slug>.json` | Ingested `--save` copies |
| `library.json` | Catalog marker (enables auto-sync) |

## Rebuild

```bash
llmprobe --library runs/report-card
# same:
node runs/report-card/generate.mjs
```

Unique probe JSON in the **parent** folder (`runs/*.json`) is adopted on rebuild
and copied into this directory.

## Auto-sync

Once `library.json` exists, any later `--save` / `--html` into this directory
refreshes the library without re-passing `--library`.

## Themes

Light (default) · Dark · Cyber — header dropdown; stored in `localStorage`.
