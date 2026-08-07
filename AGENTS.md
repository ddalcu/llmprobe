# Repository Guidelines

## Project Structure & Module Organization

`bin/llmprobe.ts` is the CLI entry point; `npm run build:cli` bundles it to `bin/dist/`. Core probing, scoring, registries, and reporting live in `src/core/`. API-specific adapters are under `src/surfaces/`, while reusable protocol checks live in `src/conformance/`. Capability grading is in `src/evals/`, agent simulations in `src/agentic/`, benchmarks in `src/bench/`, and the offline mock engine in `src/fixtures/`. OpenAPI inputs are stored in `schema/`; derived validators under `src/generated/` should be regenerated rather than hand-edited. Baseline reports belong in `baselines/`.

## Build, Test, and Development Commands

- `npm ci` installs the lockfile-pinned dependencies (Node 20 or newer).
- `npm test` runs all Vitest unit and end-to-end tests offline.
- `npm run typecheck` checks strict TypeScript without emitting files.
- `npm run prettier --write .` formats the repository; use `npx prettier --check . --ignore-unknown` to mirror CI.
- `npm run build:cli` creates the executable ESM bundle.
- `npm run probe -- localhost:8080 --full` builds and probes a live engine.
- `npm run probe -- localhost:8080 --html report.html` writes the intent-based report card.
- `npm run probe -- localhost:8080 --html report.html` writes the intent-based report card.
- `npm run probe -- localhost:8080 --library runs/report-card` ingests the run and builds a local model library (gitignored outputs).
- `npm run probe -- --library runs/report-card` rebuilds a library from existing `*.json` saves (no probe).
- `npm run probe -- --compare a.json b.json --html compare.html` writes the interactive compare workbench.

HTML report cards, compare workbench, and library sync live under `src/core/report/card/`.
`runs/report-card/` is a **stub** (README + rebuild wrapper only); generated HTML/JSON stays local via gitignore.
Saving into a directory that already has `library.json` auto-syncs without re-passing `--library`.

Before opening a PR, run formatting, type checking, and the full test suite.

## Coding Style & Naming Conventions

Use TypeScript with strict typing, two-space indentation, double quotes, and trailing commas as enforced by Prettier. Prefer explicit domain names and kebab-case test IDs such as `chat-finish-is-length`. Files use kebab-case (`model-picker.ts`) and tests are colocated as `*.test.ts`. Add tier-matrix features to `src/core/registry.ts`; do not duplicate surface-independent checks in adapters.

## Testing Guidelines

Vitest is the test framework. Every behavior change should include a focused colocated test. For new conformance checks, add a switchable defect to `src/fixtures/mock-engine.ts` and prove the pipeline reports it. Preserve outcome semantics: `unsupported` affects Coverage, `fail` affects Conformance, and `inconclusive` means the model did not provide a measurable result. Benchmarks remain informational and must not alter scores or exit codes.

## Commit & Pull Request Guidelines

History generally uses concise, imperative subjects, often Conventional Commit prefixes such as `feat:`, `fix:`, and `chore:`. Keep each commit scoped to one logical change. PRs should explain the user-visible effect, link relevant issues, identify test coverage, and include before/after screenshots for HTML report changes. CI must pass Prettier, TypeScript, and Vitest. Contributions are licensed under Apache-2.0; preserve attribution in `NOTICE` when applicable.
