import type { z } from "zod";

import type { AssertionResult, Severity } from "./outcome";

/**
 * Collects assertions for one conformance test.
 *
 * Severity is chosen at the call site, which is the only place that knows what
 * a violation actually costs a caller: a wrong `finish_reason` breaks every
 * consumer (MUST), a missing `system_fingerprint` breaks none (SHOULD).
 */
export class Asserter {
  private readonly collected: AssertionResult[] = [];

  private add(
    severity: Severity,
    id: string,
    label: string,
    passed: boolean,
    message?: string,
  ): boolean {
    this.collected.push({
      id,
      label,
      severity,
      passed,
      message: passed ? undefined : message,
    });
    return passed;
  }

  must(id: string, label: string, passed: boolean, message?: string): boolean {
    return this.add("MUST", id, label, passed, message);
  }

  should(
    id: string,
    label: string,
    passed: boolean,
    message?: string,
  ): boolean {
    return this.add("SHOULD", id, label, passed, message);
  }

  may(id: string, label: string, passed: boolean, message?: string): boolean {
    return this.add("MAY", id, label, passed, message);
  }

  /**
   * Validate against a generated Zod schema.
   *
   * Unknown fields are never a violation — engines legitimately add their own
   * (llama.cpp emits timings, Ollama its own metadata), and failing them would
   * be a false positive. Zod objects are non-strict by default, so this is a
   * matter of not opting into `.strict()` anywhere.
   */
  schema(
    id: string,
    label: string,
    schema: z.ZodTypeAny,
    value: unknown,
    severity: Severity = "MUST",
  ): boolean {
    const parsed = schema.safeParse(value);
    if (parsed.success) return this.add(severity, id, label, true);

    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    const more =
      parsed.error.issues.length > 5
        ? ` (+${parsed.error.issues.length - 5} more)`
        : "";

    return this.add(severity, id, label, false, `${issues}${more}`);
  }

  get results(): AssertionResult[] {
    return this.collected;
  }

  get failedMust(): boolean {
    return this.collected.some((a) => a.severity === "MUST" && !a.passed);
  }
}

/**
 * Thrown by a test to declare that the engine was never exercised — the model
 * refused to play along (no tool call even under `tool_choice: "required"`).
 * Distinct from a failure: we learned nothing about the engine, so scoring it
 * either way would be a lie.
 */
export class Inconclusive extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "Inconclusive";
  }
}

/** Thrown by a test whose surface or feature the engine doesn't implement. */
export class Unsupported extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "Unsupported";
  }
}

// ── pure helpers (carried over from the old behavior-helpers) ────────────────

/**
 * Wrappers an engine is supposed to strip out of `content` and hand back on a
 * reasoning channel. Finding one in the visible text is unambiguous: no model
 * emits these as an answer, so the engine failed to separate the channel.
 */
const THINKING_TAGS: Array<[RegExp, string]> = [
  [/<\/?think>/i, "<think>"],
  [/<\|?thinking\|?>/i, "<thinking>"],
  [/<\/?thought>/i, "<thought>"],
  [/\[\/?think(ing)?\]/i, "[thinking]"],
  [/◁\/?think▷/, "◁think▷"],
  [/<\|channel\|>\s*analysis/i, "<|channel|>analysis"],
];

/**
 * Openers that mark first-person deliberation rather than an answer. Anchored
 * at the start, because the tell is a response that *begins* by narrating its
 * own reasoning about the request instead of replying to it.
 */
const THINKING_OPENERS: RegExp[] = [
  /^here'?s\s+(a|my|the)\s+(thinking|thought|reasoning)\s+process/i,
  /^(thinking|thought|reasoning)\s*(process)?\s*:/i,
  /^(okay|alright|ok|hmm|so)[,.!]?\s+(so\s+)?the\s+user\s+(is\s+)?(asking|wants|said|has|just)/i,
  /^let'?s\s+(think|break\s+(this|it)\s+down)/i,
  /^first[,.]?\s+i\s+(need|should|must)\b/i,
  /^i\s+need\s+to\s+(figure\s+out|work\s+out|determine|analy[sz]e)/i,
  /^\*\*\s*(analy[sz]|identify|understand|deconstruct|step\s*1)/i,
];

export interface ReasoningLeak {
  /** The wrapper found in visible content, if any. Unambiguous engine bug. */
  tag: string | null;
  /** Untagged deliberation the reply opened with. Weaker: could be the model. */
  opener: string | null;
}

/**
 * Did chain-of-thought end up in the user-visible content?
 *
 * Two strengths of evidence, kept apart on purpose. A thinking *tag* in
 * `content` can only be the engine failing to strip a channel it was handed.
 * Untagged deliberation — "Here's a thinking process: 1. **Analyze User
 * Input:** ..." — is the same bug wearing no markers, but a rambling model
 * asked for a short answer looks identical from outside, so it cannot carry the
 * same weight.
 */
export function detectReasoningLeak(text: string): ReasoningLeak {
  const trimmed = text.trim();
  const tag = THINKING_TAGS.find(([re]) => re.test(trimmed))?.[1] ?? null;
  const opener =
    THINKING_OPENERS.find((re) => re.test(trimmed)) !== undefined
      ? trimmed.slice(0, 60).replace(/\s+/g, " ")
      : null;
  return { tag, opener };
}

/** Deterministic filler text of approximately `bytes` bytes. */
export function buildLongPrefix(seed: string, bytes: number): string {
  if (bytes <= 0) return "";
  const sentence = `${seed} `.trim() + " ";
  const out: string[] = [];
  let len = 0;
  let i = 0;
  while (len < bytes) {
    const piece = `[${i}] ${sentence}`;
    out.push(piece);
    len += piece.length;
    i += 1;
  }
  return out.join("").slice(0, bytes);
}

export function buildHaystackWithNeedle(options: {
  fillerBytes: number;
  needle: string;
  position?: "start" | "middle" | "end";
}): string {
  const filler = buildLongPrefix(
    "The quick brown fox jumps over the lazy dog.",
    options.fillerBytes,
  );
  const half = Math.floor(filler.length / 2);
  switch (options.position ?? "middle") {
    case "start":
      return `${options.needle}\n\n${filler}`;
    case "end":
      return `${filler}\n\n${options.needle}`;
    default:
      return `${filler.slice(0, half)}\n\n${options.needle}\n\n${filler.slice(half)}`;
  }
}

/** Run `factory(i)` for i in [0, n) at most `concurrency` at a time. */
export async function runConcurrent<T>(
  n: number,
  concurrency: number,
  factory: (i: number) => Promise<T>,
): Promise<T[]> {
  const results: T[] = new Array(n);
  let next = 0;
  const limit = Math.max(1, Math.min(concurrency, n));

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= n) return;
      results[i] = await factory(i);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

/**
 * Length-style finish reasons across specs: chat-completions says `length`,
 * Anthropic says `max_tokens`, Responses says `max_output_tokens`.
 */
export function isLengthStyleFinish(finishReason: string): boolean {
  return /length|max[_-](output[_-])?tokens/i.test(finishReason);
}

/** Token-Jaccard similarity — tolerant of whitespace/punctuation drift. */
export function approxTextSimilarity(a: string, b: string): number {
  const tokenize = (s: string) =>
    new Set((s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(Boolean));
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection += 1;
  return intersection / (ta.size + tb.size - intersection);
}

/**
 * Strip markdown code fences before JSON parsing.
 *
 * Note this is used only where the *engine* is under test. The JSON-discipline
 * eval deliberately does NOT strip fences — emitting them is exactly the model
 * failure that eval exists to catch.
 */
export function stripCodeFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  return (fenced?.[1] ?? text).trim();
}

export function tryParseJson(text: string): { ok: boolean; value?: unknown } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}
