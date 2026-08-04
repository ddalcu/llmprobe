# llmprobe

**A conformance and capability suite for LLM inference engines.**

Point it at any OpenAI-compatible endpoint — llama.cpp, LM Studio, mlx-serve, vLLM, Ollama, OpenRouter — and it answers two questions that are usually tangled together:

1. **How complete and correct is your engine?** Does it implement Responses? Messages? Embeddings, vision, logprobs, structured outputs? And of what it _does_ implement, is it actually right?
2. **Does the model clear the floor?** Not an intelligence benchmark, a floor check with three grades (below floor / capable / strong). Does it call tools correctly, follow instructions, produce valid JSON, remember what you told it?

Above the floor there is a third, harder question: **can the model actually run an agent loop?** Three multi-step tool tasks in a simulated file workspace, scored as their own card.

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

MODEL CAPABILITY                                       78.4%   capable ✓
  Tool selection         6/6      100%  ██████████
  Tool restraint         4/6     66.7%  ███████░░░
  JSON discipline        6/6      100%  ██████████

AGENTIC                                                          2/3 tasks
  ✓ reads the config instead of answering from priors      2 steps
  ✓ finds where the port really lives and edits only that  5 steps
  ✗ follows the pointer in build.cfg instead of guessing   8 steps
      → edited version.txt, the pointer in build.cfg names VERSION
```

## The three numbers, and why they are three

**Coverage** — how much of the standard surface exists, scored per tier and never blended. An engine that nails Core but ships no Responses or Messages reads as exactly that, not as a mushy 60%.

**Conformance** — of what _is_ implemented, how correct is it. Only `MUST` assertions score. `SHOULD` and `MAY` failures print below the line as warnings and nits, because a missing `system_fingerprint` breaks nobody and a corrupted tool-call argument breaks everybody, and one number cannot represent both.

**Capability** — whether the model clears the floor, graded below floor / capable / strong. Deterministic grading only: no LLM judge, no second API key, reproducible.

They are never averaged. A weak model cannot drag down the engine's score, and a strong one cannot rescue it. That separation is enforced by tests, not by convention.

## Agentic tasks

The capability card asks whether a single tool call comes out right. The agentic card asks the question you actually have about a local model: can it run a loop? Read the right file, act on what it found, stop.

Three tasks against a simulated file workspace (`list_files`, `read_file`, `write_file`, executed in-process by llmprobe, no sandbox). Each has a trap for a characteristic agent failure:

1. **Read**: the answer is in `config.json`, and a decoy README suggests a different, more plausible value. Catches models that answer from priors instead of looking.
2. **Find and edit**: change a port that lives in one of three files, touch nothing else. Catches models that edit the plausible file, clobber sibling settings, or rewrite files they were told to leave alone.
3. **Indirection**: `build.cfg` names the file that holds the version; a decoy `version.txt` sits right there. Catches models that guess by filename instead of following the pointer.

Grading is the same deal as everywhere else in this suite: deterministic, temperature 0, final state compared by string. Failures are classified (`no-tool-call`, `wrong-answer`, `step-limit`, `engine-error`) so a 1/3 tells you _how_ it failed, not just that it did. The step cap is about twice the optimal path, and a model that did the work but never stopped calling tools still fails, with the detail saying exactly that.

This card is deliberately harder than the floor and never blended into the capability verdict. A capable model that scores 0/3 here reads as exactly that: fine as a chatbot, not ready to be an agent.

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

Engines also differ on whether thinking is on by default (mlx-serve ships it off and strips think blocks unless the request asks). So the reasoning-channel probe is a two-rung ladder: a plain request first, then one retry with the surface's standard opt-in (`reasoning_effort` on chat, `reasoning.effort` on Responses, `thinking` on Messages). A channel that only appears with the opt-in still earns the coverage line. Vendor toggles like `enable_thinking` are never sent, by the same rule that keeps native APIs at zero points.

## Performance benchmark (`--bench`)

Opt-in, informational, and **never scored** — a slow engine isn't a non-conformant one, so this is a fourth section that never touches the three cards or the exit code.

```
PERFORMANCE
  informational — not scored; hardware-dependent, same-machine comparisons only
  machine: Apple M3 Max · 64 GB · darwin arm64
  sustained load: steady — 42.3 → 41.6 tok/s over 3m 57s (-1.7%)
  Decode throughput     42.3 tok/s (39.1–44.0)
  Time to first token   380 ms (310–520)
  Prefill throughput    910 tok/s  (2048-token prompt)
  Prefix cache          active  29.3× (7.4s cold → 253 ms warm)
    usage reports 1510 of 1541 prompt tokens cached
  Concurrency (4)       serialized — one slot behind a queue  0.24 efficiency
    38.3 tok/s aggregate vs 39.5 alone · slowest first token 1.5s
  Speculative decode    1.8× — effective (MTP/draft active)
    predictable 71.2 tok/s · novel 39.4 tok/s
    2.31 tokens per decode step
  Context scaling  decode · first-token latency · speculation vs prompt size
    ~0.5k   41.9 tok/s   90 ms      2.34 tok/step · 1.78× ceiling
    ~4.1k   38.5 tok/s   310 ms     2.11 tok/step · 1.66× ceiling
    ~8.2k   35.1 tok/s   640 ms     1.62 tok/step · 1.27× ceiling
   ~16.2k   29.8 tok/s   1.3s       1.02 tok/step · 1.03× ceiling
```

What makes it a benchmark rather than the incidental per-request timing: a **discarded warmup** run per scenario (so cold model-load never leaks in), **median of 3** measured runs reported as `median (min–max)` (never a single fake-precise figure), and the honesty that everything else has — `n/a` when usage isn't reported, rather than a fabricated number. The report also records the machine it ran on (chip, RAM, platform), so "same-machine comparisons only" is something you can check in a saved baseline, not a caveat you have to remember.

The headline decode figure is measured **while generating code**, not prose, because that is the workload these engines are actually asked to serve. Decode rate is not one number: a speculator accepts far more drafts on the repetitive, tightly-constrained token stream of source code than on creative writing, so a prose figure understates what a coding agent would see. The speculative probe keeps its own prose prompt on purpose — that ratio needs a genuinely low-acceptance baseline to divide by.

**Context scaling** (inspired by [llm_context_benchmarks](https://github.com/ivanfioravanti/llm_context_benchmarks)) times generation at ~0.5k / 4k / 8k / 16k prompt tokens, so you can see decode throughput and latency degrade as the KV cache grows — some engines fall off a cliff, others hold up. The default run stays light (one run per rung); `--full` climbs to 32k and 64k and takes the median of 3 runs per rung. A rung the engine rejects (usually a context-window overflow) ends the ladder with the engine's own error printed on it, larger rungs are not attempted. The size column reports the tokens the engine _actually_ ingested, not our byte estimate.

**The speculative-decoding / MTP probe** is the interesting part. MTP and speculative decoding only speed things up when the draft is _accepted_, which happens far more on predictable output than novel output. So the probe measures decode throughput on **predictable content** (repeat this passage verbatim) versus **novel content** (invent something original) and reports the ratio. A ratio well above 1 is the black-box signature that the engine's MTP/draft path is actually working; ~1.0 means it's absent or not helping.

Alongside the ratio there's a second, independent reading: **tokens per decode step**, taken from when the stream's frames actually arrived. A speculator that accepts _k_ drafts emits _k_ tokens in one server step, so they land together and the step boundary shows up as a gap far wider than the mean. It needs no comparison run at all, and it still says something when the ratio can't. Engines that pack a whole step into one SSE frame are caught too, since the token count comes from usage rather than from counting frames. When the stream shape can't carry the claim — a body delivered in one read, or chopped into a couple of big writes by a buffering proxy — it reports that instead of a number, because "no speculation" and "spectacular speculation" would both be fabrications.

**The ladder measures agent work, not prose.** The context is a synthetic TypeScript codebase — varied identifiers, imports, types, comments — and the task is to write a function against it, using a constant planted mid-corpus. That is both what these engines are actually asked to do and where a draft path earns its keep. If the answer never references the planted constant, the rung says so: without that, you are timing generation with a large irrelevant prefix attached, which is not long-context work.

The filler used to be one sentence repeated to size, and that quietly broke the measurement. Summarising a few thousand copies of "The quick brown fox" is _highly_ predictable output, so the rung baseline was already collecting a speculation boost — a real 64k run came back decoding **faster with 512 tokens of context (53.8 tok/s) than with none at all (44.1)**, which is not a thing that happens to a real engine.

**Speculation is measured at every rung**, not just once on a short prompt. Engines routinely starve or disable a draft path as the KV cache grows, so "MTP works" measured at 500 tokens says nothing about 32k, and watching `tok/step` decay down the ladder is the whole point. Each run asks two things of one shared context: the coding task, and **counting to 200** — maximally predictable output the prompt does not contain, which is the ceiling on what speculation can deliver at that size. The gap between them is the headroom the draft path still has. Sharing the prefix is deliberate: only the coding variant supplies TTFT and prefill, so a prefix-cache hit on the ceiling run costs nothing and skips the expensive uncached prefill.

The echo variant this replaced measured nothing. Reproducing a passage buried in the context needs attention work a draft head cannot shortcut, and it came back flat — 1.01 / 0.97 / 1.01 / 0.94 / 0.95 / 1.02 — at every rung of a real 64k run. Its request budget went to the variant that discriminates.

**Two server-feature checks** sit beside the ladder, deliberately kept to a yes/no about the engine rather than a second curve. Seven requests, about twenty seconds.

**Prefix cache** sends one long prompt twice and times both. Conformance already checks that an engine _reports_ `cached_tokens` and that a warm hit doesn't change the answer; neither catches the engine that reports a hit and re-ingests the prompt anyway. Only the clock sees that. It's also the one probe in the benchmark that _wants_ a cache hit, so the prompt is busted once and reused: cold across llmprobe runs, warm within one.

**Concurrency** runs one stream alone, then a burst of four, and reports aggregate throughput over what four streams would produce at the single-stream rate. Continuous batching (vLLM, mlx-serve with batching on) holds efficiency near 1; one slot behind a queue pins it at 1/N, because the four requests simply take four times as long. Aggregate is measured over the burst's wall clock, never summed from per-request rates — that would report a queue as perfectly parallel. Each stream gets a distinct prompt, or you'd be measuring the cache instead of the batcher.

**Sustained load** is the last thing the benchmark does: the opening decode scenario run once more, after every other probe has loaded the box for minutes. One request. A drop means the machine slowed while the figures above were being taken — thermal throttling, or something else landing on the machine — and past 10% the report says so and tells you to read everything as a range. A rise is flagged too: it means the warmup never warmed it, so the headline numbers are pessimistic.

This is deliberately a measurement rather than an OS thermal reading. `ProcessInfo.thermalState` is macOS-only and tells you the chip got warm, not that these particular numbers moved; timing the same work twice is portable to the Linux boxes most llama.cpp and vLLM users are on, and it catches every cause of drift rather than one of them.

Two honesty guardrails: the report states it's **hardware-dependent** (cross-engine comparison only holds on the same machine), and on a reasoning model it flags that the "repeat this" task still triggers a novel thinking phase, so the ratio **understates** real speculative gains rather than silently misreporting them.

## Run depths

|             | What runs                                                   | Use it for                         |
| ----------- | ----------------------------------------------------------- | ---------------------------------- |
| `--quick`   | Surface probe + Core smoke tests                            | "Does this engine basically work?" |
| _(default)_ | Full conformance + capability evals                         | Everyday use                       |
| `--full`    | Everything, incl. long-context, concurrency, prompt caching | Release gating                     |

Surface discovery is free: it probes with empty-body POSTs, which every engine rejects at validation long before inference. Mapping the whole surface costs zero tokens even against a paid endpoint. For the rest, `--budget <tokens>` sets a hard ceiling.

**Catch-all servers.** Not every engine 404s a path it doesn't have. LM Studio answers _every_ unknown path with `HTTP 200` and `{"error":"Unexpected endpoint or method. (POST /v1/images/generations)"}` — so a status-only probe credits it with audio, images, and endpoints it has never heard of. llmprobe first asks for an endpoint that cannot exist, fingerprints whatever the server says, and reads any matching reply as absent. Coverage is the number people quote; getting this wrong would have been the most damaging bug in the tool.

## HTML report (`--html`)

`--html report.html` writes a single self-contained page: the three cards, capability bars, and (with `--bench`) context-scaling and speculative-decoding charts. Chart.js is inlined, so the file opens offline and you can attach it to an issue or a PR as-is. Every chart's data is also in the page as a plain table, and it follows your system's light or dark mode.

```bash
llmprobe localhost:8080 --bench --html report.html
```

`--bench-only` runs the benchmark and nothing else — no conformance, evals, agentic or fidelity. Surface discovery still runs, because it costs no tokens and the benchmark needs to know which chat-shaped surface to measure through. The terminal prints the PERFORMANCE block alone rather than three empty cards, and a saved report from such a run reports its unrun sections as _not measured_ rather than as zero, so a comparison never crowns the run that simply did more of the suite.

```bash
llmprobe localhost:8080 --bench-only --full --save mtp.json
```

Every measured run reports its own number as it completes, rather than leaving the terminal to say only that something is happening. A single 64k rung can take minutes, so the ladder does the same:

```
benchmarking (warmup + median of 3)...
  decode warmup             discarded
  decode 1/3                44.1 tok/s
  decode 2/3                45.7 tok/s
  decode 3/3                43.0 tok/s
  prefill warmup            discarded
  prefill 1/3               241.3 tok/s
  ...
  context ~16.4k
  context ~16.4k ceiling
    ~16.4k  48.8 tok/s decode · 258 tok/s prefill · 64.4s first token · 2.78 tok/step
  benchmark used 71,548 tokens (71,102 in · 446 out) over 47 requests
```

The warmup reports that it ran and cost tokens, never its number — showing it would invite reading a cold run as a result. The benchmark's own token bill is printed separately from the run total, because at `--full` the ladder is most of the bill and the two are worth telling apart.

The page is a pure function of the JSON — `--save` and `--html` render from the same object — so a saved report can be re-rendered later without touching the engine again.

## Comparing runs (`--compare`)

`--compare` takes saved `--save` reports and builds one page from them. It probes nothing, so comparing costs no tokens and needs no engine running:

```bash
llmprobe --compare llama-cpp.json vllm.json mlx.json --html compare.html
```

Two engines on one model, one engine across models, or the same pair before and after a change. You get a scorecard with every run as a column — coverage per tier, conformance, capability, agentic, fidelity, then decode, prefill, speculative ratio, tokens per step, prefix cache, concurrency and sustained load — and the context curves **overlaid**, one coloured line per run, for decode, first-token latency, prefill and tokens per decode step.

Every scorecard row is ranked: the winner is green with a ▲, the loser red with a ▼, and a row where the runs agree goes grey with an `=`. Rank never rides on colour alone, so it survives a greyscale print and a reader who can't separate the hues. Rows are ranked in the right direction — first-token latency is won by the _smallest_ number — and a row only one run measured isn't ranked at all, because that isn't a comparison.

Hovering explains it. Over a row label: what the metric measures and whether it's hardware-dependent. Over a score: where it placed, the gap to the winner, and the evidence underneath — `31.2 tok/s vs best 44.1 tok/s · 29% lower · median of 3 runs, 43–45.7`. Verdict rows like prefix cache and concurrency are ranked but never given a percentage, since "active" scoring 2 against "none" scoring 1 is an ordering, not a measurement, and "50% lower" would be a number nobody took.

Two things it does deliberately:

**The x-axis is numeric and logarithmic, not shared category labels.** Runs land on different actual token counts (506 here, 540 there) and may not even share rungs, so plotting by position would quietly line up points that aren't the same size. A rung only one run reached shows as missing rather than zero, because a rejected rung is absent data, not infinite slowness.

**It reads the machines out of the reports and checks them.** Identical hardware and the page says which; mixed and it says so at the top — coverage, conformance and capability still compare across boxes, but nothing below decode does. The colours are Okabe-Ito, so the lines stay distinguishable under the common forms of colour blindness.

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

**Features** — SSE framing and event ordering, tool calling, JSON mode, usage tokens, finish reasons, error shapes, `stop`/`max_tokens` (Core); structured outputs, parallel tool calls, vision, logprobs, reasoning items, streamed usage, seed determinism, `top_p` sampling, the legacy `max_tokens` alias (Extended); MCP tools, `n`>1 choices, rate limiting, prompt caching, `previous_response_id`, background responses (Frontier).

The silent-ignore rule gets exercised hard here: `n`, `top_p`, the legacy `max_tokens` alias, `tool_choice: "none"`, and `parallel_tool_calls: false` are all checked in the direction engines actually break (accepted with a 200, then quietly dropped). Prompt caching is probed three ways: cached-token reporting on a repeated prefix, reuse across a growing conversation, and a warm-vs-cold answer comparison, because a corrupted KV cache reports healthy counters while serving wrong answers. A concurrency test races 4 identical requests on one cold cache entry for the same reason.

Per assertion: HTTP status, Zod schema (from the OpenAPI documents in `schema/`), field presence and types, SSE event ordering, chunk correctness, error body shape.

**Capability evals** — nine deterministic categories: tool selection, **tool restraint** (does _not_ call a tool when it shouldn't — the one small models fail hardest), tool argument fidelity, multi-turn state, instruction following, JSON discipline, long-context recall, basic reasoning, and a deliberately thin knowledge set.

Tool and JSON evals run at **k=3 with temperature 0.7**, deliberately. At temperature 0 a deterministic engine returns three identical samples and k=3 measures nothing. Real applications sample, and a model that picks the right tool two times in three is a materially different proposition from one that does it every time — that reliability figure is the most useful single fact about a local model, and it only exists if you let the model sample. Everything else runs k=1 at temperature 0.

The verdict has three grades. "Capable" means **≥70% overall, no category below 50%, and every required category actually measured**. "Strong" is the same gates at ≥90% overall. Anything else is "below floor". Deliberately coarse: with 3-6 samples per category, finer tiers would be grading noise.

The measured-categories gate exists because of a real result. A 2B model whose chat template can't do tools made the engine reject every tool request, so all three tool categories _silently vanished_ from the card and the model was certified at 100% on the easy half. Being unable to attempt a category must never score better than attempting it badly. Now the card reads `100% — below floor ✗` with `⚠ never measured: Tool selection, Tool restraint, Tool arg fidelity`. We don't know, so we don't certify.

## Development

```bash
npm test           # 100+ unit + end-to-end tests, fully offline
npm run typecheck
npm run probe -- localhost:8080 --full
```

The test suite drives the entire pipeline — probe, run, score, report — against a mock engine in `src/fixtures/mock-engine.ts` with switchable defects. Each planted defect (a stream missing `[DONE]`, a lying `finish_reason`, tool arguments serialized as an object, a silently-ignored `logprobs`) has a test demanding the report name it. A conformance suite nobody has run against a known-broken engine is just a well-formatted opinion.

### Layout

```
src/core/         outcome types, scoring, probe, registry, runner, reports
src/surfaces/     one adapter per API surface (chat, responses, messages)
src/conformance/  tests, written once against the adapter contract
src/evals/        the nine capability categories + deterministic graders
src/agentic/      the simulated workspace, tasks and driver loop
src/fixtures/     mock engine + end-to-end pipeline tests
schema/           OpenAPI documents → generated Zod schemas
```

Adding a feature to the tier matrix is an entry in `src/core/registry.ts`, not a new module. Conformance tests are written once against the `SurfaceAdapter` contract and run against every chat-shaped surface the engine implements.

## License & credits

Licensed under [Apache 2.0](LICENSE). See [`NOTICE`](NOTICE) for attribution.

The probe, scoring, conformance tests, capability evals, benchmark, and CLI are original to llmprobe. The OpenAPI schemas under `schema/` (and the Zod validators generated from them) are derived from [openresponses](https://github.com/openresponses/openresponses) and the official [openai/openai-openapi](https://github.com/openai/openai-openapi) spec, retained under Apache 2.0 — full attribution in [`NOTICE`](NOTICE).
