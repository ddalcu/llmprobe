import type { SurfaceAdapter } from "../core/adapter";
import {
  approxTextSimilarity,
  detectReasoningLeak,
  Inconclusive,
  isLengthStyleFinish,
  runConcurrent,
  tryParseJson,
  Unsupported,
} from "../core/assert";
import type { ConformanceTest } from "../core/context";
import { checkSSEFraming } from "../core/sse";
import {
  BOOKING_TOOL,
  PERSON_SCHEMA,
  TIME_TOOL,
  TINY_PNG_DATA_URL,
  WEATHER_TOOL,
} from "./fixtures";

/**
 * Conformance tests written once against the adapter contract, so the same
 * assertions run against chat/completions, Responses, and Messages.
 *
 * The governing principle throughout: wherever a check is really about the
 * engine, the model's hand is forced (`tool_choice: "required"`, `max_tokens:
 * 1`, temperature 0) so a weak model cannot corrupt the engine's score. Where
 * that is impossible and the model simply won't cooperate, the test throws
 * `Inconclusive` rather than guessing.
 */

/**
 * Prefix caches survive across llmprobe invocations, so any test whose subject
 * is a *cold* prefill must make its prompt unique per run.
 */
const runNonce =
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/**
 * The largest draft block a real speculator emits per decode step — MTP,
 * EAGLE, Medusa and prompt-lookahead all sit well inside this. Used only to
 * decide whether a max_tokens overshoot is worth naming as speculation rather
 * than leaving as a bare number.
 */
const MAX_SPECULATIVE_BLOCK = 8;

/**
 * How far a logprob may move between the streaming and non-streaming paths
 * before it stops being float noise. Generous on purpose: the two paths can
 * batch differently, and the check that matters is the token sequence.
 */
const LOGPROB_TOLERANCE = 0.01;

interface LogprobEntry {
  token: string;
  logprob: number;
}

/** The per-token entries of an OpenAI-shaped `logprobs`, or none. */
function logprobEntries(logprobs: unknown): LogprobEntry[] {
  const content = (logprobs as { content?: unknown } | null | undefined)
    ?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter(
      (e): e is { token?: unknown; logprob: number } =>
        typeof (e as { logprob?: unknown })?.logprob === "number",
    )
    .map((e) => ({ token: String(e.token ?? ""), logprob: e.logprob }));
}

export function sharedTests(
  adapter: SurfaceAdapter,
  /** Only the engine's primary chat-shaped surface claims the shared features. */
  claimsFeatures: boolean,
): ConformanceTest[] {
  const s = adapter.id;
  const feature = (id: string) => (claimsFeatures ? id : undefined);
  const tests: ConformanceTest[] = [];

  // ── basic response shape ──────────────────────────────────────────────────

  tests.push({
    id: `${s}-basic`,
    name: `${adapter.label}: basic completion`,
    surface: s,
    tier: "core",
    quick: true,
    async run(ctx, a) {
      const res = await ctx.send(s, {
        turns: [{ type: "user", text: "Say hello in exactly one word." }],
        temperature: 0,
        maxTokens: 16,
      });

      a.must(
        `${s}-status-200`,
        "returns 200",
        res.status === 200,
        `got HTTP ${res.status}: ${res.text.slice(0, 200)}`,
      );
      if (res.status !== 200) return;

      a.schema(
        `${s}-schema`,
        "response matches the spec schema",
        adapter.responseSchema,
        res.raw,
      );
      a.must(
        `${s}-id`,
        "response carries an id",
        typeof res.reply.id === "string" && res.reply.id.length > 0,
        "id missing or empty",
      );
      a.must(
        `${s}-text`,
        "response carries assistant text",
        res.reply.text.length > 0,
        "assistant text was empty",
      );
    },
  });

  // ── streaming + SSE framing ───────────────────────────────────────────────

  tests.push({
    id: `${s}-streaming`,
    name: `${adapter.label}: streaming + SSE framing`,
    surface: s,
    tier: "core",
    feature: feature("streaming"),
    quick: true,
    async run(ctx, a) {
      const { reply, stream } = await ctx.sendStream(s, {
        turns: [{ type: "user", text: "Count from 1 to 5." }],
        temperature: 0,
        maxTokens: 64,
      });

      if (stream.status !== 200) {
        a.must(
          `${s}-stream-status`,
          "streaming returns 200",
          false,
          `got HTTP ${stream.status}`,
        );
        return {
          featureSupported: false,
          unsupportedDetail: `streaming returned ${stream.status}`,
        };
      }

      a.must(
        `${s}-stream-content-type`,
        "streams as text/event-stream",
        stream.contentType.includes("text/event-stream"),
        `content-type was "${stream.contentType}"`,
      );

      // Framing is checked from the raw bytes. A parser that already normalised
      // the frames away cannot tell you whether they were framed correctly.
      for (const issue of checkSSEFraming(stream.raw, {
        expectDone: adapter.capabilities.streamEndsWithDone,
      })) {
        a.must(`${s}-${issue.id}`, "SSE framing", false, issue.message);
      }

      a.must(
        `${s}-stream-frames`,
        "stream carries payload frames",
        reply.frameCount > 0,
        "no data frames in the stream",
      );
      a.must(
        `${s}-stream-chunk-json`,
        "every frame is valid JSON",
        reply.errors.length === 0,
        reply.errors.join("; "),
      );

      for (const payload of (reply.raw as unknown[]).slice(0, 12)) {
        a.schema(
          `${s}-stream-chunk-schema`,
          "streamed frames match the spec schema",
          adapter.chunkSchema,
          payload,
        );
      }

      a.must(
        `${s}-stream-text`,
        "streamed deltas reassemble into text",
        reply.text.length > 0,
        "reassembled text was empty",
      );
    },
  });

  // ── streaming ↔ non-streaming parity ──────────────────────────────────────

  tests.push({
    id: `${s}-parity`,
    name: `${adapter.label}: streaming matches non-streaming`,
    surface: s,
    tier: "core",
    async run(ctx, a) {
      const prompt = "Name the capital of France. Reply with just the city.";
      const [plain, streamed] = await Promise.all([
        ctx.send(s, {
          turns: [{ type: "user", text: prompt }],
          temperature: 0,
          maxTokens: 16,
        }),
        ctx.sendStream(s, {
          turns: [{ type: "user", text: prompt }],
          temperature: 0,
          maxTokens: 16,
          includeUsage: true,
        }),
      ]);

      const similarity = approxTextSimilarity(
        plain.reply.text,
        streamed.reply.text,
      );
      a.must(
        `${s}-parity-text`,
        "streamed and non-streamed text agree",
        similarity >= 0.5,
        `similarity ${similarity.toFixed(2)}: "${plain.reply.text.slice(0, 60)}" vs "${streamed.reply.text.slice(0, 60)}"`,
      );

      a.must(
        `${s}-parity-finish`,
        "streamed and non-streamed finish reasons agree",
        plain.reply.finishReason === streamed.reply.finishReason,
        `${plain.reply.finishReason} vs ${streamed.reply.finishReason}`,
      );
    },
  });

  // ── usage ─────────────────────────────────────────────────────────────────

  tests.push({
    id: `${s}-usage`,
    name: `${adapter.label}: usage tokens`,
    surface: s,
    tier: "core",
    feature: feature("usage"),
    async run(ctx, a) {
      const res = await ctx.send(s, {
        turns: [{ type: "user", text: "Say hi." }],
        temperature: 0,
        maxTokens: 16,
      });

      const { inputTokens, outputTokens } = res.reply.usage;

      if (inputTokens === null && outputTokens === null) {
        a.must(
          `${s}-usage-present`,
          "reports token usage",
          false,
          "no usage block in the response",
        );
        return {
          featureSupported: false,
          unsupportedDetail: "no usage reported",
        };
      }

      a.must(
        `${s}-usage-input`,
        "reports input tokens",
        typeof inputTokens === "number" && inputTokens > 0,
        `input tokens: ${inputTokens}`,
      );
      a.must(
        `${s}-usage-output`,
        "reports output tokens",
        typeof outputTokens === "number" && outputTokens > 0,
        `output tokens: ${outputTokens}`,
      );

      // A caller budgeting on usage needs the total to actually be the total.
      const raw = res.raw as any;
      const total = raw?.usage?.total_tokens;
      if (
        typeof total === "number" &&
        typeof inputTokens === "number" &&
        typeof outputTokens === "number"
      ) {
        a.must(
          `${s}-usage-total`,
          "total_tokens equals input + output",
          total === inputTokens + outputTokens,
          `${total} !== ${inputTokens} + ${outputTokens}`,
        );
      }

      // Sub-counts that exceed their parent are arithmetic lies with the same
      // cost: budgets and cache-hit dashboards silently go wrong.
      const { cachedInputTokens, reasoningTokens } = res.reply.usage;
      if (cachedInputTokens !== null && typeof inputTokens === "number") {
        a.must(
          `${s}-usage-cached-bound`,
          "cached tokens do not exceed input tokens",
          cachedInputTokens <= inputTokens,
          `cached_tokens ${cachedInputTokens} > prompt_tokens ${inputTokens}`,
        );
      }
      if (reasoningTokens !== null && typeof outputTokens === "number") {
        a.must(
          `${s}-usage-reasoning-bound`,
          "reasoning tokens do not exceed output tokens",
          reasoningTokens <= outputTokens,
          `reasoning_tokens ${reasoningTokens} > completion_tokens ${outputTokens}`,
        );
      }
    },
  });

  tests.push({
    id: `${s}-stream-usage`,
    name: `${adapter.label}: usage reported while streaming`,
    surface: s,
    tier: "extended",
    feature: feature("stream-usage"),
    async run(ctx, a) {
      const { reply } = await ctx.sendStream(s, {
        turns: [{ type: "user", text: "Say hi." }],
        temperature: 0,
        maxTokens: 16,
        includeUsage: true,
      });

      const reported = reply.usage.outputTokens !== null;
      if (!reported) {
        return {
          featureSupported: false,
          unsupportedDetail:
            "no usage on the stream (stream_options.include_usage ignored)",
        };
      }

      a.must(
        `${s}-stream-usage-output`,
        "streamed usage carries output tokens",
        (reply.usage.outputTokens ?? 0) > 0,
        "output tokens were zero",
      );
    },
  });

  // ── finish reasons and limits (model's hand forced) ───────────────────────

  tests.push({
    id: `${s}-finish-length`,
    name: `${adapter.label}: length finish reason`,
    surface: s,
    tier: "core",
    feature: feature("finish-reasons"),
    quick: true,
    async run(ctx, a) {
      // max_tokens=1 removes the model from the equation entirely: any model
      // truncated at one token must report a length-style finish.
      const res = await ctx.send(s, {
        turns: [{ type: "user", text: "Write a long essay about the sea." }],
        temperature: 0,
        maxTokens: 1,
        // Truncation IS the subject here — no thinking headroom.
        allowReasoning: false,
      });

      const reason = res.reply.finishReason;
      a.must(
        `${s}-finish-present`,
        "reports a finish reason",
        typeof reason === "string" && reason.length > 0,
        "finish reason was null",
      );
      if (!reason) return;

      a.must(
        `${s}-finish-is-length`,
        "truncation reports a length-style finish reason",
        isLengthStyleFinish(reason),
        `expected length/max_tokens, got "${reason}"`,
      );
    },
  });

  tests.push({
    id: `${s}-limits-max-tokens`,
    name: `${adapter.label}: max_tokens is honored`,
    surface: s,
    tier: "core",
    feature: feature("limits"),
    async run(ctx, a) {
      const res = await ctx.send(s, {
        turns: [{ type: "user", text: "Count from 1 to 100." }],
        temperature: 0,
        maxTokens: 8,
        // We are checking the cap is honoured; headroom would defeat the point.
        allowReasoning: false,
      });

      const output = res.reply.usage.outputTokens;
      if (typeof output === "number") {
        // Some engines count a trailing token or two; a small allowance keeps
        // this honest without letting a 200-token response through.
        //
        // The usual cause of a near miss is speculative decoding: an engine
        // that accepts a k-token draft block finishes the block before it
        // rechecks the limit, so it lands anywhere up to 8 + k - 1 and the
        // exact figure moves with KV state and load. That is still a real
        // violation — budget enforcement and paid endpoints depend on this cap
        // — so the overshoot is named rather than tolerated.
        const speculative =
          output > 12 && output <= 8 + MAX_SPECULATIVE_BLOCK
            ? " — consistent with a speculative draft block overrunning the cap"
            : "";
        a.must(
          `${s}-max-tokens-respected`,
          "max_tokens caps the output",
          output <= 12,
          `asked for 8 tokens, got ${output}${speculative}`,
        );
      } else {
        a.should(
          `${s}-max-tokens-unverifiable`,
          "usage lets us verify max_tokens",
          false,
          "no output token count to check against",
        );
      }
    },
  });

  if (adapter.id !== "responses") {
    // Responses has no stop-sequence parameter.
    tests.push({
      id: `${s}-limits-stop`,
      name: `${adapter.label}: stop sequences are honored`,
      surface: s,
      tier: "core",
      feature: feature("limits"),
      async run(ctx, a) {
        const res = await ctx.send(s, {
          turns: [{ type: "user", text: "Say exactly: alpha beta gamma" }],
          temperature: 0,
          maxTokens: 32,
          stop: ["beta"],
        });

        a.must(
          `${s}-stop-honored`,
          "output is cut at the stop sequence",
          !res.reply.text.includes("beta"),
          `stop sequence "beta" appeared in the output: "${res.reply.text.slice(0, 80)}"`,
        );
      },
    });
  }

  tests.push({
    id: `${s}-unicode`,
    name: `${adapter.label}: unicode round-trips intact`,
    surface: s,
    tier: "core",
    async run(ctx, a) {
      const needle = "日本語 · émoji 🎉 · «quotes»";
      const res = await ctx.send(s, {
        turns: [
          {
            type: "user",
            text: `Repeat this text exactly, nothing else: ${needle}`,
          },
        ],
        temperature: 0,
        maxTokens: 64,
      });

      // The model may decline to repeat it, but any *encoding* damage shows up
      // as replacement characters or mojibake regardless of what it said.
      a.must(
        `${s}-unicode-no-mojibake`,
        "no encoding damage in the response",
        !res.reply.text.includes("�"),
        "response contained U+FFFD replacement characters",
      );
    },
  });

  // ── errors ────────────────────────────────────────────────────────────────

  tests.push({
    id: `${s}-errors`,
    name: `${adapter.label}: error codes and shapes`,
    surface: s,
    tier: "core",
    feature: feature("errors"),
    quick: true,
    async run(ctx, a) {
      const malformed = await ctx.raw(s, {
        model: ctx.config.model,
        messages: "not-an-array",
        input: 42,
      });

      a.must(
        `${s}-error-status`,
        "a malformed request is rejected with 4xx",
        malformed.status >= 400 && malformed.status < 500,
        `got HTTP ${malformed.status} — a malformed body must not succeed`,
      );

      const body = malformed.json as any;
      a.must(
        `${s}-error-object`,
        "errors come back as a JSON error object",
        body?.error !== undefined || body?.type === "error",
        `error body was: ${malformed.text.slice(0, 160)}`,
      );

      const message = body?.error?.message ?? body?.error;
      a.should(
        `${s}-error-message`,
        "the error carries a human-readable message",
        typeof message === "string" && message.length > 0,
        "no message field on the error",
      );
    },
  });

  // ── tools (forced, so this measures the engine and not the model) ─────────

  if (adapter.capabilities.tools) {
    tests.push({
      id: `${s}-tool-serialization`,
      name: `${adapter.label}: tool call serialization`,
      surface: s,
      tier: "core",
      feature: feature("tools"),
      quick: true,
      async run(ctx, a) {
        const res = await ctx.send(s, {
          turns: [{ type: "user", text: "What's the weather in Paris?" }],
          tools: [WEATHER_TOOL],
          // Forcing the call is what makes this an engine test: the model has no
          // say in whether a tool call happens, only in its arguments.
          toolChoice: "required",
          temperature: 0,
          maxTokens: 128,
        });

        if (res.status !== 200) {
          return {
            featureSupported: false,
            unsupportedDetail: `rejects tools with HTTP ${res.status}`,
          };
        }

        const calls = res.reply.toolCalls;
        if (calls.length === 0) {
          // We forced it and still got nothing. We have learned nothing about
          // the engine's serialization, so we score nothing.
          throw new Inconclusive(
            'no tool call emitted even under tool_choice: "required"',
          );
        }

        const call = calls[0]!;
        a.must(
          `${s}-tool-id`,
          "tool call carries an id",
          call.id.length > 0,
          "tool call id was empty",
        );
        a.must(
          `${s}-tool-name`,
          "tool call names the requested tool",
          call.name === WEATHER_TOOL.name,
          `called "${call.name}"`,
        );

        // On OpenAI-shaped surfaces the spec says `arguments` is a JSON
        // *string*. An engine that sends a bare object breaks every SDK that
        // calls JSON.parse on it — and it's a common shortcut. (Anthropic's
        // `input` is legitimately an object, hence the capability check.)
        if (adapter.capabilities.toolArgsAreJsonString) {
          a.must(
            `${s}-tool-args-string`,
            "tool arguments arrive as a JSON string, not an object",
            typeof call.argsRaw === "string",
            `\`arguments\` was a ${typeof call.argsRaw}, not a string — SDKs that JSON.parse it will break`,
          );
        }

        a.must(
          `${s}-tool-args-json`,
          "tool call arguments are valid JSON",
          tryParseJson(call.argsJson).ok,
          `arguments were not parseable JSON: ${String(call.argsJson).slice(0, 120)}`,
        );

        // Only where the spec actually says so. Responses signals a tool call
        // through its output items, not through a finish reason, so demanding
        // one there would fail a perfectly compliant engine.
        if (adapter.capabilities.signalsToolFinishReason) {
          const reason = res.reply.finishReason;
          // A turn that ended on the token cap reports a length-style finish by
          // spec — OpenAI does the same — so it tells us nothing about what the
          // engine signals when the model stops on its own. Reasoning models
          // land here whenever thinking eats most of the budget: the call is
          // complete and valid, and the cap is ours, not the engine's.
          if (reason !== null && isLengthStyleFinish(reason)) {
            throw new Inconclusive(
              `the turn hit the token cap (finish reason "${reason}"), so the ` +
                "budget decided it — nothing learned about the tool-stop signal",
            );
          }
          a.must(
            `${s}-tool-finish`,
            "a tool call reports a tool-style finish reason",
            reason !== null && /tool|function/i.test(reason),
            `finish reason was "${reason}" — callers dispatch on this`,
          );
        }
      },
    });

    tests.push({
      id: `${s}-tool-stream-reassembly`,
      name: `${adapter.label}: streamed tool arguments reassemble`,
      surface: s,
      tier: "core",
      feature: feature("tools"),
      async run(ctx, a) {
        const { reply, stream } = await ctx.sendStream(s, {
          turns: [{ type: "user", text: "What's the weather in Berlin?" }],
          tools: [WEATHER_TOOL],
          toolChoice: "required",
          temperature: 0,
          maxTokens: 128,
        });

        if (stream.status !== 200) {
          a.must(
            `${s}-tool-stream-status`,
            "streaming with tools returns 200",
            false,
            `HTTP ${stream.status}`,
          );
          return;
        }

        if (reply.toolCalls.length === 0) {
          throw new Inconclusive(
            'no streamed tool call even under tool_choice: "required"',
          );
        }

        const call = reply.toolCalls[0]!;
        // The classic engine bug: argument fragments dropped or reordered
        // across chunks, yielding JSON that never parses.
        a.must(
          `${s}-tool-stream-args`,
          "argument fragments reassemble into valid JSON",
          tryParseJson(call.argsJson).ok,
          `reassembled arguments were not valid JSON: ${call.argsJson.slice(0, 120)}`,
        );
        a.must(
          `${s}-tool-stream-name`,
          "streamed tool call carries the tool name",
          call.name === WEATHER_TOOL.name,
          `got "${call.name}"`,
        );
      },
    });

    tests.push({
      id: `${s}-tool-result-turn`,
      name: `${adapter.label}: tool results are accepted back`,
      surface: s,
      tier: "core",
      feature: feature("tools"),
      async run(ctx, a) {
        // The half of the loop engines most often break: replaying an assistant
        // tool call plus its result and getting a coherent continuation.
        const res = await ctx.send(s, {
          turns: [
            { type: "user", text: "What's the weather in Paris?" },
            {
              type: "assistant-tool-call",
              call: {
                id: "call_1",
                name: WEATHER_TOOL.name,
                argsJson: '{"city":"Paris"}',
              },
            },
            {
              type: "tool-result",
              toolCallId: "call_1",
              toolName: WEATHER_TOOL.name,
              output: '{"temp_c": 18, "conditions": "rain"}',
            },
          ],
          tools: [WEATHER_TOOL],
          temperature: 0,
          maxTokens: 96,
        });

        a.must(
          `${s}-tool-result-status`,
          "accepts a tool-result turn",
          res.status === 200,
          `HTTP ${res.status}: ${res.text.slice(0, 200)}`,
        );
        if (res.status !== 200) return;

        // Empty content plus a length-style finish is a starved budget, not a
        // broken tool-result path: the model was still thinking when the cap
        // arrived. Empty content on a clean stop still fails, as it should.
        if (
          res.reply.text.length === 0 &&
          res.reply.finishReason !== null &&
          isLengthStyleFinish(res.reply.finishReason)
        ) {
          throw new Inconclusive(
            "the continuation hit the token cap before any visible text " +
              `(finish reason "${res.reply.finishReason}")`,
          );
        }

        a.must(
          `${s}-tool-result-continues`,
          "produces a continuation after the tool result",
          res.reply.text.length > 0,
          "no assistant text after the tool result",
        );
      },
    });

    tests.push({
      id: `${s}-parallel-tools`,
      name: `${adapter.label}: parallel tool calls`,
      surface: s,
      tier: "extended",
      feature: feature("parallel-tools"),
      async run(ctx, a) {
        const res = await ctx.send(s, {
          turns: [
            {
              type: "user",
              text: "What's the weather AND the current time in Tokyo? Call both tools.",
            },
          ],
          tools: [WEATHER_TOOL, TIME_TOOL],
          toolChoice: "required",
          parallelToolCalls: true,
          temperature: 0,
          maxTokens: 256,
        });

        if (res.status !== 200) {
          return {
            featureSupported: false,
            unsupportedDetail: `rejects parallel_tool_calls with HTTP ${res.status}`,
          };
        }

        if (res.reply.toolCalls.length < 2) {
          // Emitting one call is a model choice, not an engine defect.
          throw new Inconclusive(
            `model emitted ${res.reply.toolCalls.length} tool call(s); cannot verify parallel serialization`,
          );
        }

        const ids = new Set(res.reply.toolCalls.map((c) => c.id));
        a.must(
          `${s}-parallel-ids-unique`,
          "parallel tool calls have distinct ids",
          ids.size === res.reply.toolCalls.length,
          "duplicate tool-call ids — results cannot be routed back",
        );
        for (const call of res.reply.toolCalls) {
          a.must(
            `${s}-parallel-args-${call.name}`,
            "each parallel call has valid JSON args",
            tryParseJson(call.argsJson).ok,
            `bad args on ${call.name}`,
          );
        }
      },
    });

    tests.push({
      id: `${s}-tool-choice-none`,
      name: `${adapter.label}: tool_choice "none" suppresses tools`,
      surface: s,
      tier: "core",
      feature: feature("tools"),
      async run(ctx, a) {
        // The engine-level counterpart of the model's tool-restraint eval: with
        // tools present but explicitly disabled, no call may come back — a
        // caller that said "none" has no handler wired up for one.
        const res = await ctx.send(s, {
          turns: [
            {
              type: "user",
              text: "What's the weather in Paris? Use the weather tool.",
            },
          ],
          tools: [WEATHER_TOOL],
          toolChoice: "none",
          temperature: 0,
          maxTokens: 96,
        });

        a.must(
          `${s}-tool-none-status`,
          'accepts tool_choice: "none"',
          res.status === 200,
          `HTTP ${res.status}: ${res.text.slice(0, 160)}`,
        );
        if (res.status !== 200) return;

        a.must(
          `${s}-tool-none-suppressed`,
          'no tool call is emitted under tool_choice: "none"',
          res.reply.toolCalls.length === 0,
          `got ${res.reply.toolCalls.length} tool call(s) despite tool_choice: "none"`,
        );
      },
    });

    tests.push({
      id: `${s}-parallel-tools-off`,
      name: `${adapter.label}: parallel_tool_calls: false is honored`,
      surface: s,
      tier: "extended",
      feature: feature("parallel-tools"),
      async run(ctx, a) {
        // The disable direction of the parallel-tools switch. An engine that
        // accepts `false` and still emits several calls breaks callers built
        // around one-call-at-a-time dispatch.
        const res = await ctx.send(s, {
          turns: [
            {
              type: "user",
              text: "What's the weather AND the current time in Tokyo? Call both tools.",
            },
          ],
          tools: [WEATHER_TOOL, TIME_TOOL],
          toolChoice: "required",
          parallelToolCalls: false,
          temperature: 0,
          maxTokens: 256,
        });

        if (res.status !== 200) {
          return {
            featureSupported: false,
            unsupportedDetail: `rejects parallel_tool_calls: false with HTTP ${res.status}`,
          };
        }

        if (res.reply.toolCalls.length === 0) {
          throw new Inconclusive(
            'no tool call emitted even under tool_choice: "required"',
          );
        }

        a.must(
          `${s}-parallel-off-single`,
          "disabling parallel calls yields at most one call",
          res.reply.toolCalls.length === 1,
          `got ${res.reply.toolCalls.length} tool calls with parallel_tool_calls: false`,
        );
      },
    });

    tests.push({
      id: `${s}-tool-arg-types`,
      name: `${adapter.label}: typed tool arguments survive the wire`,
      surface: s,
      tier: "extended",
      async run(ctx, a) {
        const res = await ctx.send(s, {
          turns: [
            {
              type: "user",
              text: "Book a table at Chez Nous for 4 people, outdoors.",
            },
          ],
          tools: [BOOKING_TOOL],
          toolChoice: { name: BOOKING_TOOL.name },
          temperature: 0,
          maxTokens: 128,
        });

        if (res.reply.toolCalls.length === 0) {
          throw new Inconclusive(
            "model emitted no call even with a named tool_choice",
          );
        }

        const parsed = tryParseJson(res.reply.toolCalls[0]!.argsJson);
        if (!parsed.ok) {
          a.must(
            `${s}-typed-args-json`,
            "typed tool args are valid JSON",
            false,
            "arguments did not parse",
          );
          return;
        }

        // Engines that stringify everything break callers that trust the schema.
        const args = parsed.value as Record<string, unknown>;
        if (args.party_size !== undefined) {
          a.must(
            `${s}-typed-args-number`,
            "an integer argument stays a number",
            typeof args.party_size === "number",
            `party_size came back as ${typeof args.party_size} (${JSON.stringify(args.party_size)})`,
          );
        }
        if (args.outdoor !== undefined) {
          a.must(
            `${s}-typed-args-boolean`,
            "a boolean argument stays a boolean",
            typeof args.outdoor === "boolean",
            `outdoor came back as ${typeof args.outdoor} (${JSON.stringify(args.outdoor)})`,
          );
        }
      },
    });
  }

  // ── structured output ─────────────────────────────────────────────────────

  if (adapter.capabilities.jsonMode) {
    tests.push({
      id: `${s}-json-mode`,
      name: `${adapter.label}: JSON mode`,
      surface: s,
      tier: "core",
      feature: feature("json-mode"),
      async run(ctx, a) {
        const res = await ctx.send(s, {
          turns: [
            {
              type: "user",
              text: 'Return a JSON object with keys "name" (a string) and "age" (a number).',
            },
          ],
          responseFormat: { type: "json_object" },
          temperature: 0,
          maxTokens: 128,
        });

        if (res.status >= 400) {
          return {
            featureSupported: false,
            unsupportedDetail: `rejects json_object with HTTP ${res.status}`,
          };
        }

        // In JSON mode the engine guarantees parseable JSON — no fences, no
        // prose. Stripping fences here would paper over an engine defect.
        a.must(
          `${s}-json-mode-parses`,
          "JSON mode returns parseable JSON",
          tryParseJson(res.reply.text).ok,
          `not valid JSON: ${res.reply.text.slice(0, 120)}`,
        );
      },
    });
  }

  if (adapter.capabilities.jsonSchema) {
    tests.push({
      id: `${s}-structured-outputs`,
      name: `${adapter.label}: structured outputs (json_schema strict)`,
      surface: s,
      tier: "extended",
      feature: feature("structured-outputs"),
      async run(ctx, a) {
        const res = await ctx.send(s, {
          turns: [{ type: "user", text: "Invent a person." }],
          responseFormat: {
            type: "json_schema",
            name: "person",
            schema: PERSON_SCHEMA as unknown as Record<string, unknown>,
          },
          temperature: 0,
          maxTokens: 128,
        });

        if (res.status >= 400) {
          return {
            featureSupported: false,
            unsupportedDetail: `rejects json_schema with HTTP ${res.status}`,
          };
        }

        const parsed = tryParseJson(res.reply.text);
        if (!parsed.ok) {
          a.must(
            `${s}-structured-parses`,
            "structured output is valid JSON",
            false,
            `not JSON: ${res.reply.text.slice(0, 120)}`,
          );
          return;
        }

        // "strict" means the engine constrains decoding. If it merely asked
        // nicely, the schema won't hold — and callers will crash on it.
        const value = parsed.value as Record<string, unknown>;
        a.must(
          `${s}-structured-name`,
          "required string field is present and typed",
          typeof value.name === "string",
          `name was ${typeof value.name}`,
        );
        a.must(
          `${s}-structured-age`,
          "required integer field is present and typed",
          typeof value.age === "number",
          `age was ${typeof value.age}`,
        );
        a.must(
          `${s}-structured-no-extras`,
          "no properties beyond the schema (additionalProperties: false)",
          Object.keys(value).every((k) => k === "name" || k === "age"),
          `extra keys: ${Object.keys(value)
            .filter((k) => k !== "name" && k !== "age")
            .join(", ")}`,
        );
      },
    });
  }

  // ── vision ────────────────────────────────────────────────────────────────

  if (adapter.capabilities.vision) {
    tests.push({
      id: `${s}-vision`,
      name: `${adapter.label}: image input`,
      surface: s,
      tier: "extended",
      feature: feature("vision"),
      async run(ctx, a) {
        const res = await ctx.send(s, {
          turns: [
            {
              type: "user-image",
              text: "Describe this image in one word.",
              imageDataUrl: TINY_PNG_DATA_URL,
            },
          ],
          temperature: 0,
          maxTokens: 32,
        });

        if (res.status >= 400) {
          return {
            featureSupported: false,
            unsupportedDetail: `rejects image content with HTTP ${res.status}`,
          };
        }

        a.must(
          `${s}-vision-answers`,
          "returns a response to a multimodal request",
          res.reply.text.length > 0,
          "empty response to an image prompt",
        );
      },
    });
  }

  // ── logprobs ──────────────────────────────────────────────────────────────

  if (adapter.capabilities.logprobs) {
    tests.push({
      id: `${s}-logprobs`,
      name: `${adapter.label}: logprobs`,
      surface: s,
      tier: "extended",
      feature: feature("logprobs"),
      async run(ctx, a) {
        const res = await ctx.send(s, {
          turns: [{ type: "user", text: "Say hi." }],
          logprobs: true,
          temperature: 0,
          maxTokens: 8,
        });

        // An honest 400 is fine — the engine told us it can't. Not a defect.
        if (res.status >= 400) {
          return {
            featureSupported: false,
            unsupportedDetail: `rejects logprobs with HTTP ${res.status}`,
          };
        }

        const returned = res.reply.logprobs != null;
        if (!returned) {
          // The trap: 200 OK, no logprobs, no warning. A caller cannot detect
          // this without inspecting every response. Costs coverage AND
          // conformance — the one place we deliberately charge twice.
          a.must(
            `${s}-logprobs-not-ignored`,
            "logprobs are honored when requested",
            false,
            "accepted `logprobs: true` with HTTP 200 but returned no logprobs — a silent no-op is worse than a clean rejection",
          );
          return {
            featureSupported: false,
            unsupportedDetail: "accepted `logprobs` but returned none",
          };
        }

        const content = (res.reply.logprobs as any)?.content;
        a.must(
          `${s}-logprobs-shape`,
          "logprobs carry per-token entries",
          Array.isArray(content) && content.length > 0,
          "logprobs object had no content array",
        );

        // Everything above only proves the non-streaming path. Streaming is
        // where a dropped logprob actually hides: the content deltas are
        // byte-identical with or without it, so no output check can see the
        // difference, and the caller has no way to detect it short of
        // inspecting every response. It is also strictly worse than an honest
        // rejection — asking for logprobs disables speculative decoding, so
        // the engine pays the full serial-decode cost and then delivers
        // nothing.
        const streamed = await ctx.sendStream(s, {
          turns: [{ type: "user", text: "Say hi." }],
          logprobs: true,
          temperature: 0,
          maxTokens: 8,
        });

        if (streamed.stream.status >= 400) {
          // Refusing the combination outright is at least detectable. It costs
          // a warning, not a MUST — the same courtesy an honest 400 gets above.
          a.should(
            `${s}-logprobs-streaming-status`,
            "logprobs work on the streaming path too",
            false,
            `accepted logprobs without \`stream\` but rejected the same request with \`stream: true\` (HTTP ${streamed.stream.status})`,
          );
          return;
        }

        const streamEntries = logprobEntries(streamed.reply.logprobs);
        a.must(
          `${s}-logprobs-streaming`,
          "logprobs are returned when streaming",
          streamEntries.length > 0,
          "returned logprobs for a plain request and none for the identical streaming one — a silent drop no output check can see, on a request that already paid for logprobs by disabling speculative decoding",
        );

        if (streamEntries.length === 0) return;

        // Presence is the weak half. Comparing the two paths token-for-token
        // and value-for-value is what catches a partial drain, a duplicated
        // entry, or an off-by-one high-water mark.
        const plainEntries = logprobEntries(res.reply.logprobs);
        if (plainEntries.length === 0 || streamed.reply.text !== res.reply.text)
          return;

        const tokens = (entries: LogprobEntry[]) =>
          entries.map((e) => e.token).join("\u241f");

        a.must(
          `${s}-logprobs-stream-parity`,
          "streamed logprobs match the non-streamed ones",
          tokens(streamEntries) === tokens(plainEntries),
          `the same greedy request produced ${plainEntries.length} logprob ${plainEntries.length === 1 ? "entry" : "entries"} without streaming and ${streamEntries.length} with it (${JSON.stringify(tokens(streamEntries).slice(0, 120))} vs ${JSON.stringify(tokens(plainEntries).slice(0, 120))})`,
        );

        if (tokens(streamEntries) !== tokens(plainEntries)) return;

        // Same tokens, different numbers. A SHOULD: the two paths can batch
        // differently, and near-tie float noise is not a conformance bug.
        const worst = streamEntries.reduce(
          (max, e, i) =>
            Math.max(max, Math.abs(e.logprob - plainEntries[i]!.logprob)),
          0,
        );
        a.should(
          `${s}-logprobs-stream-values`,
          "streamed logprob values match the non-streamed ones",
          worst <= LOGPROB_TOLERANCE,
          `same tokens, but a logprob differed by ${worst.toFixed(4)} nats between the streaming and non-streaming paths`,
        );
      },
    });
  }

  // ── seed determinism ──────────────────────────────────────────────────────

  if (adapter.capabilities.seed) {
    tests.push({
      id: `${s}-seed`,
      name: `${adapter.label}: seed determinism`,
      surface: s,
      tier: "extended",
      feature: feature("seed"),
      async run(ctx, a) {
        const request = {
          turns: [
            { type: "user" as const, text: "Invent a two-word band name." },
          ],
          seed: 42,
          temperature: 0,
          maxTokens: 24,
        };

        const first = await ctx.send(s, request);
        if (first.status >= 400) {
          return {
            featureSupported: false,
            unsupportedDetail: `rejects seed with HTTP ${first.status}`,
          };
        }
        const second = await ctx.send(s, request);

        a.must(
          `${s}-seed-deterministic`,
          "the same seed reproduces the same output",
          first.reply.text === second.reply.text,
          `same seed produced different text: "${first.reply.text.slice(0, 40)}" vs "${second.reply.text.slice(0, 40)}"`,
        );
      },
    });
  }

  // ── top_p ─────────────────────────────────────────────────────────────────

  tests.push({
    id: `${s}-top-p`,
    name: `${adapter.label}: top_p is honored`,
    surface: s,
    tier: "extended",
    feature: feature("sampling"),
    async run(ctx, a) {
      // A near-zero nucleus collapses sampling to greedy, so two runs at
      // temperature 1 must agree. If the engine accepted `top_p` and the
      // outputs still diverge, the parameter was silently dropped — the same
      // trap as ignored logprobs, and it charges the same way: coverage AND
      // conformance.
      const request = {
        turns: [
          { type: "user" as const, text: "Invent a two-word band name." },
        ],
        temperature: 1,
        topP: 1e-6,
        maxTokens: 24,
      };

      const first = await ctx.send(s, request);
      if (first.status >= 400) {
        return {
          featureSupported: false,
          unsupportedDetail: `rejects top_p with HTTP ${first.status}`,
        };
      }
      const second = await ctx.send(s, request);

      if (first.reply.text !== second.reply.text) {
        a.must(
          `${s}-top-p-not-ignored`,
          "top_p is honored when requested",
          false,
          `temperature 1 with top_p≈0 should decode greedily, but two runs differ: "${first.reply.text.slice(0, 40)}" vs "${second.reply.text.slice(0, 40)}"`,
        );
        return {
          featureSupported: false,
          unsupportedDetail: "accepted `top_p` but sampling stayed random",
        };
      }
    },
  });

  // ── reasoning channel ─────────────────────────────────────────────────────

  tests.push({
    id: `${s}-reasoning`,
    name: `${adapter.label}: reasoning is kept out of content`,
    surface: s,
    tier: "extended",
    feature: feature("reasoning"),
    async run(ctx, a) {
      const turns = [
        {
          type: "user" as const,
          text: "What is 17 * 3? Think it through, then answer.",
        },
      ];

      // The opt-in ladder. Some engines (mlx-serve) ship thinking disabled by
      // default and strip think blocks from the output unless asked, so a
      // plain request under-reports the feature. Rung 1 is the plain request;
      // rung 2 retries with the surface's spec-standard opt-in
      // (reasoning_effort / reasoning.effort / thinking). Vendor toggles like
      // `enable_thinking` are never sent — a feature reachable only through a
      // non-standard knob does not earn the standard's coverage line.
      let res = await ctx.send(s, { turns, temperature: 0, maxTokens: 256 });

      const channelIn = (r: typeof res) =>
        r.reply.reasoningText !== null ||
        r.reply.usage.reasoningTokens !== null;

      let hasChannel = channelIn(res);
      let optInStatus: number | null = null;

      if (!hasChannel && adapter.reasoningOptIn) {
        const retry = await ctx.send(s, {
          turns,
          temperature: 0,
          // Room to think AND answer without headroom: the messages opt-in
          // carries a 256-token budget, and max_tokens must exceed it.
          maxTokens: 640,
          allowReasoning: false,
          extra: adapter.reasoningOptIn,
        });
        optInStatus = retry.status;
        if (retry.status === 200 && channelIn(retry)) {
          res = retry;
          hasChannel = true;
        }
      }

      if (!hasChannel) {
        return {
          featureSupported: false,
          unsupportedDetail:
            optInStatus !== null && optInStatus >= 400
              ? `no reasoning channel; the standard opt-in was rejected with HTTP ${optInStatus}`
              : "no separate reasoning channel, even with the standard opt-in",
        };
      }

      // The engine bug this catches: chain-of-thought leaking into the visible
      // content, so every caller renders the model's scratchpad to end users.
      const leaked = detectReasoningLeak(res.reply.text);
      a.must(
        `${s}-reasoning-not-leaked`,
        "reasoning does not leak into the visible content",
        leaked.tag === null,
        `found a raw ${leaked.tag} wrapper inside the assistant content`,
      );
    },
  });

  // ── scratchpad in content (core) ──────────────────────────────────────────

  tests.push({
    id: `${s}-reasoning-scratchpad`,
    name: `${adapter.label}: the answer is an answer, not a scratchpad`,
    surface: s,
    tier: "core",
    async run(ctx, a) {
      // Deliberately separate from the reasoning test above, for two reasons.
      // That one asks the model to "think it through", which invites
      // deliberation into content and so cannot detect a leak; and it gives up
      // before this check whenever the engine has no reasoning channel — which
      // is exactly the case where the thinking has nowhere to go but `content`.
      //
      // Here the prompt forbids anything but the answer, so a reply that opens
      // by narrating its own reasoning is the scratchpad reaching the caller.
      const res = await ctx.send(s, {
        turns: [
          {
            type: "user" as const,
            text: "What is 17 * 3? Reply with only the number and nothing else.",
          },
        ],
        temperature: 0,
        maxTokens: 256,
      });
      if (res.status !== 200) return;

      const leaked = detectReasoningLeak(res.reply.text);
      const excerpt = res.reply.text.trim().slice(0, 80).replace(/\s+/g, " ");

      // A wrapper in content can only be the engine failing to strip a channel
      // it was handed. Nothing else puts `<think>` in an answer.
      a.must(
        `${s}-scratchpad-no-tags`,
        "no thinking wrapper reaches the caller",
        leaked.tag === null,
        `found a raw ${leaked.tag} wrapper in the answer: "${excerpt}"`,
      );

      // Untagged deliberation is the same bug without the markers — but a
      // model that simply ignores "only the number" looks identical from
      // outside the engine, so it warns rather than failing.
      a.should(
        `${s}-scratchpad-no-monologue`,
        "the answer does not open with the model's own deliberation",
        leaked.opener === null,
        `answer opens with chain-of-thought instead of the number: "${excerpt}"`,
      );
    },
  });

  // ── assistant-history reasoning round-trip (extended) ────────────────────

  tests.push({
    id: `${s}-reasoning-roundtrip`,
    name: `${adapter.label}: assistant-history reasoning round-trip`,
    surface: s,
    tier: "extended",
    feature: feature("reasoning-roundtrip"),
    async run(ctx, a) {
      if (!adapter.reasoningHistory) {
        throw new Unsupported("surface has no history-reasoning wire shape");
      }

      // Agent clients (pi, the vLLM SDK flows, Claude Code) round-trip the
      // reasoning an engine emitted straight back on the next request's
      // assistant history — chat as `reasoning_content`, messages as
      // `thinking` blocks. The de-facto open-engine standard (DeepSeek/vLLM
      // lineage) is: accept the field and hand it to the chat template, which
      // decides. Templates that PERSIST reasoning across turns (GLM family,
      // poolside Laguna) render the empty <think></think> "nothink" signature
      // instead when a server drops the field — the model thinks on turn 1 of
      // a session and never again, while every flag reads correct. That drop
      // is observable black-box as a prompt_tokens delta between two requests
      // differing only in the history-reasoning field. Templates that STRIP
      // history reasoning by design (Qwen, Gemma) legitimately show no delta,
      // so "no delta" reads as feature-unsupported for the loaded model,
      // never as a conformance violation.
      const REASONING =
        "The user asked for two plus two. Two plus two equals four, so the " +
        "answer to give is the single digit 4, with no other words.";
      const history = (reasoning?: string) => ({
        turns: [
          {
            type: "user" as const,
            text: "What is 2 + 2? Reply with just the number.",
          },
          { type: "assistant-text" as const, text: "4", reasoning },
          {
            type: "user" as const,
            text: "Add 3 to your last answer. Reply with just the number.",
          },
        ],
        temperature: 0,
        maxTokens: 64,
      });

      const accepted = await ctx.send(s, history(REASONING));
      a.must(
        `${s}-reasoning-roundtrip-no-5xx`,
        "round-tripped reasoning never crashes the server",
        accepted.status < 500,
        `got HTTP ${accepted.status}: ${accepted.text.slice(0, 200)}`,
      );
      if (accepted.status >= 400) {
        // A 4xx is not a spec violation — the field is an extension, and
        // OpenAI's own chat surface rejects unknown message fields — but the
        // engine visibly lacks the feature every reasoning-model agent loop
        // leans on.
        return {
          featureSupported: false,
          unsupportedDetail: `rejects reasoning on assistant history with HTTP ${accepted.status}`,
        };
      }
      a.schema(
        `${s}-reasoning-roundtrip-schema`,
        "response matches the spec schema",
        adapter.responseSchema,
        accepted.raw,
      );

      // Forwarding probe. Run the pair under the surface's standard reasoning
      // opt-in when one exists: reasoning-persisting templates only render
      // history reasoning while thinking is ON (laguna renders a bare
      // </think> otherwise and never reads the field). Falls back to the
      // plain pair when the opt-in is rejected.
      let withR = accepted;
      let withoutR = await ctx.send(s, history(undefined));
      if (adapter.reasoningOptIn) {
        const extra = adapter.reasoningOptIn;
        const r = await ctx.send(s, { ...history(REASONING), extra });
        const b = await ctx.send(s, { ...history(undefined), extra });
        if (r.status === 200 && b.status === 200) {
          withR = r;
          withoutR = b;
        }
      }
      if (withoutR.status !== 200) return; // baseline failed for unrelated reasons — nothing more to learn

      const pIn = withR.reply.usage.inputTokens;
      const bIn = withoutR.reply.usage.inputTokens;
      if (pIn === null || bIn === null) {
        return {
          featureSupported: false,
          unsupportedDetail:
            "no prompt-token reporting, so forwarding is unobservable",
        };
      }
      if (pIn <= bIn) {
        return {
          featureSupported: false,
          unsupportedDetail:
            "prompt_tokens identical with and without history reasoning — " +
            "the field is dropped before the chat template, or this " +
            "model's template strips history reasoning by design",
        };
      }
    },
  });

  // ── prompt caching (frontier) ─────────────────────────────────────────────

  tests.push({
    id: `${s}-prompt-caching`,
    name: `${adapter.label}: prompt cache reporting`,
    surface: s,
    tier: "frontier",
    feature: feature("prompt-caching"),
    slow: true,
    async run(ctx, a) {
      const long = "You are a helpful assistant. ".repeat(200);
      const request = {
        turns: [{ type: "user" as const, text: "Say hi." }],
        system: long,
        temperature: 0,
        maxTokens: 8,
        promptCacheKey: "llmprobe-cache-probe",
      };

      const first = await ctx.send(s, request);
      const second = await ctx.send(s, request);

      const cached = second.reply.usage.cachedInputTokens;
      if (cached === null) {
        return {
          featureSupported: false,
          unsupportedDetail: "no cached-token reporting",
        };
      }

      a.must(
        `${s}-cache-hit`,
        "a repeated prefix reports cached tokens",
        cached > 0,
        `cached_tokens was ${cached} on an identical repeated prompt`,
      );

      const input = second.reply.usage.inputTokens;
      if (typeof input === "number") {
        a.must(
          `${s}-cache-bound`,
          "cached tokens do not exceed input tokens",
          cached <= input,
          `cached_tokens ${cached} > prompt_tokens ${input}`,
        );
      }

      // The bug that matters most: reused KV that decodes differently from a
      // cold prefill — a corrupted cache serving wrong answers while every
      // counter looks healthy. SHOULD, not MUST: a cache hit can legitimately
      // take a different kernel path, and a flipped token from numerics alone
      // is not spec non-conformance. Real corruption diverges wildly and shows
      // up here loudly.
      if (cached > 0) {
        // Compared on the text the two runs share, not on raw equality. A warm
        // answer that is a prefix of the cold one is the same continuation
        // stopped earlier, which speculative decoding makes routine: the
        // truncation point follows the draft block boundary, and that boundary
        // lands differently on a warm prefill than a cold one. Corruption
        // diverges *inside* the shared text; stopping short does not.
        const cold = first.reply.text;
        const warm = second.reply.text;
        const shared = Math.min(cold.length, warm.length);
        const agrees =
          cold === warm ||
          (shared > 0 && cold.slice(0, shared) === warm.slice(0, shared));

        let diverged = 0;
        while (diverged < shared && cold[diverged] === warm[diverged]) {
          diverged += 1;
        }

        a.should(
          `${s}-cache-correct`,
          "a cache hit does not change the answer",
          agrees,
          `warm answer diverges from cold at temperature 0 after ${diverged} chars: "${cold.slice(0, 40)}" vs "${warm.slice(0, 40)}"`,
        );
      }
    },
  });

  tests.push({
    id: `${s}-prompt-cache-prefix`,
    name: `${adapter.label}: prefix cache reuses a growing conversation`,
    surface: s,
    tier: "frontier",
    slow: true,
    async run(ctx, a) {
      // The realistic cache pattern: a conversation grows by one turn, and the
      // engine's best-prefix match should reuse everything up to the new
      // tokens. Nonced so a cache from an earlier llmprobe run can never make
      // the "cold" call warm. No feature id here — the reporting test above
      // owns the coverage line, and an exact-match-only cache should not lose
      // it for failing the harder prefix case.
      const system =
        `Conversation ${runNonce}. ` +
        "You are a meticulous archivist. ".repeat(120);
      const q1 = "In one word, what is your role?";

      const first = await ctx.send(s, {
        turns: [{ type: "user", text: q1 }],
        system,
        temperature: 0,
        maxTokens: 32,
      });
      if (first.status !== 200) {
        return {
          featureSupported: false,
          unsupportedDetail: `HTTP ${first.status}`,
        };
      }

      const second = await ctx.send(s, {
        turns: [
          { type: "user", text: q1 },
          { type: "assistant-text", text: first.reply.text || "An archivist." },
          {
            type: "user",
            text: "Thanks. In one word, name your favourite tool.",
          },
        ],
        system,
        temperature: 0,
        maxTokens: 32,
      });

      const cached = second.reply.usage.cachedInputTokens;
      if (cached === null) {
        return {
          featureSupported: false,
          unsupportedDetail: "no cached-token reporting",
        };
      }

      a.must(
        `${s}-cache-prefix-hit`,
        "extending a conversation reuses the shared prefix",
        cached > 0,
        `cached_tokens was ${cached} after resending an identical prefix`,
      );

      const input2 = second.reply.usage.inputTokens;
      if (typeof input2 === "number") {
        a.must(
          `${s}-cache-prefix-bound`,
          "cached tokens do not exceed input tokens",
          cached <= input2,
          `cached_tokens ${cached} > prompt_tokens ${input2}`,
        );
      }

      const input1 = first.reply.usage.inputTokens;
      if (cached > 0 && typeof input1 === "number") {
        a.should(
          `${s}-cache-prefix-most`,
          "most of the shared prefix is reused",
          cached >= input1 / 2,
          `only ${cached} of the ~${input1}-token shared prefix was reused`,
        );
      }
    },
  });

  // ── rate limiting (frontier) ──────────────────────────────────────────────

  tests.push({
    id: `${s}-rate-limit-headers`,
    name: `${adapter.label}: rate limit headers`,
    surface: s,
    tier: "frontier",
    feature: feature("rate-limiting"),
    async run(ctx, a) {
      const res = await ctx.send(s, {
        turns: [{ type: "user", text: "Say hi." }],
        temperature: 0,
        maxTokens: 8,
      });

      const names: string[] = [];
      res.headers.forEach((_value, name) => names.push(name));
      const limitHeaders = names.filter((n) => /ratelimit/i.test(n));

      if (limitHeaders.length === 0) {
        return {
          featureSupported: false,
          unsupportedDetail: "no x-ratelimit-* headers",
        };
      }

      a.should(
        `${s}-rate-limit-remaining`,
        "advertises remaining quota",
        limitHeaders.some((n) => /remaining/i.test(n)),
        `saw ${limitHeaders.join(", ")} but no remaining counter`,
      );
    },
  });

  // ── concurrency (slow) ────────────────────────────────────────────────────

  tests.push({
    id: `${s}-concurrency`,
    name: `${adapter.label}: concurrent requests stay isolated`,
    surface: s,
    tier: "core",
    slow: true,
    async run(ctx, a) {
      const names = ["Alice", "Bob", "Carol", "Dave"];

      const replies = await runConcurrent(
        names.length,
        names.length,
        async (i) => {
          const name = names[i]!;
          const res = await ctx.send(s, {
            turns: [
              { type: "user", text: `Hi! My name is ${name}.` },
              { type: "assistant-text", text: `Hello, ${name}!` },
              {
                type: "user",
                text: "What is my name? Reply with just the name.",
              },
            ],
            temperature: 0,
            maxTokens: 16,
          });
          return { name, text: res.reply.text };
        },
      );

      // Cross-talk between in-flight requests is a catastrophic engine bug —
      // one user's context bleeding into another's response.
      for (const reply of replies) {
        for (const other of names.filter((n) => n !== reply.name)) {
          a.must(
            `${s}-concurrency-${reply.name}-vs-${other}`,
            "no cross-talk between concurrent requests",
            !new RegExp(`\\b${other}\\b`, "i").test(reply.text),
            `the request for ${reply.name} leaked "${other}": "${reply.text.slice(0, 60)}"`,
          );
        }
      }
    },
  });

  tests.push({
    id: `${s}-concurrency-cache`,
    name: `${adapter.label}: concurrent identical requests agree`,
    surface: s,
    tier: "core",
    slow: true,
    async run(ctx, a) {
      // The cache-stampede case the distinct-prompt test above never touches:
      // several in-flight requests racing on ONE cache entry, where a
      // partially-built KV can leak into a sibling. Nonced so the entry is
      // genuinely cold when the race starts.
      const text = `[${runNonce}] Repeat this text exactly, nothing else: cobalt lantern 42`;

      const replies = await runConcurrent(4, 4, (i) =>
        ctx
          .send(s, {
            turns: [{ type: "user", text }],
            temperature: 0,
            maxTokens: 32,
          })
          .then((res) => ({ i, res })),
      );

      for (const { i, res } of replies) {
        a.must(
          `${s}-stampede-status-${i}`,
          "every racing request succeeds",
          res.status === 200,
          `request ${i} got HTTP ${res.status}`,
        );
        a.must(
          `${s}-stampede-text-${i}`,
          "every racing request gets a non-empty answer",
          res.status !== 200 || res.reply.text.length > 0,
          `request ${i} came back empty`,
        );
      }

      const texts = new Set(replies.map(({ res }) => res.reply.text));
      a.should(
        `${s}-stampede-agree`,
        "identical concurrent requests agree at temperature 0",
        texts.size === 1,
        `4 identical requests produced ${texts.size} distinct answers`,
      );
    },
  });

  return tests;
}
