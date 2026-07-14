/**
 * A mock OpenAI-compatible engine with switchable defects.
 *
 * This exists so the whole pipeline — probe, conformance, scoring, report — can
 * be driven end to end in CI with no GPU and no network. More importantly it
 * lets us prove the suite *detects what it claims to*: we hand it an engine
 * with a known bug and assert the bug shows up in the right place, on the right
 * card, at the right severity. A conformance suite nobody has tested against a
 * known-broken engine is just a well-formatted opinion.
 */

export interface MockDefects {
  /** Omit the terminal `data: [DONE]` sentinel from streams. */
  noDoneSentinel?: boolean;
  /** Accept `logprobs: true`, return 200, send no logprobs. The silent no-op. */
  silentlyIgnoreLogprobs?: boolean;
  /** Report `finish_reason: "stop"` even when truncated by max_tokens. */
  wrongLengthFinishReason?: boolean;
  /** Report a `total_tokens` that isn't input + output. */
  brokenUsageTotal?: boolean;
  /** Serialize tool-call arguments as an object rather than a JSON string. */
  toolArgsNotString?: boolean;
  /** Never emit a tool call, even under `tool_choice: "required"`. */
  neverCallsTools?: boolean;
  /** Accept a malformed body with 200 instead of rejecting it. */
  acceptsMalformedBodies?: boolean;
  /**
   * Answer every unknown path with HTTP 200 and an error body, the way LM
   * Studio really does. Without a defence, this makes an engine look like it
   * implements every endpoint in existence.
   */
  catchAll200?: boolean;
  /**
   * Behave like Qwen3 / DeepSeek-R1: spend the token budget in
   * `reasoning_content` first, and only produce visible content if enough
   * budget remains. Capped tightly, such a model returns EMPTY content.
   */
  reasoningModel?: boolean;
  /** Which surfaces exist. Defaults to models + chat. */
  surfaces?: string[];
  /** Fixed port. Defaults to 0 (random), which is what the tests want. */
  port?: number;
}

export interface MockEngine {
  url: string;
  stop(): void;
  requests: string[];
}

const MODEL = "mock-model-12b";

function chatCompletion(options: {
  content?: string;
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  finishReason: string;
  inputTokens: number;
  outputTokens: number;
  defects: MockDefects;
  logprobs?: boolean;
  reasoning?: string;
}): Record<string, unknown> {
  const { defects } = options;

  const total = defects.brokenUsageTotal
    ? options.inputTokens + options.outputTokens + 7
    : options.inputTokens + options.outputTokens;

  const toolCalls = options.toolCalls?.map((call, i) => ({
    id: `call_${i}`,
    type: "function",
    function: {
      name: call.name,
      // The defect: arguments must be a JSON *string* on the wire. Engines that
      // send an object break every SDK that calls JSON.parse on it.
      arguments: defects.toolArgsNotString
        ? (call.args as unknown as string)
        : JSON.stringify(call.args),
    },
  }));

  return {
    id: "chatcmpl-mock-1",
    object: "chat.completion",
    created: 1_700_000_000,
    model: MODEL,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: options.content ?? null,
          ...(options.reasoning
            ? { reasoning_content: options.reasoning }
            : {}),
          ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: options.finishReason,
        ...(options.logprobs
          ? { logprobs: { content: [{ token: "hi", logprob: -0.1 }] } }
          : {}),
      },
    ],
    usage: {
      prompt_tokens: options.inputTokens,
      completion_tokens: options.outputTokens,
      total_tokens: total,
    },
  };
}

/** How many tokens a reasoning model burns before it writes anything visible. */
const THINKING_COST = 40;

/** Decide what the mock "model" would do, from the request. */
function respondTo(body: any, defects: MockDefects) {
  const messages = body.messages ?? [];
  const last = messages.at(-1);
  const text = typeof last?.content === "string" ? last.content : "";
  const maxTokens = body.max_completion_tokens ?? body.max_tokens ?? 256;

  // A reasoning model thinks first. Starve it of budget and the caller gets
  // `content: ""` with `finish_reason: "length"` — the exact trap that made a
  // real 27B look like it scored 0% on basic knowledge.
  if (defects.reasoningModel && maxTokens <= THINKING_COST) {
    return {
      content: "",
      reasoning: "Let me think about this step by step...",
      finishReason: "length",
      outputTokens: maxTokens,
    };
  }

  const wantsTool =
    body.tools?.length &&
    body.tool_choice !== "none" &&
    !defects.neverCallsTools &&
    (body.tool_choice === "required" ||
      typeof body.tool_choice === "object" ||
      /weather|time|book/i.test(text));

  if (wantsTool) {
    const forced =
      typeof body.tool_choice === "object"
        ? body.tool_choice.function?.name
        : undefined;
    const name = forced ?? (/(time)/i.test(text) ? "get_time" : "get_weather");
    return {
      toolCalls: [{ name, args: { city: "Paris", unit: "celsius" } }],
      finishReason: "tool_calls",
      outputTokens: 12,
    };
  }

  // Truncation: with max_tokens=1 a correct engine reports a length finish.
  if (maxTokens <= 2) {
    return {
      content: "The",
      finishReason: defects.wrongLengthFinishReason ? "stop" : "length",
      outputTokens: maxTokens,
    };
  }

  if (body.response_format) {
    return {
      content: JSON.stringify({ name: "Ada", age: 36 }),
      finishReason: "stop",
      outputTokens: 10,
    };
  }

  // Echo mode keeps parity/unicode/stop-sequence tests meaningful.
  const stop: string[] = body.stop ?? [];
  let content = "Paris";
  if (/repeat this text exactly/i.test(text)) {
    content = text.split(":").slice(1).join(":").trim();
  } else if (/alpha beta gamma/i.test(text)) {
    content = "alpha beta gamma";
  } else if (/name is/i.test(messages[0]?.content ?? "")) {
    const match = /name is (\w+)/i.exec(messages[0].content);
    content = match?.[1] ?? "Paris";
  }

  for (const s of stop) {
    const at = content.indexOf(s);
    if (at !== -1) content = content.slice(0, at).trimEnd();
  }

  return {
    content,
    finishReason: "stop",
    outputTokens: 6,
    ...(defects.reasoningModel
      ? { reasoning: "Let me think about this step by step..." }
      : {}),
  };
}

function streamFor(
  payload: Record<string, unknown>,
  defects: MockDefects,
): string {
  const completion = payload as any;
  const choice = completion.choices[0];
  const frames: string[] = [];

  const base = {
    id: completion.id,
    object: "chat.completion.chunk",
    created: completion.created,
    model: completion.model,
  };

  frames.push(
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}`,
  );

  const content: string | null = choice.message.content;
  if (typeof content === "string") {
    // Split into a couple of deltas so reassembly is actually exercised.
    for (const piece of content.match(/.{1,4}/gs) ?? []) {
      frames.push(
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] })}`,
      );
    }
  }

  for (const [i, call] of (choice.message.tool_calls ?? []).entries()) {
    const args: string =
      typeof call.function.arguments === "string"
        ? call.function.arguments
        : JSON.stringify(call.function.arguments);

    frames.push(
      `data: ${JSON.stringify({
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: i,
                  id: call.id,
                  type: "function",
                  function: { name: call.function.name, arguments: "" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      })}`,
    );

    // Fragment the arguments — the classic place engines lose bytes.
    for (const piece of args.match(/.{1,5}/gs) ?? []) {
      frames.push(
        `data: ${JSON.stringify({
          ...base,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: i, function: { arguments: piece } }],
              },
              finish_reason: null,
            },
          ],
        })}`,
      );
    }
  }

  frames.push(
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }] })}`,
  );

  frames.push(
    `data: ${JSON.stringify({ ...base, choices: [], usage: completion.usage })}`,
  );

  if (!defects.noDoneSentinel) frames.push("data: [DONE]");

  return `${frames.join("\n\n")}\n\n`;
}

export function startMockEngine(defects: MockDefects = {}): MockEngine {
  const surfaces = defects.surfaces ?? ["models", "chat"];
  const requests: string[] = [];

  const server = Bun.serve({
    port: defects.port ?? 0,
    async fetch(request) {
      const url = new URL(request.url);
      const path = url.pathname.replace(/^\/v1/, "");
      requests.push(`${request.method} ${path}`);

      if (path === "/models" && surfaces.includes("models")) {
        return Response.json({
          object: "list",
          data: [{ id: MODEL, object: "model", created: 1, owned_by: "mock" }],
        });
      }

      if (path === "/chat/completions" && surfaces.includes("chat")) {
        const body = (await request.json().catch(() => ({}))) as any;

        // An empty-body probe must be rejected on validation — that is what
        // makes surface discovery free.
        const malformed =
          !body?.model ||
          !Array.isArray(body?.messages) ||
          body.messages.length === 0;

        if (malformed && !defects.acceptsMalformedBodies) {
          return Response.json(
            {
              error: {
                message: "messages must be a non-empty array",
                type: "invalid_request_error",
              },
            },
            { status: 400 },
          );
        }

        const plan = respondTo(body, defects);
        const payload = chatCompletion({
          ...plan,
          inputTokens: 20,
          defects,
          logprobs: body.logprobs === true && !defects.silentlyIgnoreLogprobs,
        } as Parameters<typeof chatCompletion>[0]);

        if (body.stream) {
          return new Response(streamFor(payload, defects), {
            headers: { "content-type": "text/event-stream" },
          });
        }

        return Response.json(payload);
      }

      if (path === "/embeddings" && surfaces.includes("embeddings")) {
        const body = (await request.json().catch(() => ({}))) as any;
        if (!body?.input) {
          return Response.json(
            { error: { message: "input required" } },
            { status: 400 },
          );
        }
        const dims = body.dimensions ?? 8;
        return Response.json({
          object: "list",
          data: [
            {
              object: "embedding",
              index: 0,
              embedding: Array.from({ length: dims }, () => 0.1),
            },
          ],
          model: MODEL,
          usage: { prompt_tokens: 4, total_tokens: 4 },
        });
      }

      if (defects.catchAll200) {
        // LM Studio's real behaviour, verbatim: HTTP 200, an error in the body,
        // and the requested path echoed back. Note the echoed path differs
        // between the `/v1` mounting and the bare root — which is precisely
        // where the first version of the catch-all defence leaked.
        return Response.json({
          error: `Unexpected endpoint or method. (${request.method} ${url.pathname})`,
        });
      }

      return Response.json(
        { error: { message: "not found" } },
        { status: 404 },
      );
    },
  });

  return {
    url: `http://localhost:${server.port}`,
    stop: () => server.stop(true),
    requests,
  };
}
