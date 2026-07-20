import { parseSSEFrames, type SSEFrame } from "./sse";

export interface RunConfig {
  /** Effective root, already resolved by the probe (e.g. http://host:8080/v1). */
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  depth: RunDepth;
  /**
   * Hard ceiling on total tokens. OpenRouter and OpenAI are paid, and a full
   * run with k=3 evals plus a long-context needle burns real money.
   */
  budgetTokens?: number;
  /**
   * Extra token budget granted to any request that needs a visible answer,
   * detected once per run. Zero for a normal model; substantial for a reasoning
   * model, which would otherwise spend the whole allowance thinking and return
   * empty content.
   */
  reasoningHeadroom: number;
}

export type RunDepth = "quick" | "default" | "full";

export class BudgetExceededError extends Error {
  constructor(spent: number, budget: number) {
    super(
      `token budget exhausted: spent ${spent.toLocaleString()} of ${budget.toLocaleString()}`,
    );
    this.name = "BudgetExceededError";
  }
}

export interface HttpResult {
  status: number;
  headers: Headers;
  /** Parsed JSON when the body was JSON, else undefined. */
  json?: unknown;
  text: string;
  durationMs: number;
}

export interface StreamResult {
  status: number;
  headers: Headers;
  contentType: string;
  raw: string;
  frames: SSEFrame[];
  durationMs: number;
}

export interface TimedStreamResult {
  status: number;
  frames: SSEFrame[];
  /** Wall-clock arrival of each frame, in the same order as `frames`. */
  frameTimesMs: number[];
  startMs: number;
  endMs: number;
  /** The whole body — on a non-200 this is the error JSON, not SSE frames. */
  raw: string;
}

/**
 * HTTP against one engine, with token accounting.
 *
 * Usage is tracked centrally rather than per-test so the run can enforce a
 * budget and print an honest total — including the tokens burned by tests that
 * failed or came back inconclusive.
 */
export class EngineClient {
  readonly usage = { inputTokens: 0, outputTokens: 0 };
  requests = 0;

  constructor(private readonly config: RunConfig) {}

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  private assertBudget(): void {
    const { budgetTokens } = this.config;
    if (budgetTokens === undefined) return;
    const spent = this.usage.inputTokens + this.usage.outputTokens;
    if (spent >= budgetTokens)
      throw new BudgetExceededError(spent, budgetTokens);
  }

  recordUsage(inputTokens?: number | null, outputTokens?: number | null): void {
    if (typeof inputTokens === "number") this.usage.inputTokens += inputTokens;
    if (typeof outputTokens === "number")
      this.usage.outputTokens += outputTokens;
  }

  async request(
    method: "GET" | "POST",
    path: string,
    options: {
      body?: unknown;
      headers?: Record<string, string>;
      timeoutMs?: number;
    } = {},
  ): Promise<HttpResult> {
    this.assertBudget();
    this.requests += 1;

    const start = Date.now();
    const response = await fetch(this.url(path), {
      method,
      headers: {
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        ...(options.headers ?? {}),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeoutMs ?? this.config.timeoutMs),
    });
    const durationMs = Date.now() - start;

    const text = await response.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      // Non-JSON body — the caller decides whether that's a violation.
    }

    return {
      status: response.status,
      headers: response.headers,
      json,
      text,
      durationMs,
    };
  }

  /**
   * POST expecting `text/event-stream`. The body is read whole rather than
   * consumed incrementally: the framing itself is under test, and you can't
   * audit framing through a parser that already normalised it away.
   */
  async stream(
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<StreamResult> {
    this.assertBudget();
    this.requests += 1;

    const start = Date.now();
    const response = await fetch(this.url(path), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...headers,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    const raw = await response.text();
    const durationMs = Date.now() - start;

    return {
      status: response.status,
      headers: response.headers,
      contentType: response.headers.get("content-type") ?? "",
      raw,
      frames: parseSSEFrames(raw),
      durationMs,
    };
  }

  /**
   * Stream a request and timestamp each frame as it arrives.
   *
   * Unlike `stream()`, which reads the whole body at once (to audit framing),
   * this consumes the body incrementally so we can capture time-to-first-token:
   * the wall-clock at which the first frame carrying a generated token lands.
   * That is the only extra thing the benchmark needs beyond total duration.
   */
  async streamTimed(
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<TimedStreamResult> {
    this.assertBudget();
    this.requests += 1;

    const startMs = Date.now();
    const response = await fetch(this.url(path), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...headers,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    const frames: SSEFrame[] = [];
    const frameTimesMs: number[] = [];
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    const separator = /\r?\n\r?\n/;
    let buffer = "";
    let raw = "";

    const flushFrame = (block: string): void => {
      const dataLines: string[] = [];
      let event: string | undefined;
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith(":")) continue;
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:"))
          dataLines.push(line.slice(5).trimStart());
      }
      if (dataLines.length === 0 && event === undefined) return;
      const data = dataLines.join("\n");
      frames.push({ index: frames.length, event, data, raw: block });
      frameTimesMs.push(Date.now());
    };

    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        raw += chunk;
        buffer += chunk;
        let match: RegExpExecArray | null;
        while ((match = separator.exec(buffer)) !== null) {
          const block = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);
          if (block.trim() !== "") flushFrame(block);
        }
      }
      if (buffer.trim() !== "") flushFrame(buffer);
    }

    return {
      status: response.status,
      frames,
      frameTimesMs,
      startMs,
      endMs: Date.now(),
      raw,
    };
  }
}
