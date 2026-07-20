import { z } from "zod";

import { bearerAuth } from "../core/adapter";
import { Inconclusive, isLengthStyleFinish } from "../core/assert";
import type { ConformanceTest } from "../core/context";
import { checkSSEFraming } from "../core/sse";

/**
 * `/v1/models` has no generated schema in this repo (it isn't in the forked
 * OpenAPI docs), so it's hand-authored from the live OpenAI behavior — which is
 * what every engine actually codes against.
 */
const modelListSchema = z.object({
  object: z.literal("list"),
  data: z.array(
    z.object({
      id: z.string(),
      object: z.literal("model"),
      created: z.number().optional(),
      owned_by: z.string().optional(),
    }),
  ),
});

export const modelsTests: ConformanceTest[] = [
  {
    id: "models-list",
    name: "/v1/models: model list",
    surface: "models",
    tier: "core",
    quick: true,
    async run(ctx, a) {
      const res = await ctx.client.request("GET", "/models", {
        headers: bearerAuth(ctx.config),
      });

      a.must(
        "models-status",
        "returns 200",
        res.status === 200,
        `HTTP ${res.status}`,
      );
      if (res.status !== 200) return;

      a.schema(
        "models-schema",
        "model list matches the spec shape",
        modelListSchema,
        res.json,
      );

      const data = (res.json as any)?.data;
      a.must(
        "models-nonempty",
        "advertises at least one model",
        Array.isArray(data) && data.length > 0,
        "the model list was empty",
      );

      if (Array.isArray(data) && data.length > 0) {
        // Callers select models by id; anything else is unusable.
        a.must(
          "models-ids",
          "every model has a string id",
          data.every((m: any) => typeof m?.id === "string" && m.id.length > 0),
          "at least one model had no id",
        );
        a.should(
          "models-owned-by",
          "models declare an owner",
          data.every((m: any) => typeof m?.owned_by === "string"),
          "owned_by missing on at least one model",
        );

        // A model list that doesn't include the model we're testing with is a
        // discovery failure: a client can't find what it's allowed to call.
        const ids = data.map((m: any) => m?.id);
        a.should(
          "models-includes-target",
          "the model under test appears in the list",
          ids.includes(ctx.config.model),
          `"${ctx.config.model}" is not in: ${ids.slice(0, 5).join(", ")}`,
        );
      }
    },
  },
];

export const embeddingsTests: ConformanceTest[] = [
  {
    id: "embeddings-basic",
    name: "embeddings: basic vector",
    surface: "embeddings",
    tier: "extended",
    async run(ctx, a) {
      const res = await ctx.client.request("POST", "/embeddings", {
        headers: bearerAuth(ctx.config),
        body: { model: ctx.config.model, input: "The quick brown fox." },
      });

      // The embeddings endpoint usually needs a *different* model than the chat
      // one. A 4xx here is far more likely to mean "wrong model" than "broken
      // endpoint", so we decline to score the engine on it.
      if (res.status >= 400) {
        throw new Inconclusive(
          `HTTP ${res.status} — likely needs a dedicated embedding model (tested with "${ctx.config.model}")`,
        );
      }

      const data = (res.json as any)?.data;
      a.must(
        "embeddings-data",
        "returns a data array",
        Array.isArray(data) && data.length > 0,
        "no data array",
      );
      if (!Array.isArray(data) || data.length === 0) return;

      const vector = data[0]?.embedding;
      a.must(
        "embeddings-vector",
        "returns a numeric vector",
        Array.isArray(vector) && vector.length > 0,
        "embedding was not a non-empty array",
      );
      a.must(
        "embeddings-numbers",
        "every component is a finite number",
        Array.isArray(vector) &&
          vector.every(
            (n: unknown) => typeof n === "number" && Number.isFinite(n),
          ),
        "embedding contained non-numeric values",
      );
      a.should(
        "embeddings-usage",
        "reports token usage",
        (res.json as any)?.usage?.prompt_tokens !== undefined,
        "no usage block",
      );
    },
  },
  {
    id: "embeddings-dimensions",
    name: "embeddings: dimensions honored",
    surface: "embeddings",
    tier: "extended",
    async run(ctx, a) {
      const requested = 256;
      const res = await ctx.client.request("POST", "/embeddings", {
        headers: bearerAuth(ctx.config),
        body: {
          model: ctx.config.model,
          input: "hello",
          dimensions: requested,
        },
      });

      // A clean rejection is honest — not every model supports truncation.
      if (res.status >= 400) {
        return {
          featureSupported: false,
          unsupportedDetail: `rejects \`dimensions\` with HTTP ${res.status}`,
        };
      }

      const vector = (res.json as any)?.data?.[0]?.embedding;
      if (!Array.isArray(vector)) {
        throw new Inconclusive("no embedding vector to measure");
      }

      // Same rule as logprobs: accepting a parameter and ignoring it is worse
      // than refusing it, because the caller can't tell.
      a.must(
        "embeddings-dimensions-honored",
        "`dimensions` is honored when accepted",
        vector.length === requested,
        `asked for ${requested} dimensions, got ${vector.length} — accepting the parameter and ignoring it silently misleads callers`,
      );
    },
  },
];

export const completionsTests: ConformanceTest[] = [
  {
    id: "completions-basic",
    name: "completions (legacy): basic",
    surface: "completions",
    tier: "extended",
    async run(ctx, a) {
      const res = await ctx.client.request("POST", "/completions", {
        headers: bearerAuth(ctx.config),
        body: {
          model: ctx.config.model,
          prompt: "The capital of France is",
          max_tokens: 8,
          temperature: 0,
        },
      });

      a.must(
        "completions-status",
        "returns 200",
        res.status === 200,
        `HTTP ${res.status}: ${res.text.slice(0, 160)}`,
      );
      if (res.status !== 200) return;

      const choice = (res.json as any)?.choices?.[0];
      a.must(
        "completions-text",
        "returns completion text",
        typeof choice?.text === "string" && choice.text.length > 0,
        "no text on choices[0]",
      );
      a.must(
        "completions-object",
        "declares object: text_completion",
        (res.json as any)?.object === "text_completion",
        `object was "${(res.json as any)?.object}"`,
      );
      a.should(
        "completions-finish",
        "reports a finish reason",
        typeof choice?.finish_reason === "string",
        "no finish_reason",
      );
    },
  },
];

export const imagesTests: ConformanceTest[] = [
  {
    id: "images-generate",
    name: "images: generation",
    surface: "images",
    tier: "frontier",
    slow: true,
    async run(ctx, a) {
      const res = await ctx.client.request("POST", "/images/generations", {
        headers: bearerAuth(ctx.config),
        body: {
          model: ctx.config.model,
          prompt: "a red square",
          n: 1,
          size: "256x256",
        },
        timeoutMs: 120_000,
      });

      if (res.status >= 400) {
        throw new Inconclusive(
          `HTTP ${res.status} — likely needs a dedicated image model`,
        );
      }

      const first = (res.json as any)?.data?.[0];
      a.must(
        "images-payload",
        "returns a url or base64 payload",
        typeof first?.url === "string" || typeof first?.b64_json === "string",
        "neither url nor b64_json on data[0]",
      );
    },
  },
];

export const audioTests: ConformanceTest[] = [
  {
    id: "audio-speech",
    name: "audio/speech: synthesis",
    surface: "audio-speech",
    tier: "frontier",
    slow: true,
    async run(ctx, a) {
      const res = await ctx.client.request("POST", "/audio/speech", {
        headers: bearerAuth(ctx.config),
        body: { model: ctx.config.model, input: "Hello.", voice: "alloy" },
        timeoutMs: 60_000,
      });

      if (res.status >= 400) {
        throw new Inconclusive(
          `HTTP ${res.status} — likely needs a dedicated TTS model`,
        );
      }

      a.must(
        "audio-speech-body",
        "returns a non-empty audio body",
        res.text.length > 0,
        "empty body",
      );
    },
  },
];

// ── Responses-specific ──────────────────────────────────────────────────────

export const responsesOnlyTests: ConformanceTest[] = [
  {
    id: "responses-event-order",
    name: "responses: streaming event order",
    surface: "responses",
    tier: "core",
    async run(ctx, a) {
      const { reply, stream } = await ctx.sendStream("responses", {
        turns: [{ type: "user", text: "Say hello." }],
        temperature: 0,
        maxTokens: 32,
      });

      if (stream.status !== 200) {
        a.must(
          "responses-stream-status",
          "streaming returns 200",
          false,
          `HTTP ${stream.status}`,
        );
        return;
      }

      const types = reply.eventTypes;

      // The Responses lifecycle is a contract: clients build state machines on
      // it. Out-of-order events break them even when the text is fine.
      a.must(
        "responses-created-first",
        "the stream opens with response.created",
        types[0] === "response.created",
        `first event was "${types[0]}"`,
      );

      const terminal = types.at(-1);
      a.must(
        "responses-terminal-event",
        "the stream closes with a terminal response event",
        terminal !== undefined &&
          [
            "response.completed",
            "response.incomplete",
            "response.failed",
          ].includes(terminal),
        `last event was "${terminal}"`,
      );

      const added = types.indexOf("response.output_item.added");
      const done = types.indexOf("response.output_item.done");
      if (added !== -1 && done !== -1) {
        a.must(
          "responses-item-order",
          "output items are added before they are done",
          added < done,
          "output_item.done preceded output_item.added",
        );
      }

      const delta = types.indexOf("response.output_text.delta");
      const completed = types.indexOf("response.completed");
      if (delta !== -1 && completed !== -1) {
        a.must(
          "responses-delta-before-completed",
          "text deltas precede response.completed",
          delta < completed,
          "a text delta arrived after response.completed",
        );
      }
    },
  },
  {
    id: "responses-previous-response-id",
    name: "responses: previous_response_id chaining",
    surface: "responses",
    tier: "frontier",
    feature: "previous-response-id",
    async run(ctx, a) {
      const first = await ctx.send("responses", {
        turns: [{ type: "user", text: "My name is Ada. Remember it." }],
        temperature: 0,
        maxTokens: 32,
      });

      const id = first.reply.id;
      if (!id)
        throw new Inconclusive("first response carried no id to chain from");

      const second = await ctx.send("responses", {
        turns: [
          { type: "user", text: "What is my name? Reply with just the name." },
        ],
        previousResponseId: id,
        temperature: 0,
        maxTokens: 16,
      });

      if (second.status >= 400) {
        return {
          featureSupported: false,
          unsupportedDetail: `rejects previous_response_id with HTTP ${second.status}`,
        };
      }

      // Server-side conversation state is the entire promise of this parameter.
      // If the engine accepts the id but forgets the turn, it has silently
      // dropped the conversation — the caller has no way to know.
      a.must(
        "responses-chain-remembers",
        "the chained turn retains prior context",
        /ada/i.test(second.reply.text),
        `expected the model to recall "Ada", got: "${second.reply.text.slice(0, 80)}"`,
      );
    },
  },
  {
    id: "responses-background",
    name: "responses: background mode",
    surface: "responses",
    tier: "frontier",
    feature: "background",
    async run(ctx, a) {
      const res = await ctx.send("responses", {
        turns: [{ type: "user", text: "Say hi." }],
        maxTokens: 16,
        extra: { background: true },
      });

      if (res.status >= 400) {
        return {
          featureSupported: false,
          unsupportedDetail: `rejects background with HTTP ${res.status}`,
        };
      }

      const status = (res.raw as any)?.status;
      a.must(
        "responses-background-queued",
        "a background response comes back queued or in_progress",
        status === "queued" || status === "in_progress",
        `background request returned status "${status}" — it was run synchronously`,
      );
    },
  },
  {
    id: "responses-mcp-tools",
    name: "responses: server-side MCP tools",
    surface: "responses",
    tier: "frontier",
    feature: "mcp-tools",
    async run(_ctx, _a) {
      // Detection only. Actually exercising server-side MCP would require this
      // suite to stand up a reachable MCP server and let the engine call out to
      // it — real work, and out of scope until the surface is common enough to
      // be worth it. Engines that don't advertise it simply don't get the point.
      return {
        featureSupported: false,
        unsupportedDetail:
          "not probed — llmprobe does not yet host an MCP server to call back into",
      };
    },
  },
];

// ── Messages-specific ───────────────────────────────────────────────────────

export const messagesOnlyTests: ConformanceTest[] = [
  {
    id: "messages-event-order",
    name: "messages: streaming event order",
    surface: "messages",
    tier: "core",
    async run(ctx, a) {
      const { reply, stream } = await ctx.sendStream("messages", {
        turns: [{ type: "user", text: "Say hello." }],
        temperature: 0,
        maxTokens: 32,
      });

      if (stream.status !== 200) {
        a.must(
          "messages-stream-status",
          "streaming returns 200",
          false,
          `HTTP ${stream.status}`,
        );
        return;
      }

      const types = reply.eventTypes;

      a.must(
        "messages-starts",
        "the stream opens with message_start",
        types[0] === "message_start",
        `first event was "${types[0]}"`,
      );
      a.must(
        "messages-stops",
        "the stream closes with message_stop",
        types.at(-1) === "message_stop",
        `last event was "${types.at(-1)}"`,
      );

      const blockStart = types.indexOf("content_block_start");
      const blockStop = types.lastIndexOf("content_block_stop");
      if (blockStart !== -1 && blockStop !== -1) {
        a.must(
          "messages-block-order",
          "content blocks start before they stop",
          blockStart < blockStop,
          "content_block_stop preceded content_block_start",
        );
      }

      // Anthropic streams name every event; a nameless frame breaks clients
      // that dispatch on the SSE `event:` line rather than the JSON body.
      a.must(
        "messages-named-events",
        "every SSE frame carries an event name",
        stream.frames.every((f) => f.event !== undefined),
        "at least one frame had no `event:` line",
      );

      for (const issue of checkSSEFraming(stream.raw, { expectDone: false })) {
        a.must(`messages-${issue.id}`, "SSE framing", false, issue.message);
      }
    },
  },
  {
    id: "messages-max-tokens-required",
    name: "messages: max_tokens is required",
    surface: "messages",
    tier: "core",
    async run(ctx, a) {
      const res = await ctx.raw("messages", {
        model: ctx.config.model,
        messages: [{ role: "user", content: "hi" }],
      });

      // The spec makes max_tokens mandatory. An engine that quietly defaults it
      // is lenient in a way that makes client code non-portable.
      a.should(
        "messages-requires-max-tokens",
        "a request without max_tokens is rejected",
        res.status >= 400,
        `accepted a request with no max_tokens (HTTP ${res.status}) — the spec requires it`,
      );
    },
  },
  {
    id: "messages-stop-sequence-echo",
    name: "messages: stop_sequence is reported and echoed",
    surface: "messages",
    tier: "core",
    async run(ctx, a) {
      // The shared stop test checks the cut; this checks the *reporting* the
      // Anthropic spec adds on top: stop_reason "stop_sequence" plus the
      // matched sequence echoed back, which is how callers learn WHICH stop
      // fired.
      const res = await ctx.send("messages", {
        turns: [{ type: "user", text: "Say exactly: alpha beta gamma" }],
        temperature: 0,
        maxTokens: 32,
        stop: ["beta"],
      });

      if (res.status !== 200) {
        a.must(
          "messages-stop-echo-status",
          "accepts stop_sequences",
          false,
          `HTTP ${res.status}`,
        );
        return;
      }

      if (!/alpha/i.test(res.reply.text)) {
        throw new Inconclusive(
          "the model did not echo the phrase, so the stop sequence was never reachable",
        );
      }

      a.must(
        "messages-stop-reason",
        'a hit stop sequence reports stop_reason "stop_sequence"',
        res.reply.finishReason === "stop_sequence",
        `stop_reason was "${res.reply.finishReason}"`,
      );
      a.should(
        "messages-stop-echoed",
        "the matched sequence is echoed in stop_sequence",
        (res.raw as any)?.stop_sequence === "beta",
        `stop_sequence field was ${JSON.stringify((res.raw as any)?.stop_sequence)}`,
      );
    },
  },
  {
    id: "messages-thinking-budget",
    name: "messages: thinking blocks and budget",
    surface: "messages",
    tier: "extended",
    async run(ctx, a) {
      // Anthropic's extended-thinking contract: opt in with a budget, get
      // thinking blocks in a separate channel with reasoning kept out of the
      // visible text. No feature id — the shared reasoning test owns the
      // coverage line; this is the Messages-specific wire contract.
      // Budget kept small on purpose: a big local model thinking through a
      // 1024-token budget blew straight past the 60s default request timeout
      // on a real run. 256 is enough to prove the contract.
      const res = await ctx.send("messages", {
        turns: [
          {
            type: "user",
            text: "What is 17 * 23? Think it through, then answer.",
          },
        ],
        maxTokens: 640,
        extra: { thinking: { type: "enabled", budget_tokens: 256 } },
      });

      if (res.status !== 200) {
        return {
          featureSupported: false,
          unsupportedDetail: `rejects thinking with HTTP ${res.status}`,
        };
      }

      if (res.reply.reasoningText === null) {
        throw new Inconclusive(
          "thinking was enabled but the model produced no thinking block",
        );
      }

      a.must(
        "messages-thinking-separate",
        "thinking arrives in thinking blocks, not in the visible text",
        !/<think>|<\|thinking\|>/i.test(res.reply.text),
        "raw thinking tags leaked into the text content",
      );

      const reasoningTokens = res.reply.usage.reasoningTokens;
      if (typeof reasoningTokens === "number") {
        // Budgets are approximate by design; 1.5x is generous enough to never
        // fire on rounding while still catching an ignored budget.
        a.should(
          "messages-thinking-budget-respected",
          "the thinking budget is roughly respected",
          reasoningTokens <= 256 * 1.5,
          `budget_tokens 256 but reasoning used ${reasoningTokens} tokens`,
        );
      }
    },
  },
];

export const chatOnlyTests: ConformanceTest[] = [
  {
    id: "chat-n-choices",
    name: "chat/completions: n > 1 choices",
    surface: "chat",
    tier: "extended",
    feature: "n-choices",
    async run(ctx, a) {
      // Most local engines quietly return one choice whatever `n` says — the
      // classic silent no-op, and it charges like ignored logprobs: coverage
      // AND conformance.
      const res = await ctx.send("chat", {
        turns: [{ type: "user", text: "Invent a two-word band name." }],
        temperature: 0.8,
        maxTokens: 24,
        extra: { n: 2 },
      });

      if (res.status >= 400) {
        return {
          featureSupported: false,
          unsupportedDetail: `rejects n=2 with HTTP ${res.status}`,
        };
      }

      const choices = (res.raw as any)?.choices;
      if (!Array.isArray(choices) || choices.length < 2) {
        a.must(
          "chat-n-not-ignored",
          "n is honored when requested",
          false,
          `accepted n: 2 with HTTP 200 but returned ${Array.isArray(choices) ? choices.length : 0} choice(s) — a silent no-op is worse than a clean rejection`,
        );
        return {
          featureSupported: false,
          unsupportedDetail: "accepted `n` but returned one choice",
        };
      }

      a.must(
        "chat-n-count",
        "returns exactly n choices",
        choices.length === 2,
        `asked for 2 choices, got ${choices.length}`,
      );
      a.must(
        "chat-n-indices",
        "choices carry distinct indices",
        new Set(choices.map((c: any) => c?.index)).size === choices.length,
        "duplicate choice indices — callers cannot tell the choices apart",
      );
    },
  },
  {
    id: "chat-max-tokens-alias",
    name: "chat/completions: legacy max_tokens alias",
    surface: "chat",
    tier: "extended",
    feature: "max-tokens-alias",
    async run(ctx, a) {
      // The suite normally sends the modern `max_completion_tokens`; a decade
      // of existing clients still send `max_tokens`. Both are spec-valid, and
      // an engine that accepts the legacy name while ignoring it generates
      // unbounded output for exactly the clients least likely to notice.
      const res = await ctx.send("chat", {
        turns: [{ type: "user", text: "Write a long essay about the sea." }],
        temperature: 0,
        extra: { max_tokens: 1 },
      });

      if (res.status >= 400) {
        return {
          featureSupported: false,
          unsupportedDetail: `rejects legacy max_tokens with HTTP ${res.status}`,
        };
      }

      const output = res.reply.usage.outputTokens;
      const reason = res.reply.finishReason ?? "";
      const capped =
        (typeof output === "number" && output <= 4) ||
        isLengthStyleFinish(reason);

      if (!capped) {
        a.must(
          "chat-max-tokens-alias-not-ignored",
          "legacy max_tokens is honored when sent",
          false,
          `asked for 1 token via max_tokens, got ${output ?? "unknown"} tokens with finish "${reason}" — the legacy alias was silently ignored`,
        );
        return {
          featureSupported: false,
          unsupportedDetail: "accepted legacy `max_tokens` but did not cap",
        };
      }

      a.must(
        "chat-max-tokens-alias-finish",
        "truncation via the legacy alias reports a length finish",
        isLengthStyleFinish(reason),
        `expected length/max_tokens, got "${reason}"`,
      );
    },
  },
  {
    id: "chat-stop-string",
    name: "chat/completions: stop as a bare string",
    surface: "chat",
    tier: "core",
    async run(ctx, a) {
      // The spec allows `stop` as a string OR an array; the shared test sends
      // the array form, so a string-blind parser would sail through unprobed.
      const res = await ctx.send("chat", {
        turns: [{ type: "user", text: "Say exactly: alpha beta gamma" }],
        temperature: 0,
        maxTokens: 32,
        extra: { stop: "beta" },
      });

      a.must(
        "chat-stop-string-status",
        "accepts stop as a bare string",
        res.status === 200,
        `HTTP ${res.status} — the spec allows string or array`,
      );
      if (res.status !== 200) return;

      a.must(
        "chat-stop-string-honored",
        "a bare-string stop sequence cuts the output",
        !res.reply.text.includes("beta"),
        `stop "beta" (string form) appeared in the output: "${res.reply.text.slice(0, 80)}"`,
      );
    },
  },
];
