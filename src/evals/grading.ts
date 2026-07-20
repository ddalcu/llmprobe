/**
 * Deterministic grading. Every eval in this suite has a machine-checkable
 * answer — no LLM judge, no second API key, no unreproducible scores.
 *
 * The graders are deliberately forgiving about *form* (case, punctuation,
 * "The answer is..." preambles) and strict about *substance*. We are asking
 * "does this model clear the floor", not "did it format its reply the way I like" —
 * except where formatting IS the thing under test, in which case the strictness
 * is the point.
 */

/**
 * Remove an inline chain-of-thought block.
 *
 * Well-behaved engines put reasoning in a separate channel, but several inline
 * it as `<think>...</think>` inside the content. Grading the scratchpad instead
 * of the answer would be nonsense — the model may consider and reject the right
 * answer mid-thought.
 */
export function stripThinking(text: string): string {
  return (
    text
      .replace(/<think>[\s\S]*?<\/think>/gi, " ")
      .replace(/<\|?thinking\|?>[\s\S]*?<\/?\|?thinking\|?>/gi, " ")
      // An unterminated block means the model ran out of tokens mid-thought;
      // there is no answer in there to find.
      .replace(/<think>[\s\S]*$/i, " ")
      .trim()
  );
}

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalize(text: string): string {
  return stripThinking(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Does the answer contain this word, as a whole word? */
export function saysWord(text: string, word: string): boolean {
  return new RegExp(`\\b${word.toLowerCase()}\\b`).test(normalize(text));
}

/** The first integer anywhere in the reply. */
export function firstNumber(text: string): number | null {
  const match = text.replace(/,/g, "").match(/-?\d+/);
  return match ? Number(match[0]) : null;
}

/** Every standalone integer in the reply, in order. */
export function allNumbers(text: string): number[] {
  const matches = text.replace(/,/g, "").match(/-?\d+/g);
  return matches ? matches.map(Number) : [];
}

export interface Graded {
  passed: boolean;
  message?: string;
}

export const pass = (): Graded => ({ passed: true });

export const fail = (message: string): Graded => ({ passed: false, message });

export function expectWord(text: string, word: string, label: string): Graded {
  return saysWord(text, word)
    ? pass()
    : fail(`${label}: expected "${word}", got "${text.slice(0, 80)}"`);
}

/**
 * Passes if the expected value appears as a standalone number anywhere in the
 * reply.
 *
 * Deliberately not "the first number": a model that restates the problem
 * ("17 * 24 = 408") would be failed for its phrasing rather than its answer,
 * and we grade substance, not form. A wrong answer still fails, because the
 * right number simply isn't there.
 */
export function expectNumber(
  text: string,
  value: number,
  label: string,
): Graded {
  const found = allNumbers(text);
  return found.includes(value)
    ? pass()
    : fail(
        `${label}: expected ${value}, got ${found.length ? found.join(", ") : `"${text.slice(0, 60)}"`}`,
      );
}

/**
 * JSON discipline is graded WITHOUT stripping code fences. Wrapping JSON in
 * ```json when told not to is precisely the model failure this measures — a
 * lenient parser here would hide the thing we are looking for.
 */
export function parseStrictJson(text: string): {
  ok: boolean;
  value?: unknown;
  reason?: string;
} {
  const trimmed = text.trim();

  if (trimmed.startsWith("```")) {
    return { ok: false, reason: "wrapped the JSON in a markdown code fence" };
  }

  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return {
      ok: false,
      reason: `not parseable as JSON: "${trimmed.slice(0, 80)}"`,
    };
  }
}
