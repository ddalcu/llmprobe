# Model library (local output)

Empty stub for an llmprobe **model library**. No sample probe data is shipped.

You usually **do not** need to pass `--library` yourself. Any probe with
`--html` auto-creates and updates a library next to the HTML file:

```bash
npm run build:cli

# First run from an empty runs/ — builds library, cards, and opens the browser
llmprobe localhost:8080 --model <id> --html runs/my-run-1.html

# Later runs add models to the same library
llmprobe localhost:8080 --model <id> --html runs/my-run-2.html
```

That produces (gitignored):

| Path                            | Role                                                          |
| ------------------------------- | ------------------------------------------------------------- |
| `runs/my-run-1.html`            | This run’s report card (← Library → `report-card/index.html`) |
| `runs/report-card/index.html`   | Ranking table of **all** past + current runs                  |
| `runs/report-card/compare.html` | Interactive multi-model compare                               |
| `runs/report-card/<slug>.html`  | Library copy of each model card                               |
| `runs/report-card/<slug>.json`  | Ingested probe JSON                                           |
| `runs/report-card/library.json` | Catalog                                                       |

## Optional commands

```bash
# Explicit library dir / rebuild without probing
llmprobe --library runs/report-card
node runs/report-card/generate.mjs

# Probe without opening a browser (CI)
llmprobe localhost:8080 --model <id> --html runs/out.html --no-open
```

## Themes

Light (default) · Dark · Cyber — header dropdown (`localStorage`).
