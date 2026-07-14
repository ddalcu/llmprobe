import type { SurfaceAdapter } from "../core/adapter";
import {
  approxTextSimilarity,
  Inconclusive,
  isLengthStyleFinish,
  runConcurrent,
  tryParseJson,
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
        a.must(
          `${s}-max-tokens-respected`,
          "max_tokens caps the output",
          output <= 12,
          `asked for 8 tokens, got ${output}`,
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

  // ── reasoning channel ─────────────────────────────────────────────────────

  tests.push({
    id: `${s}-reasoning`,
    name: `${adapter.label}: reasoning is kept out of content`,
    surface: s,
    tier: "extended",
    feature: feature("reasoning"),
    async run(ctx, a) {
      const res = await ctx.send(s, {
        turns: [
          {
            type: "user",
            text: "What is 17 * 3? Think it through, then answer.",
          },
        ],
        temperature: 0,
        maxTokens: 256,
      });

      const hasChannel =
        res.reply.reasoningText !== null ||
        res.reply.usage.reasoningTokens !== null;
      if (!hasChannel) {
        return {
          featureSupported: false,
          unsupportedDetail: "no separate reasoning channel",
        };
      }

      // The engine bug this catches: chain-of-thought leaking into the visible
      // content, so every caller renders the model's scratchpad to end users.
      a.must(
        `${s}-reasoning-not-leaked`,
        "reasoning does not leak into the visible content",
        !/<think>|<\|thinking\|>/i.test(res.reply.text),
        "found raw thinking tags inside the assistant content",
      );
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

      await ctx.send(s, request);
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

  return tests;
}
