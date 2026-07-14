import type { z } from "zod";

import type { RunConfig } from "./client";
import type { SSEFrame } from "./sse";

// ── spec-agnostic request vocabulary ────────────────────────────────────────

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /**
   * Arguments normalised to a string, so every caller can parse them the same
   * way regardless of surface.
   */
  argsJson: string;
  /**
   * The arguments field exactly as it arrived on the wire, before any
   * normalisation.
   *
   * This exists because "arguments is a JSON *string*" is itself a spec claim
   * on OpenAI-shaped surfaces, and an engine that sends a bare object breaks
   * every SDK that calls JSON.parse on it. If the adapter quietly coerced that
   * away, the suite would launder a real defect into a pass. Anthropic is the
   * exception — its `input` is legitimately an object — hence the per-surface
   * `toolArgsAreJsonString` capability.
   */
  argsRaw?: unknown;
}

export type Turn =
  | { type: "user"; text: string }
  | { type: "user-image"; text: string; imageDataUrl: string }
  | { type: "assistant-text"; text: string }
  | { type: "assistant-tool-call"; call: ToolCall }
  | {
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      output: string;
    };

export type ToolChoice =
  | "auto"
  | "none"
  /**
   * Force *a* tool call. The engine tests lean on this hard: it removes model
   * variance from questions that are really about serialization.
   */
  | "required"
  | { name: string };

export type ResponseFormat =
  | { type: "json_object" }
  | { type: "json_schema"; name: string; schema: Record<string, unknown> };

export interface ChatRequest {
  turns: Turn[];
  system?: string;
  tools?: ToolDef[];
  toolChoice?: ToolChoice;
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  seed?: number;
  logprobs?: boolean;
  responseFormat?: ResponseFormat;
  parallelToolCalls?: boolean;
  /** Streamed usage opt-in (`stream_options.include_usage`). */
  includeUsage?: boolean;
  previousResponseId?: string;
  promptCacheKey?: string;
  /**
   * Reserve extra tokens for a reasoning model's hidden thinking.
   *
   * Defaults to true. Reasoning models spend their budget in `reasoning_content`
   * before writing a single visible token, so a request capped at 16 tokens comes
   * back with EMPTY content — which would make us score the model (and the
   * engine) on a limit we imposed ourselves. Set false only where truncation is
   * the actual subject of the test.
   */
  allowReasoning?: boolean;
  /** Escape hatch for surface-specific probes; merged over the built body. */
  extra?: Record<string, unknown>;
}

export interface ReplyUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
}

export interface ChatReply {
  id: string | null;
  text: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
  usage: ReplyUsage;
  /** Separate reasoning/thinking channel, when the surface has one. */
  reasoningText: string | null;
  logprobs: unknown;
  raw: unknown;
}

export interface StreamReply extends ChatReply {
  /** `event:` names in wire order — the basis of event-ordering assertions. */
  eventTypes: string[];
  /** Payload count, excluding `[DONE]`. */
  frameCount: number;
  errors: string[];
}

// ── the surface contract ────────────────────────────────────────────────────

export interface SurfaceCapabilities {
  tools: boolean;
  jsonMode: boolean;
  jsonSchema: boolean;
  logprobs: boolean;
  vision: boolean;
  seed: boolean;
  reasoningChannel: boolean;
  previousResponseId: boolean;
  promptCacheKey: boolean;
  parallelToolCalls: boolean;
  /** OpenAI-shaped streams end with `data: [DONE]`; Anthropic's do not. */
  streamEndsWithDone: boolean;
  /**
   * True where the spec says tool arguments travel as a JSON *string*
   * (chat/completions, Responses). False for Anthropic Messages, whose `input`
   * is a real object.
   */
  toolArgsAreJsonString: boolean;
  /**
   * True where a tool call is reflected in the finish reason —
   * chat/completions says `tool_calls`, Anthropic says `tool_use`. Responses
   * does NOT: a tool call leaves `status: "completed"`, and callers dispatch on
   * the output items instead. Demanding one there would fail a spec-compliant
   * engine.
   */
  signalsToolFinishReason: boolean;
}

/** Normalise a wire `arguments` value to a string without hiding its true type. */
export function normalizeToolArgs(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw === undefined || raw === null) return "";
  return JSON.stringify(raw);
}

/**
 * One API surface (chat/completions, responses, messages), reduced to a common
 * shape. Everything above this line — every conformance test and every eval —
 * is written once and runs against all three.
 */
export interface SurfaceAdapter {
  id: string;
  label: string;
  /** Version-less path, e.g. `/chat/completions`. The probe resolves `/v1`. */
  path: string;
  capabilities: SurfaceCapabilities;
  /** Extra headers — Anthropic needs `x-api-key` + `anthropic-version`. */
  headers(config: RunConfig): Record<string, string>;
  buildBody(request: ChatRequest, config: RunConfig): Record<string, unknown>;
  /** Zod schema for the non-streaming response. */
  responseSchema: z.ZodTypeAny;
  /** Zod schema for one streamed frame payload. */
  chunkSchema: z.ZodTypeAny;
  parse(raw: unknown): ChatReply;
  parseStream(frames: SSEFrame[]): StreamReply;
  /**
   * Generated text carried by a single streamed frame, or "" if the frame is an
   * opener/keepalive/terminator with no token in it.
   *
   * Used only by the benchmark, to timestamp the *first* frame that carries a
   * generated token — the basis of TTFT. Reasoning deltas count: the model has
   * started producing, which is what time-to-first-token measures.
   */
  frameText(payload: unknown): string;
}

// ── shared extraction helpers ───────────────────────────────────────────────

export const emptyUsage = (): ReplyUsage => ({
  inputTokens: null,
  outputTokens: null,
  cachedInputTokens: null,
  reasoningTokens: null,
});

/** Auth header for OpenAI-shaped surfaces. Absent when there's no key (Ollama). */
export function bearerAuth(config: RunConfig): Record<string, string> {
  return config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {};
}
