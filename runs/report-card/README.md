# Model library (local output)

Empty stub for a **project-local** llmprobe model library. No sample probe data
is shipped.

You usually do not need this. Every probe is recorded in `~/.llmprobe` with no
flags at all:

```bash
llmprobe localhost:8080 --model <id> --open
```

Pass `--library` only when you want this repo's runs kept separately from the
machine-wide ones:

```bash
npm run build:cli

llmprobe localhost:8080 --model <id> --library runs/report-card
```

That produces (gitignored):

| Path                            | Role                                         |
| ------------------------------- | -------------------------------------------- |
| `runs/report-card/index.html`   | Ranking table of **all** past + current runs |
| `runs/report-card/compare.html` | Interactive multi-model compare              |
| `runs/report-card/<slug>.html`  | Report card per run (model + endpoint)       |
| `runs/report-card/<slug>.json`  | Ingested probe JSON                          |
| `runs/report-card/library.json` | Catalog                                      |

## Optional commands

```bash
# Rebuild pages from existing JSON, no probing
llmprobe --library runs/report-card
node runs/report-card/generate.mjs

# Export a standalone card somewhere (touches no library)
llmprobe localhost:8080 --model <id> --html runs/out.html
```

## Themes

Light (default) · Dark · Cyber — header dropdown (`localStorage`).
