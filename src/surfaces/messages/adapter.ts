import { z } from "zod";

import { contentBlockDeltaEventSchema } from "../../generated/kubb/anthropic-messages/zod/contentBlockDeltaEventSchema";
import { contentBlockStartEventSchema } from "../../generated/kubb/anthropic-messages/zod/contentBlockStartEventSchema";
import { contentBlockStopEventSchema } from "../../generated/kubb/anthropic-messages/zod/contentBlockStopEventSchema";
import { errorEventSchema } from "../../generated/kubb/anthropic-messages/zod/errorEventSchema";
import { messageDeltaEventSchema } from "../../generated/kubb/anthropic-messages/zod/messageDeltaEventSchema";
import { messageSchema } from "../../generated/kubb/anthropic-messages/zod/messageSchema";
import { messageStartEventSchema } from "../../generated/kubb/anthropic-messages/zod/messageStartEventSchema";
import { messageStopEventSchema } from "../../generated/kubb/anthropic-messages/zod/messageStopEventSchema";
import { pingEventSchema } from "../../generated/kubb/anthropic-messages/zod/pingEventSchema";
import {
  type ChatReply,
  type ChatRequest,
  emptyUsage,
  type StreamReply,
  type SurfaceAdapter,
  type ToolCall,
  type ToolChoice,
  type Turn,
} from "../../core/adapter";
import type { RunConfig } from "../../core/client";
import { parseFrameJson, type SSEFrame } from "../../core/sse";

export const messagesStreamEventSchema = z.discriminatedUnion("type", [
  messageStartEventSchema,
  contentBlockStartEventSchema,
  contentBlockDeltaEventSchema,
  contentBlockStopEventSchema,
  messageDeltaEventSchema,
  messageStopEventSchema,
  pingEventSchema,
  errorEventSchema,
]);

/** Anthropic requires `max_tokens` on every request — there is no default. */
const DEFAULT_MAX_TOKENS = 1024;

function dataUrlToSource(dataUrl: string): Record<string, unknown> {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  return {
    type: "base64",
    media_type: match?.[1] ?? "image/png",
    data: match?.[2] ?? "",
  };
}

function turnToMessage(turn: Turn): Record<string, unknown> {
  switch (turn.type) {
    case "user":
      return { role: "user", content: turn.text };
    case "user-image":
      return {
        role: "user",
        content: [
          { type: "image", source: dataUrlToSource(turn.imageDataUrl) },
          { type: "text", text: turn.text },
        ],
      };
    case "assistant-text":
      return { role: "assistant", content: turn.text };
    case "assistant-tool-call":
      return {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: turn.call.id,
            name: turn.call.name,
            // Anthropic takes parsed input, not a JSON string.
            input: safeParse(turn.call.argsJson),
          },
        ],
      };
    case "tool-result":
      return {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: turn.toolCallId,
            content: turn.output,
          },
        ],
      };
  }
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function toolChoiceBody(choice: ToolChoice): unknown {
  if (choice === "auto") return { type: "auto" };
  if (choice === "none") return { type: "none" };
  if (choice === "required") return { type: "any" };
  return { type: "tool", name: choice.name };
}

export const messagesAdapter: SurfaceAdapter = {
  id: "messages",
  label: "messages",
  path: "/messages",

  capabilities: {
    tools: true,
    jsonMode: false,
    jsonSchema: false,
    logprobs: false,
    vision: true,
    seed: false,
    reasoningChannel: true,
    previousResponseId: false,
    promptCacheKey: false,
    parallelToolCalls: true,
    // Anthropic terminates with a `message_stop` event, not `data: [DONE]`.
    streamEndsWithDone: false,
    // Anthropic's `input` is a real object, not a JSON string. Asserting
    // string-ness here would fail a spec-compliant engine.
    toolArgsAreJsonString: false,
    signalsToolFinishReason: true,
  },

  headers(config: RunConfig) {
    return {
      "anthropic-version": "2023-06-01",
      ...(config.apiKey ? { "x-api-key": config.apiKey } : {}),
    };
  },

  // Anthropic requires max_tokens > budget_tokens; the probe's retry sends a
  // max_tokens comfortably above this.
  reasoningOptIn: { thinking: { type: "enabled", budget_tokens: 256 } },

  responseSchema: messageSchema,
  chunkSchema: messagesStreamEventSchema,

  buildBody(request: ChatRequest, config: RunConfig): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: config.model,
      messages: request.turns.map(turnToMessage),
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    };

    if (request.system) body.system = request.system;
    if (request.temperature !== undefined)
      body.temperature = request.temperature;
    if (request.topP !== undefined) body.top_p = request.topP;
    if (request.stop) body.stop_sequences = request.stop;

    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }));
    }
    if (request.toolChoice !== undefined) {
      body.tool_choice = toolChoiceBody(request.toolChoice);
    }
    // Anthropic expresses "no parallel calls" inside tool_choice rather than
    // as a sibling field the way chat/completions and Responses do.
    if (request.parallelToolCalls === false && body.tool_choice) {
      body.tool_choice = {
        ...(body.tool_choice as Record<string, unknown>),
        disable_parallel_tool_use: true,
      };
    }

    return { ...body, ...(request.extra ?? {}) };
  },

  parse(raw: unknown): ChatReply {
    const r = raw as any;
    let text = "";
    let thinking = "";
    const toolCalls: ToolCall[] = [];

    for (const block of (r?.content ?? []) as Array<Record<string, any>>) {
      if (block?.type === "text" && typeof block.text === "string") {
        text += block.text;
      } else if (
        block?.type === "thinking" &&
        typeof block.thinking === "string"
      ) {
        thinking += block.thinking;
      } else if (block?.type === "tool_use") {
        toolCalls.push({
          id: block.id ?? "",
          name: block.name ?? "",
          argsJson: JSON.stringify(block.input ?? {}),
          argsRaw: block.input,
        });
      }
    }

    return {
      id: typeof r?.id === "string" ? r.id : null,
      text,
      toolCalls,
      finishReason: r?.stop_reason ?? null,
      usage: {
        inputTokens: r?.usage?.input_tokens ?? null,
        outputTokens: r?.usage?.output_tokens ?? null,
        cachedInputTokens: r?.usage?.cache_read_input_tokens ?? null,
        reasoningTokens: null,
      },
      reasoningText: thinking || null,
      logprobs: undefined,
      raw,
    };
  },

  frameText(payload: unknown): string {
    const event = payload as any;
    if (event?.type === "content_block_delta") {
      const delta = event.delta;
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        return delta.text;
      }
      if (
        delta?.type === "thinking_delta" &&
        typeof delta.thinking === "string"
      ) {
        return delta.thinking;
      }
    }
    return "";
  },

  parseStream(frames: SSEFrame[]): StreamReply {
    const { payloads, errors } = parseFrameJson(frames);

    let id: string | null = null;
    let text = "";
    let thinking = "";
    let finishReason: string | null = null;
    const usage = emptyUsage();
    const blocks = new Map<
      number,
      { name?: string; id?: string; args: string }
    >();

    for (const payload of payloads) {
      const event = payload as any;

      switch (event?.type) {
        case "message_start":
          id = event.message?.id ?? null;
          usage.inputTokens = event.message?.usage?.input_tokens ?? null;
          usage.cachedInputTokens =
            event.message?.usage?.cache_read_input_tokens ?? null;
          break;

        case "content_block_start":
          if (event.content_block?.type === "tool_use") {
            blocks.set(event.index ?? blocks.size, {
              id: event.content_block.id,
              name: event.content_block.name,
              args: "",
            });
          }
          break;

        case "content_block_delta": {
          const delta = event.delta;
          if (delta?.type === "text_delta" && typeof delta.text === "string") {
            text += delta.text;
          } else if (
            delta?.type === "thinking_delta" &&
            typeof delta.thinking === "string"
          ) {
            thinking += delta.thinking;
          } else if (
            delta?.type === "input_json_delta" &&
            typeof delta.partial_json === "string"
          ) {
            const index = event.index ?? 0;
            const existing = blocks.get(index) ?? { args: "" };
            existing.args += delta.partial_json;
            blocks.set(index, existing);
          }
          break;
        }

        case "message_delta":
          if (event.delta?.stop_reason) finishReason = event.delta.stop_reason;
          if (event.usage?.output_tokens !== undefined) {
            usage.outputTokens = event.usage.output_tokens;
          }
          break;
      }
    }

    const toolCalls: ToolCall[] = [...blocks.entries()]
      .sort(([a], [b]) => a - b)
      .map(([i, block]) => ({
        id: block.id ?? `tc_${i}`,
        name: block.name ?? "",
        argsJson: block.args,
        argsRaw: block.args,
      }));

    return {
      id,
      text,
      toolCalls,
      finishReason,
      usage,
      reasoningText: thinking || null,
      logprobs: undefined,
      raw: payloads,
      eventTypes: payloads.map((p) => (p as any)?.type ?? "unknown"),
      frameCount: payloads.length,
      errors,
    };
  },
};
