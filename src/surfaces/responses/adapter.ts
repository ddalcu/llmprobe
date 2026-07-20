import { z } from "zod";

import { errorStreamingEventSchema } from "../../generated/kubb/responses/zod/errorStreamingEventSchema";
import { responseCompletedStreamingEventSchema } from "../../generated/kubb/responses/zod/responseCompletedStreamingEventSchema";
import { responseContentPartAddedStreamingEventSchema } from "../../generated/kubb/responses/zod/responseContentPartAddedStreamingEventSchema";
import { responseContentPartDoneStreamingEventSchema } from "../../generated/kubb/responses/zod/responseContentPartDoneStreamingEventSchema";
import { responseCreatedStreamingEventSchema } from "../../generated/kubb/responses/zod/responseCreatedStreamingEventSchema";
import { responseFailedStreamingEventSchema } from "../../generated/kubb/responses/zod/responseFailedStreamingEventSchema";
import { responseFunctionCallArgumentsDeltaStreamingEventSchema } from "../../generated/kubb/responses/zod/responseFunctionCallArgumentsDeltaStreamingEventSchema";
import { responseFunctionCallArgumentsDoneStreamingEventSchema } from "../../generated/kubb/responses/zod/responseFunctionCallArgumentsDoneStreamingEventSchema";
import { responseInProgressStreamingEventSchema } from "../../generated/kubb/responses/zod/responseInProgressStreamingEventSchema";
import { responseIncompleteStreamingEventSchema } from "../../generated/kubb/responses/zod/responseIncompleteStreamingEventSchema";
import { responseOutputItemAddedStreamingEventSchema } from "../../generated/kubb/responses/zod/responseOutputItemAddedStreamingEventSchema";
import { responseOutputItemDoneStreamingEventSchema } from "../../generated/kubb/responses/zod/responseOutputItemDoneStreamingEventSchema";
import { responseOutputTextAnnotationAddedStreamingEventSchema } from "../../generated/kubb/responses/zod/responseOutputTextAnnotationAddedStreamingEventSchema";
import { responseOutputTextDeltaStreamingEventSchema } from "../../generated/kubb/responses/zod/responseOutputTextDeltaStreamingEventSchema";
import { responseOutputTextDoneStreamingEventSchema } from "../../generated/kubb/responses/zod/responseOutputTextDoneStreamingEventSchema";
import { responseQueuedStreamingEventSchema } from "../../generated/kubb/responses/zod/responseQueuedStreamingEventSchema";
import { responseReasoningDeltaStreamingEventSchema } from "../../generated/kubb/responses/zod/responseReasoningDeltaStreamingEventSchema";
import { responseReasoningDoneStreamingEventSchema } from "../../generated/kubb/responses/zod/responseReasoningDoneStreamingEventSchema";
import { responseReasoningSummaryDeltaStreamingEventSchema } from "../../generated/kubb/responses/zod/responseReasoningSummaryDeltaStreamingEventSchema";
import { responseReasoningSummaryDoneStreamingEventSchema } from "../../generated/kubb/responses/zod/responseReasoningSummaryDoneStreamingEventSchema";
import { responseReasoningSummaryPartAddedStreamingEventSchema } from "../../generated/kubb/responses/zod/responseReasoningSummaryPartAddedStreamingEventSchema";
import { responseReasoningSummaryPartDoneStreamingEventSchema } from "../../generated/kubb/responses/zod/responseReasoningSummaryPartDoneStreamingEventSchema";
import { responseRefusalDeltaStreamingEventSchema } from "../../generated/kubb/responses/zod/responseRefusalDeltaStreamingEventSchema";
import { responseRefusalDoneStreamingEventSchema } from "../../generated/kubb/responses/zod/responseRefusalDoneStreamingEventSchema";
import { responseResourceSchema } from "../../generated/kubb/responses/zod/responseResourceSchema";
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

/** Every streaming event the Responses spec defines. */
export const responsesStreamEventSchema = z.union([
  responseCreatedStreamingEventSchema,
  responseQueuedStreamingEventSchema,
  responseInProgressStreamingEventSchema,
  responseCompletedStreamingEventSchema,
  responseFailedStreamingEventSchema,
  responseIncompleteStreamingEventSchema,
  responseOutputItemAddedStreamingEventSchema,
  responseOutputItemDoneStreamingEventSchema,
  responseContentPartAddedStreamingEventSchema,
  responseContentPartDoneStreamingEventSchema,
  responseOutputTextDeltaStreamingEventSchema,
  responseOutputTextDoneStreamingEventSchema,
  responseRefusalDeltaStreamingEventSchema,
  responseRefusalDoneStreamingEventSchema,
  responseFunctionCallArgumentsDeltaStreamingEventSchema,
  responseFunctionCallArgumentsDoneStreamingEventSchema,
  responseReasoningSummaryPartAddedStreamingEventSchema,
  responseReasoningSummaryPartDoneStreamingEventSchema,
  responseReasoningDeltaStreamingEventSchema,
  responseReasoningDoneStreamingEventSchema,
  responseReasoningSummaryDeltaStreamingEventSchema,
  responseReasoningSummaryDoneStreamingEventSchema,
  responseOutputTextAnnotationAddedStreamingEventSchema,
  errorStreamingEventSchema,
]);

function turnToInput(turn: Turn): unknown {
  switch (turn.type) {
    case "user":
      return {
        role: "user",
        content: [{ type: "input_text", text: turn.text }],
      };
    case "user-image":
      return {
        role: "user",
        content: [
          { type: "input_text", text: turn.text },
          { type: "input_image", image_url: turn.imageDataUrl },
        ],
      };
    case "assistant-text":
      return {
        role: "assistant",
        content: [{ type: "output_text", text: turn.text }],
      };
    case "assistant-tool-call":
      return {
        type: "function_call",
        call_id: turn.call.id,
        name: turn.call.name,
        arguments: turn.call.argsJson,
      };
    case "tool-result":
      return {
        type: "function_call_output",
        call_id: turn.toolCallId,
        output: turn.output,
      };
  }
}

function toolChoiceBody(choice: ToolChoice): unknown {
  if (typeof choice === "string") return choice;
  return { type: "function", name: choice.name };
}

/** Walk the `output` item list, which is where Responses puts everything. */
function readOutput(raw: unknown): {
  text: string;
  reasoning: string;
  toolCalls: ToolCall[];
} {
  const output = (raw as { output?: unknown[] })?.output ?? [];
  let text = "";
  let reasoning = "";
  const toolCalls: ToolCall[] = [];

  for (const item of output as Array<Record<string, any>>) {
    if (item?.type === "message") {
      for (const part of item.content ?? []) {
        if (part?.type === "output_text" && typeof part.text === "string") {
          text += part.text;
        }
      }
    } else if (item?.type === "function_call") {
      toolCalls.push({
        id: item.call_id ?? item.id ?? "",
        name: item.name ?? "",
        argsJson: normalizeToolArgs(item.arguments),
        argsRaw: item.arguments,
      });
    } else if (item?.type === "reasoning") {
      for (const part of item.summary ?? []) {
        if (typeof part?.text === "string") reasoning += part.text;
      }
      for (const part of item.content ?? []) {
        if (typeof part?.text === "string") reasoning += part.text;
      }
    }
  }

  return { text, reasoning, toolCalls };
}

/**
 * Responses reports completion via `status` plus `incomplete_details.reason`
 * rather than a single `finish_reason` field. We normalise to one string so the
 * shared tests can reason about it uniformly across surfaces.
 */
function readFinishReason(raw: unknown): string | null {
  const r = raw as any;
  if (r?.incomplete_details?.reason) return r.incomplete_details.reason;
  if (typeof r?.status === "string") return r.status;
  return null;
}

export const responsesAdapter: SurfaceAdapter = {
  id: "responses",
  label: "responses",
  path: "/responses",

  capabilities: {
    tools: true,
    jsonMode: true,
    jsonSchema: true,
    logprobs: false,
    vision: true,
    seed: false,
    reasoningChannel: true,
    previousResponseId: true,
    promptCacheKey: true,
    parallelToolCalls: true,
    streamEndsWithDone: true,
    toolArgsAreJsonString: true,
    signalsToolFinishReason: false,
  },

  headers: (config) => bearerAuth(config),

  reasoningOptIn: { reasoning: { effort: "low" } },

  responseSchema: responseResourceSchema,
  chunkSchema: responsesStreamEventSchema,

  buildBody(request: ChatRequest, config: RunConfig): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: config.model,
      input: request.turns.map(turnToInput),
    };

    if (request.system) body.instructions = request.system;
    if (request.temperature !== undefined)
      body.temperature = request.temperature;
    if (request.topP !== undefined) body.top_p = request.topP;
    if (request.maxTokens !== undefined)
      body.max_output_tokens = request.maxTokens;

    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
    }
    if (request.toolChoice !== undefined) {
      body.tool_choice = toolChoiceBody(request.toolChoice);
    }
    if (request.parallelToolCalls !== undefined) {
      body.parallel_tool_calls = request.parallelToolCalls;
    }

    // Responses expresses structured output through `text.format` rather than
    // `response_format`.
    if (request.responseFormat) {
      body.text =
        request.responseFormat.type === "json_object"
          ? { format: { type: "json_object" } }
          : {
              format: {
                type: "json_schema",
                name: request.responseFormat.name,
                schema: request.responseFormat.schema,
                strict: true,
              },
            };
    }

    if (request.previousResponseId) {
      body.previous_response_id = request.previousResponseId;
    }
    if (request.promptCacheKey) body.prompt_cache_key = request.promptCacheKey;

    return { ...body, ...(request.extra ?? {}) };
  },

  parse(raw: unknown): ChatReply {
    const r = raw as any;
    const { text, reasoning, toolCalls } = readOutput(raw);
    const usage = r?.usage;

    return {
      id: typeof r?.id === "string" ? r.id : null,
      text,
      toolCalls,
      finishReason: readFinishReason(raw),
      usage: {
        inputTokens: usage?.input_tokens ?? null,
        outputTokens: usage?.output_tokens ?? null,
        cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? null,
        reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? null,
      },
      reasoningText: reasoning || null,
      logprobs: undefined,
      raw,
    };
  },

  frameText(payload: unknown): string {
    const event = payload as any;
    if (
      event?.type === "response.output_text.delta" &&
      typeof event.delta === "string"
    ) {
      return event.delta;
    }
    if (
      (event?.type === "response.reasoning_text.delta" ||
        event?.type === "response.reasoning_summary_text.delta") &&
      typeof event.delta === "string"
    ) {
      return event.delta;
    }
    return "";
  },

  parseStream(frames: SSEFrame[]): StreamReply {
    const { payloads, errors } = parseFrameJson(frames);

    let text = "";
    let reasoning = "";
    let final: unknown;
    const toolAcc = new Map<
      number,
      { id?: string; name?: string; args: string }
    >();

    for (const payload of payloads) {
      const event = payload as any;

      switch (event?.type) {
        case "response.output_text.delta":
          if (typeof event.delta === "string") text += event.delta;
          break;
        case "response.reasoning_summary_text.delta":
        case "response.reasoning_text.delta":
          if (typeof event.delta === "string") reasoning += event.delta;
          break;
        case "response.output_item.added":
          if (event.item?.type === "function_call") {
            toolAcc.set(event.output_index ?? toolAcc.size, {
              id: event.item.call_id ?? event.item.id,
              name: event.item.name,
              args: "",
            });
          }
          break;
        case "response.function_call_arguments.delta": {
          const index = event.output_index ?? 0;
          const existing = toolAcc.get(index) ?? { args: "" };
          if (typeof event.delta === "string") existing.args += event.delta;
          toolAcc.set(index, existing);
          break;
        }
        case "response.completed":
        case "response.incomplete":
        case "response.failed":
          final = event.response;
          break;
      }
    }

    // The terminal `response.completed` event carries the whole resource, which
    // is authoritative — prefer it over our reassembly, and use the deltas only
    // to prove the stream and the final agree.
    const fromFinal = final ? responsesAdapter.parse(final) : null;

    const toolCalls: ToolCall[] = [...toolAcc.entries()]
      .sort(([a], [b]) => a - b)
      .map(([i, tc]) => ({
        id: tc.id ?? `tc_${i}`,
        name: tc.name ?? "",
        argsJson: tc.args,
        argsRaw: tc.args,
      }));

    return {
      id: fromFinal?.id ?? null,
      text: text || (fromFinal?.text ?? ""),
      toolCalls: toolCalls.length ? toolCalls : (fromFinal?.toolCalls ?? []),
      finishReason: fromFinal?.finishReason ?? null,
      usage: fromFinal?.usage ?? emptyUsage(),
      reasoningText: reasoning || (fromFinal?.reasoningText ?? null),
      logprobs: undefined,
      raw: payloads,
      eventTypes: payloads.map((p) => (p as any)?.type ?? "unknown"),
      frameCount: payloads.length,
      errors,
    };
  },
};
