import type { Tier } from "./outcome";

/**
 * The tier matrix, as data.
 *
 * This is the normative core of llmprobe: an engine that ships no Responses or
 * Messages surface *loses points*, because the goal is to push the ecosystem
 * toward the standards rather than grade each engine against its own ambitions.
 * Adding a new feature to the matrix is an entry here, not a new module.
 */

export interface SurfaceDef {
  id: string;
  label: string;
  tier: Tier;
  method: "GET" | "POST";
  /** Version-less path. The probe resolves `/v1` vs bare mounting. */
  path: string;
  /** Has a SurfaceAdapter — i.e. evals and shared tests can drive it. */
  chatShaped?: boolean;
}

export const SURFACES: SurfaceDef[] = [
  // ── Core: no serious engine has an excuse ──
  {
    id: "models",
    label: "/v1/models",
    tier: "core",
    method: "GET",
    path: "/models",
  },
  {
    id: "chat",
    label: "chat/completions",
    tier: "core",
    method: "POST",
    path: "/chat/completions",
    chatShaped: true,
  },

  // ── Extended: the standards we are pushing ──
  {
    id: "responses",
    label: "responses",
    tier: "extended",
    method: "POST",
    path: "/responses",
    chatShaped: true,
  },
  {
    id: "messages",
    label: "messages",
    tier: "extended",
    method: "POST",
    path: "/messages",
    chatShaped: true,
  },
  {
    id: "embeddings",
    label: "embeddings",
    tier: "extended",
    method: "POST",
    path: "/embeddings",
  },
  {
    id: "completions",
    label: "completions (legacy)",
    tier: "extended",
    method: "POST",
    path: "/completions",
  },

  // ── Frontier: full-surface parity ──
  {
    id: "images",
    label: "images/generations",
    tier: "frontier",
    method: "POST",
    path: "/images/generations",
  },
  {
    id: "audio-speech",
    label: "audio/speech",
    tier: "frontier",
    method: "POST",
    path: "/audio/speech",
  },
  {
    id: "audio-transcriptions",
    label: "audio/transcriptions",
    tier: "frontier",
    method: "POST",
    path: "/audio/transcriptions",
  },
];

export interface FeatureDef {
  id: string;
  label: string;
  tier: Tier;
  /**
   * The surface this feature is exercised through. If that surface is missing,
   * the feature is unsupported and costs its tier — which is the point: no
   * Responses surface means no MCP tools, and that should show.
   */
  surface: string;
}

export const FEATURES: FeatureDef[] = [
  // ── Core ──
  {
    id: "streaming",
    label: "streaming + SSE framing",
    tier: "core",
    surface: "chat",
  },
  { id: "tools", label: "tool calling", tier: "core", surface: "chat" },
  { id: "json-mode", label: "JSON mode", tier: "core", surface: "chat" },
  { id: "usage", label: "usage tokens", tier: "core", surface: "chat" },
  {
    id: "finish-reasons",
    label: "finish reasons",
    tier: "core",
    surface: "chat",
  },
  { id: "errors", label: "error codes", tier: "core", surface: "chat" },
  { id: "limits", label: "stop + max_tokens", tier: "core", surface: "chat" },

  // ── Extended ──
  {
    id: "structured-outputs",
    label: "structured outputs",
    tier: "extended",
    surface: "chat",
  },
  {
    id: "parallel-tools",
    label: "parallel tool calls",
    tier: "extended",
    surface: "chat",
  },
  { id: "vision", label: "vision", tier: "extended", surface: "chat" },
  { id: "logprobs", label: "logprobs", tier: "extended", surface: "chat" },
  {
    id: "reasoning",
    label: "reasoning items",
    tier: "extended",
    surface: "chat",
  },
  {
    id: "stream-usage",
    label: "streamed usage",
    tier: "extended",
    surface: "chat",
  },
  { id: "seed", label: "seed determinism", tier: "extended", surface: "chat" },
  {
    id: "sampling",
    label: "top_p sampling",
    tier: "extended",
    surface: "chat",
  },
  {
    id: "max-tokens-alias",
    label: "max_tokens legacy alias",
    tier: "extended",
    surface: "chat",
  },

  // ── Frontier ──
  {
    id: "mcp-tools",
    label: "MCP tools",
    tier: "frontier",
    surface: "responses",
  },
  // Multi-choice sampling is a cloud-API affordance: local engines almost
  // never batch n samples, and even OpenAI dropped `n` from Responses. Full
  // parity territory, not a standard to pressure every local engine toward.
  { id: "n-choices", label: "n>1 choices", tier: "frontier", surface: "chat" },
  {
    id: "rate-limiting",
    label: "rate limiting",
    tier: "frontier",
    surface: "chat",
  },
  {
    id: "prompt-caching",
    label: "prompt caching",
    tier: "frontier",
    surface: "chat",
  },
  {
    id: "previous-response-id",
    label: "previous_response_id chaining",
    tier: "frontier",
    surface: "responses",
  },
  {
    id: "background",
    label: "background responses",
    tier: "frontier",
    surface: "responses",
  },
];

/**
 * Detected, shown, worth exactly zero points.
 *
 * Ollama's native API is real and widely deployed, and pretending we didn't see
 * it would make the report dishonest. Scoring it would reward a non-standard
 * surface, which is the opposite of the point. So: credit, no points.
 */
export interface CreditDef {
  id: string;
  label: string;
  method: "GET" | "POST";
  /** Mounted at the host root, not under `/v1`. */
  path: string;
}

export const CREDITS: CreditDef[] = [
  {
    id: "ollama-native-chat",
    label: "Ollama-compatible /api/chat",
    method: "POST",
    path: "/api/chat",
  },
  {
    id: "ollama-native-tags",
    label: "Ollama-compatible /api/tags",
    method: "GET",
    path: "/api/tags",
  },
];

export const surfaceById = (id: string): SurfaceDef | undefined =>
  SURFACES.find((s) => s.id === id);

export const featureById = (id: string): FeatureDef | undefined =>
  FEATURES.find((f) => f.id === id);
