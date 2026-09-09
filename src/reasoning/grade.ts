import type { ReasoningCase } from "./types";

const isAlpha = (c: string | undefined): boolean =>
  c !== undefined && /[A-Za-z]/.test(c);
const isDigit = (c: string | undefined): boolean =>
  c !== undefined && c >= "0" && c <= "9";
const boundary = (before: string | undefined, after: string | undefined) =>
  !isAlpha(before) && !isAlpha(after);

export const isMultipleChoice = (tc: ReasoningCase): boolean =>
  (tc.choices?.length ?? 0) > 0;
export const isCompsec = (tc: ReasoningCase): boolean =>
  tc.source === "COMPSEC" || tc.source === "NIST Juliet";

export function visibleText(generated: string): string {
  const i = generated.lastIndexOf("</think>");
  return i >= 0 ? generated.slice(i + 8) : generated;
}

/** Offset of the last "answer" followed by ':', else the first bare "answer", else -1. */
function findLastAnswerMarker(visible: string): number {
  let last = -1;
  let first = -1;
  const lower = visible.toLowerCase();
  let p = lower.indexOf("answer");
  while (p >= 0) {
    if (boundary(visible[p - 1], visible[p + 6])) {
      if (first < 0) first = p;
      let q = p + 6;
      while (q < visible.length && /\s/.test(visible[q]!)) q++;
      if (visible[q] === ":") last = p;
    }
    p = lower.indexOf("answer", p + 1);
  }
  return last >= 0 ? last : first;
}

const NEGATION_CUES = new Set([
  "not",
  "except",
  "excluding",
  "exclude",
  "excludes",
  "eliminate",
  "eliminates",
  "eliminated",
  "reject",
  "rejects",
  "rejected",
  "rejecting",
]);

/** True when the letter at `at` is explicitly rejected by the word before it on the same line. */
function letterIsNegated(text: string, start: number, at: number): boolean {
  let p = at;
  while (p > start) {
    const c = text[p - 1]!;
    if (c === "\n") return false;
    if (c === " " || c === "\t" || c === "," || c === ";") p--;
    else break;
  }
  const wend = p;
  while (p > start && (isAlpha(text[p - 1]) || text[p - 1] === "'")) p--;
  const w = text.slice(p, wend).toLowerCase();
  if (w.length === 0 || w.length >= 16) return false;
  if (w.endsWith("n't")) return true;
  if (NEGATION_CUES.has(w)) return true;
  if (w === "out") {
    let q = p;
    while (q > start && (text[q - 1] === " " || text[q - 1] === "\t")) q--;
    const rend = q;
    while (q > start && isAlpha(text[q - 1])) q--;
    const r = text.slice(q, rend).toLowerCase();
    if (r === "rule" || r === "rules" || r === "ruled") return true;
  }
  return false;
}

/** `anchored` means the answer came from an explicit "Answer:" marker, not a trailing-token fallback. */
export interface ExtractedAnswer {
  got: string;
  anchored: boolean;
}

const found = (got: string, anchored: boolean): ExtractedAnswer => ({
  got,
  anchored,
});

function findAnswerLetter(
  generated: string,
  nchoices: number,
): ExtractedAnswer {
  if (nchoices <= 0) return found("?", false);
  const visible = visibleText(generated);
  const max = String.fromCharCode(64 + nchoices);
  const inRange = (c: string) => c >= "A" && c <= max;

  const answer = findLastAnswerMarker(visible);
  if (answer >= 0) {
    const end = Math.min(visible.length, answer + 96);
    for (let p = answer; p < end; p++) {
      const c = visible[p]!.toUpperCase();
      if (!inRange(c)) continue;
      if (!boundary(visible[p - 1], visible[p + 1])) continue;
      const after = visible[p + 1];
      // "I think", "A careful", "I'll": prose, not the pick.
      if (after === "'") continue;
      if (after === " " || after === "\t") {
        let w = p + 1;
        while (visible[w] === " " || visible[w] === "\t") w++;
        const n = visible[w];
        if (n !== undefined && n >= "a" && n <= "z") continue;
      }
      if (letterIsNegated(visible, answer, p)) continue;
      return found(c, true);
    }
  }

  for (let p = visible.length - 1; p >= 0; p--) {
    const c = visible[p]!.toUpperCase();
    if (inRange(c) && boundary(visible[p - 1], visible[p + 1]))
      return found(c, false);
  }
  return found("?", false);
}

const normalizeInteger = (s: string): string => s.replace(/^0+(?=\d)/, "");

function firstInteger(s: string): string | null {
  const m = /\d+/.exec(s);
  return m ? normalizeInteger(m[0]) : null;
}

function findIntegerAnswer(generated: string): ExtractedAnswer {
  const visible = visibleText(generated);
  const answer = findLastAnswerMarker(visible);
  if (answer >= 0) {
    let line = visible.slice(answer, answer + 160);
    const nl = line.indexOf("\n");
    if (nl >= 0) line = line.slice(0, nl);
    // "m+n = 256+37 = 293": the stated result is right of the last '='.
    const eq = line.lastIndexOf("=");
    const rhs = eq >= 0 ? firstInteger(line.slice(eq + 1)) : null;
    if (rhs !== null) return found(rhs, true);
    const first = firstInteger(line);
    if (first !== null) return found(first, true);
  }
  const all = visible.match(/\d+/g);
  return all
    ? found(normalizeInteger(all[all.length - 1]!), false)
    : found("?", false);
}

/** "line 9", "9 and 15", "20-22" → "9", "9,15", "20-22". */
function normalizeLineSpec(line: string): string {
  const parts: string[] = [];
  const re = /(\d+)(?:\s*-\s*(\d+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) parts.push(m[2] ? `${m[1]}-${m[2]}` : m[1]!);
  return parts.length ? parts.join(",") : "?";
}

function findCompsecAnswer(generated: string): ExtractedAnswer {
  const visible = visibleText(generated);
  const answer = findLastAnswerMarker(visible);
  if (answer >= 0) {
    let line = visible.slice(answer, answer + 160);
    const nl = line.indexOf("\n");
    if (nl >= 0) line = line.slice(0, nl);
    const spec = normalizeLineSpec(line);
    if (spec !== "?") return found(spec, true);
  }
  return findIntegerAnswer(generated);
}

function parseLineSpec(spec: string): Set<number> {
  const set = new Set<number>();
  const re = /(\d+)(?:-(\d+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(spec))) {
    let a = Number(m[1]);
    let b = m[2] ? Number(m[2]) : a;
    if (a > b) [a, b] = [b, a];
    for (let i = a; i <= Math.min(b, 255); i++) set.add(i);
  }
  return set;
}

/** Every line the model named must be inside the accepted set, and at least one must be. */
function compsecMatches(expected: string, got: string): boolean {
  const want = parseLineSpec(expected);
  const have = parseLineSpec(got);
  if (want.size === 0 || have.size === 0) return false;
  for (const line of have) if (!want.has(line)) return false;
  return true;
}

/** Text after the last "Answer:" marker, or null when there is no such line. */
function answerPayload(visible: string): string | null {
  const marker = findLastAnswerMarker(visible);
  if (marker < 0) return null;
  let p = marker + 6;
  while (p < visible.length && /\s/.test(visible[p]!)) p++;
  if (visible[p] !== ":") return null;
  p++;
  while (p < visible.length && /[\s*]/.test(visible[p]!)) p++;
  const nl = visible.indexOf("\n", p);
  return visible.slice(p, nl >= 0 ? nl : undefined);
}

// Normalizers mirror ds4-eval so both graders agree on the same reply.
function normalizeExact(src: string): string {
  return src
    .replace(/\\(boxed|left|right)/g, "")
    .replace(/[\s$*{}\\]/g, "")
    .toLowerCase()
    .replace(/[.;]+$/, "");
}

function normalizeSequence(src: string): string {
  return src
    .replace(/<[^>]*>/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9,\-+/.]/g, "")
    .replace(/[.,]+$/, "");
}

function normalizeRational(src: string): string {
  const frac = /\\frac\s*\{([^}]*)\}\s*\{([^}]*)\}/.exec(src);
  if (frac) return `${frac[1]}/${frac[2]}`.replace(/\s/g, "");
  return src.replace(/[^\d\-+/.]/g, "").replace(/\.+$/, "");
}

type TextKind = Exclude<NonNullable<ReasoningCase["kind"]>, "code">;

const NORMALIZE: Record<TextKind, (s: string) => string> = {
  rational: normalizeRational,
  sequence: normalizeSequence,
  text: normalizeExact,
};

function findPayloadAnswer(
  generated: string,
  normalize: (s: string) => string,
): ExtractedAnswer {
  const payload = answerPayload(visibleText(generated));
  if (payload === null) return found("?", false);
  const got = normalize(payload);
  return got ? found(got, true) : found("?", false);
}

export function extractAnswerDetailed(
  tc: ReasoningCase,
  generated: string,
): ExtractedAnswer {
  if (isMultipleChoice(tc))
    return findAnswerLetter(generated, tc.choices!.length);
  if (isCompsec(tc)) return findCompsecAnswer(generated);
  if (tc.kind === "code") throw new Error("code cases are graded by gradeCode");
  if (tc.kind) return findPayloadAnswer(generated, NORMALIZE[tc.kind]);
  return findIntegerAnswer(generated);
}

export function extractAnswer(tc: ReasoningCase, generated: string): string {
  return extractAnswerDetailed(tc, generated).got;
}

export function answerMatches(tc: ReasoningCase, got: string): boolean {
  if (isMultipleChoice(tc)) return got[0] === tc.answer[0];
  if (isCompsec(tc)) return compsecMatches(tc.answer, got);
  if (got === "?") return false;
  const normalize =
    tc.kind && tc.kind !== "code" ? NORMALIZE[tc.kind] : normalizeInteger;
  return [tc.answer, ...(tc.aliases ?? [])].some((a) => got === normalize(a));
}
