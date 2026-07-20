import { chatCompletionChunkSchema } from "../../generated/kubb/chat-completions/zod/chatCompletionChunkSchema";
import { chatCompletionSchema } from "../../generated/kubb/chat-completions/zod/chatCompletionSchema";
import {
  bearerAuth,
  type ChatReply,
  type ChatRequest,
  emptyUsage,
  normalizeToolArgs,
  type StreamReply,
  type SurfaceAdapter,
  type ToolCall,
  type ToolChoice,
  type Turn,
} from "../../core/adapter";
import type { RunConfig } from "../../core/client";
import { parseFrameJson, type SSEFrame } from "../../core/sse";

interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content?: unknown;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

function turnToMessage(turn: Turn): Message {
  switch (turn.type) {
    case "user":
      return { role: "user", content: turn.text };
    case "user-image":
      return {
        role: "user",
        content: [
          { type: "text", text: turn.text },
          { type: "image_url", image_url: { url: turn.imageDataUrl } },
        ],
      };
    case "assistant-text":
      return { role: "assistant", content: turn.text };
    case "assistant-tool-call":
      return {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: turn.call.id,
            type: "function",
            function: { name: turn.call.name, arguments: turn.call.argsJson },
          },
        ],
      };
    case "tool-result":
      return {
        role: "tool",
        tool_call_id: turn.toolCallId,
        content: turn.output,
      };
  }
}

function toolChoiceBody(choice: ToolChoice): unknown {
  if (typeof choice === "string") return choice;
  return { type: "function", function: { name: choice.name } };
}

function extractToolCalls(raw: unknown): ToolCall[] {
  const calls =
    (raw as { choices?: Array<{ message?: { tool_calls?: unknown[] } }> })
      ?.choices?.[0]?.message?.tool_calls ?? [];

  return (calls as Array<Record<string, any>>).map((c, i) => ({
    id: typeof c.id === "string" ? c.id : `tc_${i}`,
    name: c.function?.name ?? "",
    // Keep the wire value alongside the normalised one: an engine that sends
    // `arguments` as an object rather than a JSON string is broken, and
    // coercing it here would hide that.
    argsJson: normalizeToolArgs(c.function?.arguments),
    argsRaw: c.function?.arguments,
  }));
}

export const chatAdapter: SurfaceAdapter = {
  id: "chat",
  label: "chat/completions",
  path: "/chat/completions",

  capabilities: {
    tools: true,
    jsonMode: true,
    jsonSchema: true,
    logprobs: true,
    vision: true,
    seed: true,
    reasoningChannel: false,
    previousResponseId: false,
    promptCacheKey: false,
    parallelToolCalls: true,
    streamEndsWithDone: true,
    toolArgsAreJsonString: true,
    signalsToolFinishReason: true,
  },

  headers: (config) => bearerAuth(config),

  responseSchema: chatCompletionSchema,
  chunkSchema: chatCompletionChunkSchema,

  reasoningOptIn: { reasoning_effort: "low" },

  buildBody(request: ChatRequest, config: RunConfig): Record<string, unknown> {
    const messages: Message[] = [];
    if (request.system)
      messages.push({ role: "system", content: request.system });
    for (const turn of request.turns) messages.push(turnToMessage(turn));

    const body: Record<string, unknown> = { model: config.model, messages };

    if (request.temperature !== undefined)
      body.temperature = request.temperature;
    if (request.topP !== undefined) body.top_p = request.topP;

    // Modern OpenAI models reject `max_tokens` and require
    // `max_completion_tokens`. Current LM Studio / vLLM / llama.cpp / Ollama
    // shims all accept the newer name, so we send only that.
    if (request.maxTokens !== undefined) {
      body.max_completion_tokens = request.maxTokens;
    }
    if (request.stop) body.stop = request.stop;
    if (request.seed !== undefined) body.seed = request.seed;
    if (request.logprobs) body.logprobs = true;

    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }
    if (request.toolChoice !== undefined) {
      body.tool_choice = toolChoiceBody(request.toolChoice);
    }
    if (request.parallelToolCalls !== undefined) {
      body.parallel_tool_calls = request.parallelToolCalls;
    }

    if (request.responseFormat) {
      body.response_format =
        request.responseFormat.type === "json_object"
          ? { type: "json_object" }
          : {
              type: "json_schema",
              json_schema: {
                name: request.responseFormat.name,
                schema: request.responseFormat.schema,
                strict: true,
              },
            };
    }

    if (request.promptCacheKey) body.prompt_cache_key = request.promptCacheKey;
    if (request.includeUsage) body.stream_options = { include_usage: true };

    return { ...body, ...(request.extra ?? {}) };
  },

  parse(raw: unknown): ChatReply {
    const r = raw as any;
    const choice = r?.choices?.[0];
    const usage = r?.usage;

    return {
      id: typeof r?.id === "string" ? r.id : null,
      text:
        typeof choice?.message?.content === "string"
          ? choice.message.content
          : "",
      toolCalls: extractToolCalls(raw),
      finishReason: choice?.finish_reason ?? null,
      usage: {
        inputTokens: usage?.prompt_tokens ?? null,
        outputTokens: usage?.completion_tokens ?? null,
        cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? null,
        reasoningTokens:
          usage?.completion_tokens_details?.reasoning_tokens ?? null,
      },
      // Not part of the spec, but several engines surface it and we want to be
      // able to check it doesn't leak into `content`.
      reasoningText:
        typeof choice?.message?.reasoning_content === "string"
          ? choice.message.reasoning_content
          : null,
      logprobs: choice?.logprobs ?? undefined,
      raw,
    };
  },

  frameText(payload: unknown): string {
    const delta = (payload as any)?.choices?.[0]?.delta;
    if (typeof delta?.content === "string") return delta.content;
    if (typeof delta?.reasoning_content === "string") {
      return delta.reasoning_content;
    }
    return "";
  },

  parseStream(frames: SSEFrame[]): StreamReply {
    const { payloads, errors } = parseFrameJson(frames);

    let id: string | null = null;
    let text = "";
    let reasoningText = "";
    let finishReason: string | null = null;
    let logprobs: unknown;
    const usage = emptyUsage();
    const toolAcc = new Map<
      number,
      { id?: string; name?: string; args: string }
    >();

    for (const payload of payloads) {
      const chunk = payload as any;
      if (typeof chunk?.id === "string") id = chunk.id;

      const choice = chunk?.choices?.[0];
      const delta = choice?.delta;

      if (typeof delta?.content === "string") text += delta.content;
      if (typeof delta?.reasoning_content === "string") {
        reasoningText += delta.reasoning_content;
      }

      for (const tc of delta?.tool_calls ?? []) {
        const index = typeof tc.index === "number" ? tc.index : 0;
        const existing = toolAcc.get(index) ?? { args: "" };
        if (typeof tc.id === "string") existing.id = tc.id;
        if (typeof tc.function?.name === "string")
          existing.name = tc.function.name;
        if (typeof tc.function?.arguments === "string") {
          existing.args += tc.function.arguments;
        }
        toolAcc.set(index, existing);
      }

      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (choice?.logprobs) logprobs = choice.logprobs;

      // Usage arrives on a trailing chunk when `stream_options.include_usage`
      // was set — the only way a compliant engine reports it while streaming.
      if (chunk?.usage) {
        usage.inputTokens = chunk.usage.prompt_tokens ?? usage.inputTokens;
        usage.outputTokens =
          chunk.usage.completion_tokens ?? usage.outputTokens;
        usage.cachedInputTokens =
          chunk.usage.prompt_tokens_details?.cached_tokens ??
          usage.cachedInputTokens;
      }
    }

    const toolCalls: ToolCall[] = [...toolAcc.entries()]
      .sort(([a], [b]) => a - b)
      .map(([i, tc]) => ({
        id: tc.id ?? `tc_${i}`,
        name: tc.name ?? "",
        argsJson: tc.args,
        argsRaw: tc.args,
      }));

    return {
      id,
      text,
      toolCalls,
      finishReason,
      usage,
      reasoningText: reasoningText || null,
      logprobs,
      raw: payloads,
      eventTypes: frames.map((f) => f.event ?? "message"),
      frameCount: payloads.length,
      errors,
    };
  },
};
