import type { SurfaceAdapter } from "./adapter";
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
 * One probe, once per run. Costs a few hundred tokens and saves the whole
 * capability card from being fiction.
 */
export async function detectReasoning(
  client: EngineClient,
  adapter: SurfaceAdapter,
  config: RunConfig,
): Promise<boolean> {
  try {
    const body = adapter.buildBody(
      {
        turns: [
          { type: "user", text: "What is 2 + 2? Reply with just the number." },
        ],
        temperature: 0,
        maxTokens: 512,
      },
      config,
    );

    const result = await client.request("POST", adapter.path, {
      body,
      headers: adapter.headers(config),
    });

    if (result.status !== 200) return false;

    const reply = adapter.parse(result.json);
    client.recordUsage(reply.usage.inputTokens, reply.usage.outputTokens);

    // Three tells, any of which means the model thinks before answering.
    if ((reply.usage.reasoningTokens ?? 0) > 0) return true;
    if (reply.reasoningText && reply.reasoningText.length > 0) return true;
    if (/<think>|<\|thinking\|>/i.test(reply.text)) return true;

    return false;
  } catch {
    // If we cannot tell, assume not — and let the conformance tests report
    // whatever actually goes wrong, rather than inventing a budget.
    return false;
  }
}
