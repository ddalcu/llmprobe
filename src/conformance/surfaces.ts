import { z } from "zod";

import { bearerAuth, type Turn } from "../core/adapter";
import { Inconclusive, isLengthStyleFinish } from "../core/assert";
import type { ConformanceTest, TestVerdict } from "../core/context";
import { checkSSEFraming } from "../core/sse";
import { messagesAdapter } from "../surfaces/messages/adapter";
import { TINY_PNG_BYTES } from "./fixtures";

/** Same job as shared.ts's runNonce: a warm cache from an earlier run must never serve this one. */
const surfacesNonce =
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

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
        // Generous: a local engine may COLD-LOAD a multi-GB checkpoint before
        // it can answer, which dwarfs the generation itself.
        timeoutMs: 300_000,
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
  {
    id: "images-edit",
    name: "images: edit (multipart)",
    surface: "images-edit",
    tier: "frontier",
    slow: true,
    async run(ctx, a) {
      // The one OpenAI endpoint that is multipart/form-data rather than JSON,
      // which makes it the one place a server can read the request differently
      // from every other route. `model` in particular arrives as a form FIELD.
      const form = new FormData();
      form.append("model", ctx.config.model);
      form.append("prompt", "make the square blue");
      form.append(
        "image",
        new Blob([TINY_PNG_BYTES], { type: "image/png" }),
        "image.png",
      );

      const res = await ctx.client.request("POST", "/images/edits", {
        headers: bearerAuth(ctx.config),
        body: form,
        timeoutMs: 300_000,
      });

      if (res.status < 400) {
        const first = (res.json as any)?.data?.[0];
        a.must(
          "images-edit-payload",
          "returns a url or base64 payload",
          typeof first?.url === "string" || typeof first?.b64_json === "string",
          "neither url nor b64_json on data[0]",
        );
        return;
      }

      // A failure here is only interesting if this model does images at all.
      // Ask the JSON sibling the same question: if generation SUCCEEDS for the
      // very same model id, then "no image model" cannot explain the edit
      // failing, and the multipart surface is genuinely broken. This is the
      // signature of a server that resolves the model before it parses the
      // form body, so the `model` field is silently ignored and the request
      // runs against whatever the default model happens to be.
      const sibling = await ctx.client.request("POST", "/images/generations", {
        headers: bearerAuth(ctx.config),
        body: {
          model: ctx.config.model,
          prompt: "a red square",
          n: 1,
          size: "256x256",
        },
        timeoutMs: 300_000,
      });

      if (sibling.status >= 400) {
        throw new Inconclusive(
          `HTTP ${res.status} on edits and ${sibling.status} on generations — likely needs a dedicated image model`,
        );
      }

      a.must(
        "images-edit-accepts-multipart",
        "accepts a multipart edit for a model whose generations work",
        false,
        `HTTP ${res.status} on /images/edits while /images/generations succeeded for the same model: ${res.text.slice(0, 200)}`,
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

// ── /v1/messages/count_tokens ───────────────────────────────────────────────

export const countTokensTests: ConformanceTest[] = [
  {
    id: "count-tokens",
    name: "messages/count_tokens: token counting",
    surface: "count-tokens",
    tier: "extended",
    async run(ctx, a) {
      const headers = messagesAdapter.headers(ctx.config);
      const question =
        "What is the capital of France? Reply with the city name only.";
      const short = [{ role: "user", content: question }];
      const long = [
        ...short,
        { role: "assistant", content: "Paris." },
        {
          role: "user",
          content:
            "Now name three other French cities, with a sentence about each one.",
        },
      ];
      const count = (messages: unknown) =>
        ctx.client.request("POST", "/messages/count_tokens", {
          headers,
          body: { model: ctx.config.model, messages },
        });
      const tokens = (res: { json?: unknown }): unknown =>
        (res.json as { input_tokens?: unknown } | undefined)?.input_tokens;

      const first = await count(short);
      a.must(
        "count-tokens-status",
        "a well-formed count returns 200",
        first.status === 200,
        `HTTP ${first.status}: ${first.text.slice(0, 160)}`,
      );
      if (first.status !== 200) return;

      const n1 = tokens(first);
      a.must(
        "count-tokens-shape",
        "body carries a positive input_tokens number",
        typeof n1 === "number" && n1 > 0,
        `input_tokens was ${JSON.stringify(n1)}`,
      );
      if (typeof n1 !== "number") return;

      // The check that catches a stub returning a constant.
      const second = await count(long);
      const n2 = tokens(second);
      a.must(
        "count-tokens-grows",
        "a longer conversation counts strictly more tokens",
        typeof n2 === "number" && n2 > n1,
        `${n1} tokens for a conversation, ${JSON.stringify(n2)} for a strict superset of it`,
      );

      // The check that catches a real tokenizer applied to the wrong template.
      // Tolerant, because the generation prompt is counted differently.
      if (!ctx.present.has("messages")) return;
      const live = await ctx.send("messages", {
        turns: [{ type: "user", text: question }],
        temperature: 0,
        maxTokens: 8,
        allowReasoning: false,
      });
      const used = live.reply.usage.inputTokens;
      if (live.status !== 200 || typeof used !== "number" || used === 0) return;
      a.should(
        "count-tokens-matches-usage",
        "the count is within ~10% of what /v1/messages reports as usage",
        Math.abs(used - n1) / used <= 0.1,
        `count_tokens said ${n1}, the same messages cost ${used} input tokens on /v1/messages`,
      );
    },
  },
];

// ── assistant prefill ───────────────────────────────────────────────────────

/**
 * A prefill cut mid-word, phrased so no fresh generation would reproduce it.
 *
 * "Par" completes exactly one way, so a reply opening with "is" continued the
 * turn and one opening with "Paris" answered from the top. The preamble is
 * there only so an engine that echoes the prefill back is separable from one
 * that restarted — under "the city name only" no model writes it unprompted.
 */
export const ASSISTANT_PREFILL = "Sure. The city you are asking about is Par";

const PREFILL_TURNS: Turn[] = [
  {
    type: "user",
    text: "What is the capital of France? Reply with the city name only.",
  },
  { type: "assistant-text", text: ASSISTANT_PREFILL },
];

type PrefillBehavior = "continued" | "echoed" | "restarted" | "unclear";

function classifyPrefill(text: string): PrefillBehavior {
  const reply = text.trimStart();
  if (reply.startsWith(ASSISTANT_PREFILL)) return "echoed";
  if (/^is\b/i.test(reply)) return "continued";
  if (/paris/i.test(reply)) return "restarted";
  return "unclear";
}

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

      // The engine can only be judged on a stop it was actually given the
      // chance to cut. A weak model that answers "Alpha is a Greek letter
      // often used to denote..." and runs into max_tokens never emits `beta`
      // at all — checking only that "alpha" appeared waves that through and
      // then blames the engine for not implementing stop_sequence. Seen on
      // Llama-3.2-3B and Mistral-7B; the other ten families reached it fine.
      // Three ways the engine can be judged fairly: it said the stop fired, the
      // model emitted the sequence and the engine failed to cut it, or the text
      // stops exactly where the cut belongs (a real cut wearing the wrong
      // stop_reason — the bug this check exists for).
      const cutWhereExpected =
        res.reply.finishReason !== "max_tokens" &&
        /^alpha\W*$/i.test(res.reply.text.trim());
      const reachedStop =
        res.reply.finishReason === "stop_sequence" ||
        /beta/i.test(res.reply.text) ||
        cutWhereExpected;

      if (!/alpha/i.test(res.reply.text) || !reachedStop) {
        throw new Inconclusive(
          `the model never emitted the stop sequence (finish_reason "${res.reply.finishReason}"), so the cut was never reachable`,
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
    id: "messages-assistant-prefill",
    name: "messages: a trailing assistant message is a prefill",
    surface: "messages",
    tier: "core",
    async run(ctx, a) {
      // Anthropic's own contract, not a vendor extension: "If the final message
      // uses the assistant role, the response content will continue immediately
      // from the content in that message." No flag, and the prefill is not
      // repeated — the documented example prefills "The best answer is (" and
      // gets back "B)", nothing more.
      const res = await ctx.send("messages", {
        turns: PREFILL_TURNS,
        temperature: 0,
        maxTokens: 24,
      });

      if (res.status !== 200) {
        a.must(
          "messages-prefill-status",
          "accepts a trailing assistant message",
          false,
          `HTTP ${res.status} — the spec makes a trailing assistant turn a prefill, not an error`,
        );
        return;
      }

      const behavior = classifyPrefill(res.reply.text);
      const seen = res.reply.text.trim().slice(0, 60);

      // The model wandered off the question, so the engine's handling of the
      // prefill was never shown. Scoring it either way would be a guess.
      if (behavior === "unclear") {
        throw new Inconclusive(
          `the reply neither continued nor restarted the prefill ("${seen}")`,
        );
      }

      a.must(
        "messages-prefill-continues",
        "a trailing assistant message is continued, not answered afresh",
        behavior !== "restarted",
        `the reply started over ("${seen}") instead of continuing "${ASSISTANT_PREFILL}"`,
      );
      a.must(
        "messages-prefill-not-echoed",
        "the prefill is not echoed back in the content",
        behavior !== "echoed",
        "the response repeated the prefill — a caller that appends the reply to what it sent gets it twice",
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
  {
    id: "messages-system-blocks",
    name: "messages: system as an array of text blocks",
    surface: "messages",
    tier: "core",
    async run(ctx, a) {
      // The spec types `system` as string | TextBlockParam[], and the array
      // form is what every cache-breakpoint client sends (cache_control
      // attaches to a block, never to a bare string). The adapter only ever
      // sends the string form, so an engine that parses strings alone passes
      // the whole suite while breaking all of those clients.
      const SYSTEM =
        'Whatever the user says, reply with exactly the word "quartz" and nothing else.';
      const turns: Turn[] = [
        { type: "user", text: "What is the capital of France?" },
      ];
      const followed = (text: string) => /quartz/i.test(text);

      const baseline = await ctx.send("messages", {
        turns,
        system: SYSTEM,
        temperature: 0,
        maxTokens: 24,
      });
      if (baseline.status !== 200 || !followed(baseline.reply.text)) {
        throw new Inconclusive(
          "the model did not follow the string-form system prompt, so the block form has no baseline to be judged against",
        );
      }

      const blocks = [{ type: "text", text: SYSTEM }];
      // metadata.user_id rides along: accept-and-ignore is the correct
      // behavior for an opaque tracking field, so acceptance is the whole test.
      let res = await ctx.send("messages", {
        turns,
        temperature: 0,
        maxTokens: 24,
        extra: { system: blocks, metadata: { user_id: "llmprobe" } },
      });
      if (res.status !== 200) {
        // One request cannot say which field was refused — retry without
        // metadata so the blame lands on the right one.
        const retry = await ctx.send("messages", {
          turns,
          temperature: 0,
          maxTokens: 24,
          extra: { system: blocks },
        });
        if (retry.status !== 200) {
          a.must(
            "messages-system-blocks-status",
            "an array-form system prompt returns 200",
            false,
            `HTTP ${retry.status} — the spec types system as string | TextBlockParam[]`,
          );
          return;
        }
        a.should(
          "messages-metadata-accepted",
          "a request carrying metadata.user_id is not rejected",
          false,
          `HTTP ${res.status} with metadata.user_id, 200 without — clients that always send it get every request refused`,
        );
        res = retry;
      } else {
        a.should(
          "messages-metadata-accepted",
          "a request carrying metadata.user_id is not rejected",
          true,
        );
      }

      a.must(
        "messages-system-blocks-status",
        "an array-form system prompt returns 200",
        true,
      );
      a.must(
        "messages-system-blocks-honored",
        "the block-form system prompt is actually followed",
        followed(res.reply.text),
        `the identical system prompt was followed as a string but not as a block array: "${res.reply.text.trim().slice(0, 60)}" — accepted and dropped is the silent no-op again`,
      );
    },
  },
  {
    id: "messages-content-blocks",
    name: "messages: user content as an array of text blocks",
    surface: "messages",
    tier: "core",
    async run(ctx, a) {
      // Plain multi-block text is what agent clients send once anything is
      // attached to a turn; the adapter only produces arrays for the image
      // case, so an engine handling that but not this fails unseen.
      const res = await ctx.send("messages", {
        turns: [{ type: "user", text: "unused" }],
        temperature: 0,
        maxTokens: 24,
        // Overrides the built messages array wholesale with the block shape.
        extra: {
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Answer the question in the next block with just the number.",
                },
                { type: "text", text: "What is 12 + 30?" },
              ],
            },
          ],
        },
      });

      a.should(
        "messages-content-blocks-status",
        "a text-block array on a user turn is accepted",
        res.status === 200,
        `HTTP ${res.status} — the image form is an array too, so any client attaching content sends this shape`,
      );
      if (res.status !== 200) return;

      a.should(
        "messages-content-blocks-honored",
        "the text inside the block array reaches the model",
        /42/.test(res.reply.text),
        `expected 42, got: "${res.reply.text.trim().slice(0, 60)}"`,
      );
    },
  },
  {
    id: "messages-top-k",
    name: "messages: top_k is honored",
    surface: "messages",
    tier: "extended",
    async run(ctx, a) {
      // Same trick as the shared top_p probe: top_k: 1 collapses sampling to
      // greedy, so two runs at temperature 1 must agree. It is the sampler
      // local engines most often accept and ignore, and a spec parameter here.
      const request = {
        turns: [
          { type: "user" as const, text: "Invent a two-word band name." },
        ],
        temperature: 1,
        maxTokens: 24,
        extra: { top_k: 1 },
      };

      const first = await ctx.send("messages", request);
      a.must(
        "messages-top-k-status",
        "top_k is accepted",
        first.status === 200,
        `HTTP ${first.status} — top_k is a spec request parameter on this surface`,
      );
      if (first.status !== 200) return;

      const second = await ctx.send("messages", request);
      a.must(
        "messages-top-k-honored",
        "top_k: 1 at temperature 1 decodes greedily",
        first.reply.text === second.reply.text,
        `two runs differ: "${first.reply.text.slice(0, 40)}" vs "${second.reply.text.slice(0, 40)}" — the parameter was silently dropped`,
      );
    },
  },
  {
    id: "messages-cache-control",
    name: "messages: cache_control breakpoints",
    surface: "messages",
    tier: "frontier",
    async run(ctx, a) {
      // The explicit half of Anthropic caching, which the shared cache tests
      // never touch: an ephemeral breakpoint on a system block, answered by
      // the cache_creation/cache_read counter pair. All SHOULD — an engine
      // with no cache is not broken, just not caching, and the prompt-caching
      // feature line is owned by the shared test.
      //
      // Well past the 1024-token minimum cacheable length, and nonced so an
      // earlier run can never have warmed it.
      const system = [
        {
          type: "text",
          text:
            `Conversation ${surfacesNonce}. ` +
            "You are a meticulous, patient archivist. ".repeat(220),
          cache_control: { type: "ephemeral" },
        },
      ];
      const request = {
        turns: [{ type: "user" as const, text: "Say hi." }],
        temperature: 0,
        maxTokens: 8,
        extra: { system },
      };

      const first = await ctx.send("messages", request);
      a.should(
        "messages-cache-control-status",
        "a cache_control block is accepted",
        first.status === 200,
        `HTTP ${first.status}: ${first.text.slice(0, 160)}`,
      );
      if (first.status !== 200) return;

      const second = await ctx.send("messages", request);
      const written = first.reply.usage.cacheCreationInputTokens ?? null;
      const read = second.reply.usage.cachedInputTokens;

      if (written === null && read === null) {
        return {
          featureSupported: false,
          unsupportedDetail:
            "accepted cache_control but reports neither cache_creation_input_tokens nor cache_read_input_tokens",
        };
      }

      a.should(
        "messages-cache-write",
        "the first call reports cache_creation_input_tokens > 0",
        typeof written === "number" && written > 0,
        `cache_creation_input_tokens was ${written} on a cold ${">"}1024-token breakpoint`,
      );
      a.should(
        "messages-cache-read",
        "the identical second call reports cache_read_input_tokens > 0",
        typeof read === "number" && read > 0,
        `cache_read_input_tokens was ${read} on an exact repeat`,
      );
    },
  },
  {
    id: "messages-error-envelope",
    name: "messages: error envelope taxonomy",
    surface: "messages",
    tier: "core",
    async run(ctx, a) {
      // The shared error test stays deliberately loose (any `error` field
      // passes); this is the Anthropic-specific envelope clients branch on.
      const res = await ctx.raw("messages", {
        model: ctx.config.model,
        messages: "not-an-array",
        max_tokens: 16,
      });

      if (res.status < 400) {
        // The shared test already charges the 2xx as a MUST failure; there is
        // no envelope here to grade.
        throw new Inconclusive(
          `a malformed request returned HTTP ${res.status}, so no error envelope was produced`,
        );
      }

      const body = res.json as
        | { type?: unknown; error?: { type?: unknown } }
        | undefined;
      a.should(
        "messages-error-shape",
        'errors arrive as {type: "error", error: {...}}',
        body?.type === "error" && body?.error !== undefined,
        `error body was: ${res.text.slice(0, 160)}`,
      );

      const DOCUMENTED = [
        "invalid_request_error",
        "authentication_error",
        "billing_error",
        "permission_error",
        "not_found_error",
        "rate_limit_error",
        "timeout_error",
        "api_error",
        "overloaded_error",
      ];
      a.should(
        "messages-error-type",
        "error.type is one of the documented error types",
        typeof body?.error?.type === "string" &&
          DOCUMENTED.includes(body.error.type),
        `error.type was ${JSON.stringify(body?.error?.type)} — clients that branch on it get nothing to branch on`,
      );
    },
  },
];

export const chatOnlyTests: ConformanceTest[] = [
  {
    id: "chat-n-choices",
    name: "chat/completions: n > 1 choices",
    surface: "chat",
    tier: "frontier",
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
    id: "chat-assistant-prefill",
    name: "chat/completions: trailing assistant message",
    surface: "chat",
    tier: "extended",
    async run(ctx, a) {
      // Nothing here is scored, and that is the point. Assistant prefill is not
      // in the OpenAI spec at all, and the ecosystem split two ways: llama.cpp
      // and OpenRouter continue a trailing assistant message implicitly, vLLM
      // and SGLang want `continue_final_message` (a name borrowed from
      // transformers' apply_chat_template). The same request gets a
      // continuation from one engine and a fresh answer from the next, which is
      // worth reporting — but pressuring every engine toward one vendor's
      // dialect is the thing this suite refuses to do.
      const observe = async (extra?: Record<string, unknown>) => {
        const res = await ctx.send("chat", {
          turns: PREFILL_TURNS,
          temperature: 0,
          maxTokens: 24,
          ...(extra ? { extra } : {}),
        });
        return res.status >= 400
          ? ("rejected" as const)
          : classifyPrefill(res.reply.text);
      };

      const credit = (label: string): TestVerdict => ({
        credit: {
          id: "chat-assistant-prefill",
          label: `chat prefill: ${label}`,
        },
      });

      const implicit = await observe();
      if (implicit === "unclear") {
        throw new Inconclusive(
          "the reply neither continued nor restarted the prefill, so no dialect was shown",
        );
      }
      if (implicit === "continued") {
        return credit("a trailing assistant message is continued");
      }
      if (implicit === "echoed") {
        return credit(
          "a trailing assistant message is continued, and echoed back",
        );
      }

      const explicit = await observe({ continue_final_message: true });
      if (explicit !== "continued" && explicit !== "echoed") {
        return credit(
          implicit === "rejected"
            ? "none — a trailing assistant message is rejected outright"
            : "none — a trailing assistant message starts a new turn",
        );
      }

      // vLLM's own rule for the parameter it named: the two flags are mutually
      // exclusive. Its validator runs before defaults are filled in, so only a
      // caller who sends `add_generation_prompt: true` explicitly hits it —
      // which is exactly what this asks for. A SHOULD, because the whole
      // parameter is one vendor's, not the spec's.
      a.should(
        "chat-prefill-flag-conflict",
        "continue_final_message and add_generation_prompt are mutually exclusive",
        (await observe({
          continue_final_message: true,
          add_generation_prompt: true,
        })) === "rejected",
        "accepted both flags as true — vLLM, whose parameter this is, rejects the pair rather than silently picking one",
      );

      return credit("continue_final_message, vLLM's spelling");
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
  {
    id: "chat-template-kwargs",
    name: "chat/completions: chat_template_kwargs dialect",
    surface: "chat",
    tier: "extended",
    async run(ctx, _a): Promise<TestVerdict | void> {
      // Credit-only, by the same rule that keeps vendor thinking toggles out
      // of the reasoning probe: chat_template_kwargs is no spec's, but vLLM,
      // SGLang and llama.cpp all take it, and for Qwen3-class models
      // `enable_thinking: false` is the only road to the non-thinking path.
      // Without this line those models under-report on the reasoning probe
      // with no explanation printed. Detected, printed, worth zero points.
      const turns: Turn[] = [
        {
          type: "user",
          text: "What is 17 * 3? Think it through, then answer.",
        },
      ];
      const thought = (r: { reply: { reasoningText: string | null } }) =>
        r.reply.reasoningText !== null;

      const baseline = await ctx.send("chat", {
        turns,
        temperature: 0,
        maxTokens: 256,
      });
      // No reasoning channel shown, so the knob has nothing to switch off —
      // the second request would prove nothing.
      if (baseline.status !== 200 || !thought(baseline)) return;

      const flagged = await ctx.send("chat", {
        turns,
        temperature: 0,
        maxTokens: 256,
        extra: { chat_template_kwargs: { enable_thinking: false } },
      });

      const credit = (label: string): TestVerdict => ({
        credit: {
          id: "chat-template-kwargs",
          label: `chat_template_kwargs: ${label}`,
        },
      });
      if (flagged.status >= 400) return credit("rejected");
      if (!thought(flagged)) return credit("enable_thinking: false is honored");
      return credit("accepted and ignored — thinking still ran under the flag");
    },
  },
  {
    id: "chat-sampling-extensions",
    name: "chat/completions: sampling extensions",
    surface: "chat",
    tier: "extended",
    async run(ctx, _a): Promise<TestVerdict | void> {
      // top_k, min_p and repetition_penalty: the three near-universal
      // non-OpenAI samplers (vLLM, SGLang, llama.cpp, Ollama, LM Studio).
      // Credit-only — no spec owns them — and the label says which flag was
      // proven versus merely echoed back, so acceptance never reads as an
      // endorsement. top_k: 1 gets the behavioral check (greedy twice); a
      // behavioral check for the other two is not worth the requests.
      const request = {
        turns: [
          { type: "user" as const, text: "Invent a two-word band name." },
        ],
        temperature: 1,
        maxTokens: 24,
        extra: { top_k: 1, min_p: 0.05, repetition_penalty: 1.05 },
      };
      const credit = (label: string): TestVerdict => ({
        credit: {
          id: "chat-sampling-extensions",
          label: `sampling extensions: ${label}`,
        },
      });

      const first = await ctx.send("chat", request);
      if (first.status >= 400) {
        return credit("rejected (top_k, min_p, repetition_penalty)");
      }
      const second = await ctx.send("chat", request);
      return first.reply.text === second.reply.text
        ? credit(
            "top_k honored; min_p, repetition_penalty accepted (acceptance only)",
          )
        : credit(
            "accepted and ignored — top_k: 1 did not force greedy decoding",
          );
    },
  },
];
