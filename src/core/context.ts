import type {
  ChatReply,
  ChatRequest,
  StreamReply,
  SurfaceAdapter,
} from "./adapter";
import type { Asserter } from "./assert";
import type { EngineClient, RunConfig, RunDepth, StreamResult } from "./client";
import type { CreditEntry, EvalCategory, Tier } from "./outcome";

export interface SendResult {
  reply: ChatReply;
  status: number;
  headers: Headers;
  raw: unknown;
  text: string;
  durationMs: number;
}

export interface SendStreamResult {
  reply: StreamReply;
  stream: StreamResult;
}

/**
 * Everything a test can reach. Deliberately narrow: tests describe *what* to
 * check, never how to talk to a particular engine.
 */
export interface RunContext {
  config: RunConfig;
  client: EngineClient;
  depth: RunDepth;
  /** Adapters for surfaces this engine actually implements. */
  adapters: Map<string, SurfaceAdapter>;
  /** Surface ids the probe found. */
  present: Set<string>;
  /**
   * The surface the capability evals run through — the best chat-shaped one the
   * engine implements. A model's tool-calling ability is a fact about the model,
   * so we measure it through whatever door is open.
   */
  evalSurface: string | null;

  send(surface: string, request: ChatRequest): Promise<SendResult>;
  sendStream(surface: string, request: ChatRequest): Promise<SendStreamResult>;
  /** POST an arbitrary body to a surface — for malformed-request probes. */
  raw(
    surface: string,
    body: unknown,
  ): Promise<{
    status: number;
    json?: unknown;
    text: string;
    headers: Headers;
  }>;
}

/**
 * What a conformance test learned about the feature it exercises.
 *
 * `featureSupported: false` costs Coverage. Crucially, that is *independent* of
 * whether the test also recorded MUST failures — an engine that accepts
 * `logprobs` with a 200 and returns none is both missing the feature (Coverage)
 * and lying to its callers (Conformance). Both, not either.
 */
export interface TestVerdict {
  featureSupported?: boolean;
  unsupportedDetail?: string;
  /**
   * A zero-point observation, the same bargain the Ollama-native credit strikes:
   * detected, printed, never scored. For behavior that is real and worth
   * reporting but belongs to no spec — an engine's assistant-prefill dialect,
   * say — where scoring it would pressure every engine toward one vendor.
   */
  credit?: CreditEntry;
}

export interface ConformanceTest {
  id: string;
  name: string;
  /** Surface id. If the engine lacks it, the test never runs. */
  surface: string;
  tier: Tier;
  /** The feature this test proves the existence (and correctness) of. */
  feature?: string;
  /** Slow enough to skip below `--full` (long context, concurrency, stress). */
  slow?: boolean;
  /** Part of the `--quick` smoke set. */
  quick?: boolean;
  run(ctx: RunContext, a: Asserter): Promise<TestVerdict | void>;
}

export interface EvalDef {
  id: string;
  name: string;
  category: EvalCategory;
  /**
   * Samples per item. Tool and JSON evals use 3: a model that picks the right
   * tool two times in three is the single most useful fact about it, and one
   * sample hides that completely.
   */
  k?: number;
  /** Feature the eval needs — skipped as unsupported when the engine lacks it. */
  requiresFeature?: string;
  slow?: boolean;
  run(ctx: RunContext): Promise<{ passed: boolean; message?: string }>;
}

/** Build a RunContext over a live client. */
export function createContext(options: {
  config: RunConfig;
  client: EngineClient;
  adapters: Map<string, SurfaceAdapter>;
  present: Set<string>;
  evalSurface: string | null;
}): RunContext {
  const { config, client, adapters, present, evalSurface } = options;

  const adapterFor = (surface: string): SurfaceAdapter => {
    const adapter = adapters.get(surface);
    if (!adapter)
      throw new Error(`no adapter registered for surface "${surface}"`);
    return adapter;
  };

  /**
   * Give a reasoning model room to think *and* answer.
   *
   * Without this, every request capped at a small `maxTokens` comes back with
   * empty content on a reasoning model — and we would score that as the model
   * failing, or the engine returning nothing, when in fact we simply never gave
   * it enough tokens to finish thinking. Truncation tests opt out.
   */
  const withHeadroom = (request: ChatRequest): ChatRequest => {
    if (request.maxTokens === undefined) return request;
    if (request.allowReasoning === false) return request;
    if (config.reasoningHeadroom <= 0) return request;
    return {
      ...request,
      maxTokens: request.maxTokens + config.reasoningHeadroom,
    };
  };

  return {
    config,
    client,
    depth: config.depth,
    adapters,
    present,
    evalSurface,

    async send(surface, request) {
      const adapter = adapterFor(surface);
      const body = adapter.buildBody(withHeadroom(request), config);

      const result = await client.request("POST", adapter.path, {
        body,
        headers: adapter.headers(config),
      });

      const reply = adapter.parse(result.json);
      client.recordUsage(reply.usage.inputTokens, reply.usage.outputTokens);

      return {
        reply,
        status: result.status,
        headers: result.headers,
        raw: result.json,
        text: result.text,
        durationMs: result.durationMs,
      };
    },

    async sendStream(surface, request) {
      const adapter = adapterFor(surface);
      const body = {
        ...adapter.buildBody(withHeadroom(request), config),
        stream: true,
      };

      const stream = await client.stream(
        adapter.path,
        body,
        adapter.headers(config),
      );

      const reply = adapter.parseStream(stream.frames);
      client.recordUsage(reply.usage.inputTokens, reply.usage.outputTokens);

      return { reply, stream };
    },

    async raw(surface, body) {
      const adapter = adapterFor(surface);
      const result = await client.request("POST", adapter.path, {
        body,
        headers: adapter.headers(config),
      });
      return {
        status: result.status,
        json: result.json,
        text: result.text,
        headers: result.headers,
      };
    },
  };
}
