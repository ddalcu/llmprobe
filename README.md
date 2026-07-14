# llmprobe

**A conformance and capability suite for LLM inference engines.**

Point it at any OpenAI-compatible endpoint — llama.cpp, LM Studio, mlx-serve, vLLM, Ollama, OpenRouter — and it answers two questions that are usually tangled together:

1. **How complete and correct is your engine?** Does it implement Responses? Messages? Embeddings, vision, logprobs, structured outputs? And of what it _does_ implement, is it actually right?
2. **Is the model semi-capable?** Not an intelligence benchmark — a floor check. Does it call tools correctly, follow instructions, produce valid JSON, remember what you told it?

```bash
npx llmprobe localhost:8080          # llama.cpp
npx llmprobe localhost:1234/v1       # LM Studio
npx llmprobe https://openrouter.ai/api/v1 -k $OPENROUTER_API_KEY
```

```
SURFACE COVERAGE
  CORE      9/9      100%  ██████████
  EXTENDED  6/11    54.5%  █████░░░░░
            ✗ responses   ✗ messages   ✗ logprobs   ✗ reasoning items
  FRONTIER  0/8        0%  ░░░░░░░░░░
  credit    Ollama native /api/chat — detected, not scored

ENGINE CONFORMANCE                                                   96.8%
  MUST assertions, implemented surfaces only
  chat        52/54     96.3%
  embeddings   4/4       100%
  ⚠ 1 inconclusive — engine never exercised
      tool_calls serialization — model never emitted a tool call

MODEL CAPABILITY                                  78.4%   semi-capable ✓
  Tool selection         6/6      100%  ██████████
  Tool restraint         4/6     66.7%  ███████░░░
  JSON discipline        6/6      100%  ██████████
```

## The three numbers, and why they are three

**Coverage** — how much of the standard surface exists, scored per tier and never blended. An engine that nails Core but ships no Responses or Messages reads as exactly that, not as a mushy 60%.

**Conformance** — of what _is_ implemented, how correct is it. Only `MUST` assertions score. `SHOULD` and `MAY` failures print below the line as warnings and nits, because a missing `system_fingerprint` breaks nobody and a corrupted tool-call argument breaks everybody, and one number cannot represent both.

**Capability** — whether the model clears the bar. Deterministic grading only: no LLM judge, no second API key, reproducible.

They are never averaged. A weak model cannot drag down the engine's score, and a strong one cannot rescue it. That separation is enforced by tests, not by convention.

## This suite is normative

llmprobe is not trying to meet engines where they are. Missing Responses or Messages **costs points**, on purpose — the goal is to push the ecosystem toward the standards. Full-surface engines are the 100% target; a Core-only engine gets a visibly incomplete card with the gaps named.

Two rules follow from that:

- **Unknown fields are always tolerated.** Engines legitimately add their own (llama.cpp emits timings, Ollama its own metadata). Rejecting them would be a false positive.
- **Silently ignoring a requested parameter is a MUST failure.** An engine that accepts `logprobs: true`, returns `200 OK`, and sends no logprobs is worse than one that cleanly returns `400` — the caller cannot detect it. That costs Coverage (the feature isn't really there) _and_ Conformance (pretending it is, is a trap). It's the one place we deliberately charge twice.

Ollama's native `/api/chat` is detected and shown as a credit line, and scores exactly zero. We reward standards, not native APIs.

## Honest outcomes

Two states most suites don't have:

- **`unsupported`** — not implemented. Costs Coverage, leaves the Conformance denominator alone.
- **`inconclusive`** — the engine was never exercised because the model wouldn't cooperate. You cannot check that `tool_calls` serializes correctly if the model never emits a tool call. Rather than guess, the result leaves the denominator and gets printed loudly.

To keep `inconclusive` rare, engine tests **force the model's hand** wherever the spec allows: `tool_choice: "required"`, a named function, `max_tokens: 1` for finish-reason checks, temperature 0. Model variance is designed _out_ of the engine score.

`--quick` skips tests rather than running them, so anything it didn't check is reported as _not probed_ and excluded from the denominator — never as missing.

## Reasoning models

Most modern local models (Qwen3, DeepSeek-R1 distills, gpt-oss) **think before they speak**, and that quietly breaks naive test suites. Ask a Qwen3.6-27B for the capital of Australia with `max_tokens: 16` and you get:

```json
{
  "content": "",
  "reasoning_content": "Here's a thinking process: ...",
  "finish_reason": "length",
  "usage": { "reasoning_tokens": 15 }
}
```

Every token went to the scratchpad; the answer is **empty**. Score that naively and a 27B model reads as 0% on basic knowledge — which says nothing about the model and everything about the harness. (This is not hypothetical: it's exactly what llmprobe did on its first real run, before the fix.)

So llmprobe probes once for a reasoning channel and, if it finds one, grants every test that needs a visible answer a **+1024 token headroom** — while leaving the deliberate truncation tests (`max_tokens: 1` finish-reason, `max_tokens` honoured) at their tight budgets, since there truncation is the whole point. Inline `<think>` blocks are stripped before grading, so the model is judged on its answer rather than its scratchpad.

Reasoning models therefore take substantially longer and cost more tokens to test. That's inherent, not incidental.

## Performance benchmark (`--bench`)

Opt-in, informational, and **never scored** — a slow engine isn't a non-conformant one, so this is a fourth section that never touches the three cards or the exit code.

```
PERFORMANCE
  informational — not scored; hardware-dependent, same-machine comparisons only
  Decode throughput     42.3 tok/s (39.1–44.0)
  Time to first token   380 ms (310–520)
  Prefill throughput    910 tok/s  (2048-token prompt)
  Speculative decode    1.8× — effective (MTP/draft active)
    predictable 71.2 tok/s · novel 39.4 tok/s
  Context scaling   decode · TTFT vs prompt size
    ~0.5k   41.9 tok/s   90 ms
    ~4.1k   38.5 tok/s   310 ms
    ~8.2k   35.1 tok/s   640 ms
   ~16.2k   29.8 tok/s   1280 ms
```

What makes it a benchmark rather than the incidental per-request timing: a **discarded warmup** run per scenario (so cold model-load never leaks in), **median of 3** measured runs reported as `median (min–max)` (never a single fake-precise figure), and the honesty that everything else has — `n/a` when usage isn't reported, rather than a fabricated number.

**Context scaling** (inspired by [llm_context_benchmarks](https://github.com/ivanfioravanti/llm_context_benchmarks)) times one generation at ~0.5k / 4k / 8k / 16k prompt tokens, so you can see decode throughput and latency degrade as the KV cache grows — some engines fall off a cliff, others hold up. Kept deliberately light (one run per rung), and the size column reports the tokens the engine _actually_ ingested, not our byte estimate.

**The speculative-decoding / MTP probe** is the interesting part. MTP and speculative decoding only speed things up when the draft is _accepted_, which happens far more on predictable output than novel output. So the probe measures decode throughput on **predictable content** (repeat this passage verbatim) versus **novel content** (invent something original) and reports the ratio. A ratio well above 1 is the black-box signature that the engine's MTP/draft path is actually working; ~1.0 means it's absent or not helping. It can't tell you _which_ technique (MTP vs draft model vs prompt-lookahead) — only whether it pays off.

Two honesty guardrails: the report states it's **hardware-dependent** (cross-engine comparison only holds on the same machine), and on a reasoning model it flags that the "repeat this" task still triggers a novel thinking phase, so the ratio **understates** real speculative gains rather than silently misreporting them.

## Run depths

|             | What runs                                                   | Use it for                         |
| ----------- | ----------------------------------------------------------- | ---------------------------------- |
| `--quick`   | Surface probe + Core smoke tests                            | "Does this engine basically work?" |
| _(default)_ | Full conformance + capability evals                         | Everyday use                       |
| `--full`    | Everything, incl. long-context, concurrency, prompt caching | Release gating                     |

Surface discovery is free: it probes with empty-body POSTs, which every engine rejects at validation long before inference. Mapping the whole surface costs zero tokens even against a paid endpoint. For the rest, `--budget <tokens>` sets a hard ceiling.

**Catch-all servers.** Not every engine 404s a path it doesn't have. LM Studio answers _every_ unknown path with `HTTP 200` and `{"error":"Unexpected endpoint or method. (POST /v1/images/generations)"}` — so a status-only probe credits it with audio, images, and endpoints it has never heard of. llmprobe first asks for an endpoint that cannot exist, fingerprints whatever the server says, and reads any matching reply as absent. Coverage is the number people quote; getting this wrong would have been the most damaging bug in the tool.

## Regression tracking

The JSON output doubles as a baseline format:

```bash
llmprobe localhost:8080 --save baselines/llama-cpp-b4321.json
# ...upgrade the engine...
llmprobe localhost:8080 --baseline baselines/llama-cpp-b4321.json
# REGRESSED chat-finish-is-length: pass → expected length/max_tokens, got "stop"
```

Exit code is non-zero on any `MUST` failure, regression, or exhausted budget, so it works as a CI gate. **The model's score never affects the exit code** — llmprobe gates on the engine, not on how clever the model is.

## What gets checked

**Surfaces** — `/v1/models`, `chat/completions` (Core); `responses`, `messages`, `embeddings`, `completions` (Extended); `images`, `audio/speech`, `audio/transcriptions` (Frontier).

**Features** — SSE framing and event ordering, tool calling, JSON mode, usage tokens, finish reasons, error shapes, `stop`/`max_tokens` (Core); structured outputs, parallel tool calls, vision, logprobs, reasoning items, streamed usage, seed determinism (Extended); MCP tools, rate limiting, prompt caching, `previous_response_id`, background responses (Frontier).

Per assertion: HTTP status, Zod schema (from the OpenAPI documents in `schema/`), field presence and types, SSE event ordering, chunk correctness, error body shape.

**Capability evals** — nine deterministic categories: tool selection, **tool restraint** (does _not_ call a tool when it shouldn't — the one small models fail hardest), tool argument fidelity, multi-turn state, instruction following, JSON discipline, long-context recall, basic reasoning, and a deliberately thin knowledge set.

Tool and JSON evals run at **k=3 with temperature 0.7**, deliberately. At temperature 0 a deterministic engine returns three identical samples and k=3 measures nothing. Real applications sample, and a model that picks the right tool two times in three is a materially different proposition from one that does it every time — that reliability figure is the most useful single fact about a local model, and it only exists if you let the model sample. Everything else runs k=1 at temperature 0.

"Semi-capable" means **≥70% overall, no category below 50%, and every required category actually measured**.

That third gate exists because of a real result. A 2B model whose chat template can't do tools made the engine reject every tool request — so all three tool categories _silently vanished_ from the card and the model was certified "semi-capable" at 100% on the easy half. Being unable to attempt a category must never score better than attempting it badly. Now the card reads `100% — not semi-capable ✗` with `⚠ never measured: Tool selection, Tool restraint, Tool arg fidelity`. We don't know, so we don't certify.

## Development

```bash
bun test           # 100+ unit + end-to-end tests, fully offline
bun run typecheck
bun run probe localhost:8080 --full
```

The test suite drives the entire pipeline — probe, run, score, report — against a mock engine in `src/fixtures/mock-engine.ts` with switchable defects. Each planted defect (a stream missing `[DONE]`, a lying `finish_reason`, tool arguments serialized as an object, a silently-ignored `logprobs`) has a test demanding the report name it. A conformance suite nobody has run against a known-broken engine is just a well-formatted opinion.

### Layout

```
src/core/         outcome types, scoring, probe, registry, runner, reports
src/surfaces/     one adapter per API surface (chat, responses, messages)
src/conformance/  tests, written once against the adapter contract
src/evals/        the nine capability categories + deterministic graders
src/fixtures/     mock engine + end-to-end pipeline tests
schema/           OpenAPI documents → generated Zod schemas
```

Adding a feature to the tier matrix is an entry in `src/core/registry.ts`, not a new module. Conformance tests are written once against the `SurfaceAdapter` contract and run against every chat-shaped surface the engine implements.

## License & credits

Licensed under [Apache 2.0](LICENSE). See [`NOTICE`](NOTICE) for attribution.

The probe, scoring, conformance tests, capability evals, benchmark, and CLI are original to llmprobe. The OpenAPI schemas under `schema/` (and the Zod validators generated from them) are derived from [openresponses](https://github.com/openresponses/openresponses) and the official [openai/openai-openapi](https://github.com/openai/openai-openapi) spec, retained under Apache 2.0 — full attribution in [`NOTICE`](NOTICE).
