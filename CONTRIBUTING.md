# Contributing to llmprobe

llmprobe is a conformance and capability test suite for LLM inference engines.
Contributions are welcome.

## Development

```bash
bun test                       # unit + end-to-end tests (offline, no engine)
bun run typecheck              # TypeScript
bun run prettier --write .     # format — CI checks this, run it before pushing
bun run probe <base-url> --full   # run against a live engine
```

The test suite drives the whole pipeline against a mock engine in
`src/fixtures/mock-engine.ts` with switchable defects, so it needs no GPU and no
network. When you add a check, add a fixture defect that proves it fires.

## Adding a surface or feature

The tier matrix is **data**, not code — add an entry to `src/core/registry.ts`,
not a new module. Conformance tests are written once against the
`SurfaceAdapter` contract (`src/core/adapter.ts`) and run against every
chat-shaped surface the engine implements.

## Ground rules that keep the report honest

- Distinguish **`unsupported`** (not implemented — costs Coverage) from
  **`fail`** (implemented but broken — costs Conformance), and use
  **`inconclusive`** when the model wouldn't cooperate. See
  `src/core/outcome.ts`.
- Keep the three scores independent: model quality must never move the engine
  score, and the benchmark is informational — it never feeds a score or the exit
  code.
- Never report something not measured as a pass. "We didn't look" and "it isn't
  there" are different claims.

## License

By contributing you agree that your contributions are licensed under the
Apache License 2.0. See `LICENSE` and `NOTICE`.
