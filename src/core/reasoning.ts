import type { ChatRequest, SurfaceAdapter, ToolDef } from "./adapter";
import type { EngineClient, RunConfig } from "./client";

/**
 * Tokens granted on top of whatever a test asks for, once we know the model
 * thinks before it speaks.
 *
 * Generous on purpose. A reasoning model that runs out of budget mid-thought
 * returns *empty* content, and an empty answer is indistinguishable from a
 * wrong one at grading time — so under-provisioning here silently converts a
 * capable model into a failing one.
 */
export const REASONING_HEADROOM = 1024;

/**
 * A tool definition to carry on the second attempt.
 *
 * Some templates gate thinking on tool PRESENCE rather than on a request flag
 * — Muse-Glimmer thinks by default with tools and answers directly without
 * them. It costs one tool schema to stop reading those as non-reasoning
 * models. No `tool_choice`: we want an answer to grade, not a tool call.
 */
const PROBE_TOOL: ToolDef = {
  name: "get_weather",
  description: "Get the current weather for a city",
  parameters: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  },
};

const PROBE_REQUEST: ChatRequest = {
  turns: [{ type: "user", text: "What is 2 + 2? Reply with just the number." }],
  temperature: 0,
  maxTokens: 512,
};

/** Any of these means the model thought before it spoke. */
async function thinksOn(
  client: EngineClient,
  adapter: SurfaceAdapter,
  config: RunConfig,
  request: ChatRequest,
): Promise<boolean> {
  const result = await client.request("POST", adapter.path, {
    body: adapter.buildBody(request, config),
    headers: adapter.headers(config),
  });

  if (result.status !== 200) return false;

  const reply = adapter.parse(result.json);
  client.recordUsage(reply.usage.inputTokens, reply.usage.outputTokens);

  if ((reply.usage.reasoningTokens ?? 0) > 0) return true;
  if (reply.reasoningText && reply.reasoningText.length > 0) return true;
  return /<think>|<\|thinking\|>/i.test(reply.text);
}

/**
 * Does this model spend tokens thinking before it produces visible output?
 *
 * This matters enormously and is easy to miss. Qwen3, DeepSeek-R1 distills and
 * friends put their chain of thought in `reasoning_content` (or an inline
 * `<think>` block) and only then write an answer. Ask one for the capital of
 * Australia with `max_tokens: 16` and you get `content: ""` and
 * `finish_reason: "length"` — every token went to the scratchpad. Score that
 * naively and a 27B model reads as 0% on basic knowledge, which says nothing
 * about the model and everything about the harness.
 *
 * One probe per run, two if the first says no. Costs a few hundred tokens and
 * saves the whole capability card from being fiction.
 */
export async function detectReasoning(
  client: EngineClient,
  adapter: SurfaceAdapter,
  config: RunConfig,
): Promise<boolean> {
  try {
    if (await thinksOn(client, adapter, config, PROBE_REQUEST)) return true;

    // Second chance, and the reason this function is not one request.
    //
    // A plain probe only finds models that think UNCONDITIONALLY. Whether the
    // channel opens can depend on the request: on the surface's own opt-in
    // (`reasoning_effort`), or on tools being present at all. Miss that and we
    // budget the whole run as if the model never thinks, which is exactly how a
    // capable model gets scored on our token cap instead of its answers — while
    // the suite's own reasoning tests, which DO opt in, watch it think.
    //
    // "Can think" is the safe side to err on: headroom only ever RAISES a
    // budget, and the tests where a small cap is the point opt out of it.
    return await thinksOn(client, adapter, config, {
      ...PROBE_REQUEST,
      tools: [PROBE_TOOL],
      extra: adapter.reasoningOptIn,
    });
  } catch {
    // If we cannot tell, assume not — and let the conformance tests report
    // whatever actually goes wrong, rather than inventing a budget.
    return false;
  }
}
