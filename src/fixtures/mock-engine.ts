import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

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
  /** Spread probability mass thin — the signature of a degraded quant. */
  flatLogprobs?: boolean;
  /** Vary output run-to-run even at temperature 0 — a non-deterministic kernel. */
  nondeterministicGreedy?: boolean;
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
  /** Accept `n: 2`, return 200, send one choice. The silent no-op, again. */
  silentlyIgnoreN?: boolean;
  /** Emit two tool calls despite `parallel_tool_calls: false`. */
  ignoresParallelDisable?: boolean;
  /** Accept a near-zero `top_p`, keep sampling randomly anyway. */
  silentlyIgnoreTopP?: boolean;
  /**
   * Simulate a prefix cache: a repeated system prompt reports
   * `prompt_tokens_details.cached_tokens` on the second sighting.
   */
  promptCache?: boolean;
  /** The corrupted-KV case: a cache hit changes the answer. */
  cacheChangesAnswer?: boolean;
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
  /**
   * Behave like mlx-serve's default: the reasoning channel exists but only
   * appears when the request opts in with the standard `reasoning_effort`
   * param; a plain request gets its think block stripped.
   */
  reasoningRequiresOptIn?: boolean;
  /**
   * Stall (1s) any chat completion whose prompt exceeds this many bytes —
   * enough to trip a client timeout set below the stall. Models real engines
   * whose prefill of a big prompt outlasts the per-request timeout.
   */
  stallAbovePromptBytes?: number;
  /** Which surfaces exist. Defaults to models + chat. */
  surfaces?: string[];
  /**
   * Reject every `/images/edits` call while `/images/generations` keeps working
   * for the same model — the shape a server takes when it resolves the model
   * BEFORE parsing the multipart body, so the `model` form field is ignored and
   * the request silently runs against the default model.
   */
  imageEditsIgnoreFormModel?: boolean;
  /** Fixed port. Defaults to 0 (random), which is what the tests want. */
  port?: number;
}

export interface MockEngine {
  url: string;
  stop(): void;
  requests: string[];
  /** Parsed body of every /chat/completions request, in arrival order. */
  chatBodies: Array<Record<string, unknown>>;
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
  topLogprobs?: number;
  reasoning?: string;
  n?: number;
  cachedTokens?: number;
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

  const choice = (index: number) => ({
    index,
    message: {
      role: "assistant",
      content: options.content ?? null,
      ...(options.reasoning ? { reasoning_content: options.reasoning } : {}),
      ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
    },
    finish_reason: options.finishReason,
    ...(options.logprobs
      ? {
          logprobs: buildLogprobs(
            options.content,
            options.topLogprobs ?? 0,
            defects,
          ),
        }
      : {}),
  });

  return {
    id: "chatcmpl-mock-1",
    object: "chat.completion",
    created: 1_700_000_000,
    model: MODEL,
    choices: Array.from({ length: options.n ?? 1 }, (_, i) => choice(i)),
    usage: {
      prompt_tokens: options.inputTokens,
      completion_tokens: options.outputTokens,
      total_tokens: total,
      ...(options.cachedTokens !== undefined
        ? { prompt_tokens_details: { cached_tokens: options.cachedTokens } }
        : {}),
    },
  };
}

/**
 * A plausible OpenAI-shaped `logprobs.content`. Only the first token matters to
 * the fidelity probe (it reads the answer token's confidence), so we make that
 * one faithful: near-all mass on the emitted token, with the top-k sorted and
 * the argmax equal to the token — unless a defect flattens or corrupts it.
 */
function buildLogprobs(
  content: string | undefined,
  topK: number,
  defects: MockDefects,
): { content: Array<Record<string, unknown>> } {
  const firstWord = (content ?? "").trim().split(/\s+/)[0];
  const token = (firstWord && firstWord.slice(0, 16)) || "x";
  // -0.05 ⇒ p≈0.95 (faithful); -1.4 ⇒ p≈0.25 (flat, like a degraded quant).
  const topLogprob = defects.flatLogprobs ? -1.4 : -0.05;
  const entry: Record<string, unknown> = { token, logprob: topLogprob };
  if (topK > 0) {
    entry.top_logprobs = [
      { token, logprob: topLogprob },
      { token: "~a", logprob: topLogprob - 1.6 },
      { token: "~b", logprob: topLogprob - 2.7 },
      { token: "~c", logprob: topLogprob - 3.9 },
      { token: "~d", logprob: topLogprob - 5.1 },
    ].slice(0, topK);
  }
  return { content: [entry] };
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

    // The defect: a request that disabled parallel calls gets two anyway.
    if (defects.ignoresParallelDisable && body.parallel_tool_calls === false) {
      return {
        toolCalls: [
          { name: "get_weather", args: { city: "Tokyo" } },
          { name: "get_time", args: { city: "Tokyo" } },
        ],
        finishReason: "tool_calls",
        outputTokens: 24,
      };
    }

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
  // The spec allows `stop` as a bare string or an array; honor both.
  const stop: string[] =
    typeof body.stop === "string" ? [body.stop] : (body.stop ?? []);
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

  // The defect: a near-zero top_p should force greedy decoding, but this
  // engine keeps sampling — two identical requests disagree.
  if (
    defects.silentlyIgnoreTopP &&
    typeof body.top_p === "number" &&
    body.top_p < 0.01
  ) {
    content += ` ${Math.random().toString(36).slice(2, 8)}`;
  }

  // A non-deterministic kernel: identical temperature-0 requests disagree. The
  // fidelity determinism probe exists to catch exactly this.
  if (defects.nondeterministicGreedy) {
    content += ` ${Math.random().toString(36).slice(2, 8)}`;
  }

  const showsReasoning =
    defects.reasoningModel ||
    (defects.reasoningRequiresOptIn && body.reasoning_effort !== undefined);

  return {
    content,
    finishReason: "stop",
    outputTokens: 6,
    ...(showsReasoning
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function readBodyJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

/** A 1x1 PNG, the payload every mocked image endpoint returns. */
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/**
 * Parse a `multipart/form-data` body. Node's Request does this for us, so the
 * mock validates the real wire bytes rather than trusting the client wrote
 * them — the point of an edits fixture is that the framing is right.
 */
async function readBodyForm(req: IncomingMessage): Promise<FormData> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    return await new Response(Buffer.concat(chunks), {
      headers: { "content-type": req.headers["content-type"] ?? "" },
    }).formData();
  } catch {
    return new FormData();
  }
}

export async function startMockEngine(
  defects: MockDefects = {},
): Promise<MockEngine> {
  const surfaces = defects.surfaces ?? ["models", "chat"];
  const requests: string[] = [];
  const chatBodies: Array<Record<string, unknown>> = [];
  /** System prompts already prefilled once — the simulated prefix cache. */
  const seenSystems = new Set<string>();

  const json = (
    res: ServerResponse,
    body: unknown,
    status = 200,
    contentType = "application/json",
  ): void => {
    res.writeHead(status, { "content-type": contentType });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };

  const handle = async (
    request: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/^\/v1/, "");
    requests.push(`${request.method} ${path}`);

    if (path === "/models" && surfaces.includes("models")) {
      return json(res, {
        object: "list",
        data: [{ id: MODEL, object: "model", created: 1, owned_by: "mock" }],
      });
    }

    if (path === "/chat/completions" && surfaces.includes("chat")) {
      const body = (await readBodyJson(request)) as any;
      chatBodies.push(body);

      if (defects.stallAbovePromptBytes !== undefined) {
        const last = (body.messages ?? []).at(-1);
        const text = typeof last?.content === "string" ? last.content : "";
        if (text.length > defects.stallAbovePromptBytes) await sleep(1_000);
      }

      // An empty-body probe must be rejected on validation — that is what
      // makes surface discovery free.
      const malformed =
        !body?.model ||
        !Array.isArray(body?.messages) ||
        body.messages.length === 0;

      if (malformed && !defects.acceptsMalformedBodies) {
        return json(
          res,
          {
            error: {
              message: "messages must be a non-empty array",
              type: "invalid_request_error",
            },
          },
          400,
        );
      }

      // Simulated prefix cache: a system prompt seen before reports half the
      // prompt as cached; with the corruption defect, the warm answer also
      // changes — the KV-reuse bug the cache-correctness check exists for.
      let cachedTokens: number | undefined;
      if (defects.promptCache) {
        const system = (body.messages ?? []).find(
          (m: any) => m?.role === "system",
        )?.content;
        if (typeof system === "string" && system.length > 0) {
          if (seenSystems.has(system)) cachedTokens = 10;
          seenSystems.add(system);
        }
      }

      const plan = respondTo(body, defects);
      if (
        cachedTokens !== undefined &&
        defects.cacheChangesAnswer &&
        typeof plan.content === "string"
      ) {
        plan.content = "A completely different answer.";
      }

      const n =
        typeof body.n === "number" && body.n > 1 && !defects.silentlyIgnoreN
          ? body.n
          : undefined;

      const payload = chatCompletion({
        ...plan,
        inputTokens: 20,
        defects,
        n,
        cachedTokens,
        logprobs: body.logprobs === true && !defects.silentlyIgnoreLogprobs,
        topLogprobs:
          typeof body.top_logprobs === "number" ? body.top_logprobs : 0,
      } as Parameters<typeof chatCompletion>[0]);

      if (body.stream) {
        return json(res, streamFor(payload, defects), 200, "text/event-stream");
      }

      return json(res, payload);
    }

    if (path === "/images/generations" && surfaces.includes("images")) {
      const body = (await readBodyJson(request)) as any;
      if (!body?.prompt) {
        return json(res, { error: { message: "prompt required" } }, 400);
      }
      return json(res, { created: 1, data: [{ b64_json: TINY_PNG_B64 }] });
    }

    if (path === "/images/edits" && surfaces.includes("images")) {
      if (defects.imageEditsIgnoreFormModel) {
        // The multipart body is never consulted for the model, so the request
        // is resolved against the default model — a chat model here — and the
        // modality check rejects it. Generations (JSON) still work, which is
        // exactly what makes this a defect rather than "no image model".
        return json(
          res,
          {
            error: {
              message: "Target model does not support this media modality.",
              type: "invalid_request_error",
            },
          },
          400,
        );
      }
      const form = await readBodyForm(request);
      if (!form.has("image") || !form.get("prompt")) {
        return json(
          res,
          { error: { message: "image and prompt required" } },
          400,
        );
      }
      return json(res, { created: 1, data: [{ b64_json: TINY_PNG_B64 }] });
    }

    if (path === "/embeddings" && surfaces.includes("embeddings")) {
      const body = (await readBodyJson(request)) as any;
      if (!body?.input) {
        return json(res, { error: { message: "input required" } }, 400);
      }
      const dims = body.dimensions ?? 8;
      return json(res, {
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
      return json(res, {
        error: `Unexpected endpoint or method. (${request.method} ${url.pathname})`,
      });
    }

    return json(res, { error: { message: "not found" } }, 404);
  };

  const server = createServer((request, res) => {
    handle(request, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  await new Promise<void>((resolve) =>
    server.listen(defects.port ?? 0, resolve),
  );
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://localhost:${port}`,
    stop: () => {
      server.closeAllConnections();
      server.close();
    },
    requests,
    chatBodies,
  };
}
