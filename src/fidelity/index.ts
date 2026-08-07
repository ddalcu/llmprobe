import type { ChatRequest } from "../core/adapter";
import type { RunContext } from "../core/context";
import {
  FIDELITY_WEIGHTS,
  type FidelityScore,
  type FidelitySlice,
  type FidelitySliceId,
  type FirstDivergence,
} from "../core/outcome";
import { saysWord, stripThinking } from "../evals/grading";

/**
 * Fidelity — does this engine reproduce the model faithfully?
 *
 * One engine at a time, no reference engine, and a single 0..100 number you can
 * rank engines by. The trick that makes a reference-free score meaningful: run
 * the *same weights* on every engine, and the gap between cards is the engine
 * (its quant, its kernels, its numerics), because the model is held constant.
 *
 * Two ideas do the work:
 *
 *  - a **cloze battery** of things any real model knows cold (2 + 2, the capital
 *    of France, echo this word). Calibrated below the model's floor on purpose,
 *    the same way Capability is a floor check — so a miss, or a flat/uncertain
 *    distribution, is the *engine* degrading the model, not the model being
 *    weak. We read the first answer token's probability as the confidence.
 *
 *  - **greedy self-consistency**: repeat the identical temperature-0 request and
 *    demand byte-identical output. At temperature 0 the only source of variance
 *    is the engine — non-deterministic kernels, batch effects — so a split is a
 *    pure engine bug, and we report where it first diverged.
 *
 * Confidence and Consistency need logprobs; an engine that exposes none drops
 * those slices out of the denominator (named on the card) rather than scoring
 * zero, and is still ranked on Correctness + Determinism, which need only text.
 */

// ── the battery ───────────────────────────────────────────────────────────────

interface ClozeItem {
  id: string;
  /** Phrased so the answer is the first token — "reply with just…" holds it there. */
  prompt: string;
  /** Correct if the answer contains this as a whole word (case/punct-insensitive). */
  expect: string;
  /** Extra accepted spellings (e.g. "colour"). */
  also?: string[];
  /**
   * A deliberately *harder* item: still one unambiguous answer any decent model
   * knows, but with a real distractor (Canberra vs Sydney, Fe vs Ir) so the
   * model is genuinely less than certain. Confidence is scored over these,
   * because on the trivial items every healthy engine is ~100% confident and
   * the slice tells you nothing — the fidelity signal lives where the
   * distribution has room to be flattened by a bad quant.
   */
  hard?: boolean;
}

/**
 * Hand-written, and deliberately trivial. Every item is something a 1B model
 * answers in its sleep on a faithful engine, so a wrong answer or a flat
 * distribution points at the engine, not the model. Spread across copying,
 * arithmetic, geography, language and sequences so no single failure mode
 * (say, a broken number tokenizer) can dominate the score.
 */
export const BATTERY: ClozeItem[] = [
  // Copying — pure fidelity, independent of what the model knows.
  {
    id: "copy-word",
    prompt: "Repeat this word exactly and nothing else: LIGHTHOUSE",
    expect: "lighthouse",
  },
  {
    id: "copy-token",
    prompt: "Output exactly this and nothing else: 42",
    expect: "42",
  },
  // Arithmetic — trivial, but exercises the number path.
  {
    id: "add",
    prompt: "What is 2 + 2? Reply with just the number.",
    expect: "4",
  },
  {
    id: "sub",
    prompt: "What is 9 - 4? Reply with just the number.",
    expect: "5",
  },
  {
    id: "mul",
    prompt: "What is 3 * 3? Reply with just the number.",
    expect: "9",
  },
  {
    id: "div",
    prompt: "What is 10 / 2? Reply with just the number.",
    expect: "5",
  },
  // Geography — well-known capitals.
  {
    id: "cap-france",
    prompt: "The capital of France is which city? Reply with just the city.",
    expect: "paris",
  },
  {
    id: "cap-japan",
    prompt: "The capital of Japan is which city? Reply with just the city.",
    expect: "tokyo",
  },
  {
    id: "cap-italy",
    prompt: "The capital of Italy is which city? Reply with just the city.",
    expect: "rome",
  },
  {
    id: "cap-england",
    prompt: "The capital of England is which city? Reply with just the city.",
    expect: "london",
  },
  // Language — antonyms, plurals, closes.
  {
    id: "antonym-hot",
    prompt: "The opposite of 'hot' is which word? Reply with one word.",
    expect: "cold",
  },
  {
    id: "antonym-up",
    prompt: "The opposite of 'up' is which word? Reply with one word.",
    expect: "down",
  },
  {
    id: "plural-mouse",
    prompt: "The plural of 'mouse' is which word? Reply with one word.",
    expect: "mice",
  },
  {
    id: "rhyme-blue",
    prompt: "Roses are red, violets are which colour? Reply with one word.",
    expect: "blue",
  },
  // Sequences — the next element is forced.
  {
    id: "seq-even",
    prompt: "Continue the sequence with one number: 2, 4, 6, 8, ...",
    expect: "10",
  },
  {
    id: "seq-alpha",
    prompt: "Continue the sequence with one letter: A, B, C, ...",
    expect: "d",
  },
  // Everyday facts.
  {
    id: "day-after-mon",
    prompt: "The day after Monday is which day? Reply with one word.",
    expect: "tuesday",
  },
  {
    id: "month-after-jan",
    prompt: "The month after January is which month? Reply with one word.",
    expect: "february",
  },
  {
    id: "water",
    prompt:
      "Water is made of hydrogen and which other element? Reply with one word.",
    expect: "oxygen",
  },
  {
    id: "largest-planet",
    prompt:
      "The largest planet in our solar system is which planet? Reply with one word.",
    expect: "jupiter",
  },
  {
    id: "gold-symbol",
    prompt: "The chemical symbol for gold is what? Reply with just the symbol.",
    expect: "au",
  },
  {
    id: "romeo-author",
    prompt: "Who wrote 'Romeo and Juliet'? Reply with the surname only.",
    expect: "shakespeare",
  },
  {
    id: "sun-rises",
    prompt: "The sun rises in which direction? Reply with one word.",
    expect: "east",
  },
  {
    id: "week-days",
    prompt: "How many days are in a week? Reply with just the number.",
    expect: "7",
    also: ["seven"],
  },

  // ── Harder items — one clear answer, but a real distractor, so a healthy
  //    model sits below certainty and Confidence has room to move. Any decent
  //    model still gets these right; a degraded quant flattens the margin.
  {
    id: "cap-australia",
    prompt: "The capital of Australia is which city? Reply with just the city.",
    expect: "canberra",
    hard: true,
  },
  {
    id: "cap-canada",
    prompt: "The capital of Canada is which city? Reply with just the city.",
    expect: "ottawa",
    hard: true,
  },
  {
    id: "cap-turkey",
    prompt: "The capital of Turkey is which city? Reply with just the city.",
    expect: "ankara",
    hard: true,
  },
  {
    id: "cap-newyork-state",
    prompt:
      "The capital of New York State is which city? Reply with just the city.",
    expect: "albany",
    hard: true,
  },
  {
    id: "iron-symbol",
    prompt: "The chemical symbol for iron is what? Reply with just the symbol.",
    expect: "fe",
    hard: true,
  },
  {
    id: "sodium-symbol",
    prompt:
      "The chemical symbol for sodium is what? Reply with just the symbol.",
    expect: "na",
    hard: true,
  },
  {
    id: "mul-7-8",
    prompt: "What is 7 * 8? Reply with just the number.",
    expect: "56",
    hard: true,
  },
  {
    id: "sqrt-144",
    prompt: "What is the square root of 144? Reply with just the number.",
    expect: "12",
    hard: true,
  },
  {
    id: "author-1984",
    prompt: "Who wrote the novel '1984'? Reply with the surname only.",
    expect: "orwell",
    hard: true,
  },
  {
    id: "largest-ocean",
    prompt: "The largest ocean on Earth is which ocean? Reply with one word.",
    expect: "pacific",
    hard: true,
  },
  {
    id: "fib-next",
    prompt: "Continue the sequence with one number: 1, 1, 2, 3, 5, 8, ...",
    expect: "13",
    hard: true,
  },
  {
    id: "vp-first",
    prompt:
      "Who was the first Vice President of the United States? Surname only.",
    expect: "adams",
    hard: true,
  },
];

/**
 * Determinism prompts, kept separate from the battery: each forces a *long*
 * deterministic string, so a non-deterministic engine has room to diverge and
 * "diverged at char N" actually means something. One-word answers rarely split
 * even on a flaky engine, so they make poor divergence probes.
 */
export const DETERMINISM_PROMPTS: Array<{ id: string; prompt: string }> = [
  {
    id: "det-echo-sentence",
    prompt:
      "Repeat this sentence exactly, word for word: The quick brown fox jumps over the lazy dog near the river bank at dawn.",
  },
  {
    id: "det-count",
    prompt:
      "Count from 1 to 20, separated by commas. Reply with only the numbers.",
  },
  {
    id: "det-primes",
    prompt:
      "List the first ten prime numbers separated by commas. Reply with only the numbers.",
  },
];

const TOP_K = 5;
const ANSWER_TOKENS = 16;
const DETERMINISM_TOKENS = 96;
/** Repeats per determinism prompt. Three is enough to catch a flaky kernel. */
const DETERMINISM_RUNS = 3;

// ── observations (what the probe collects; the scorer is pure over these) ──────

export interface ItemObservation {
  id: string;
  correct: boolean;
  /** A harder item — Confidence is scored over these; see ClozeItem.hard. */
  hard: boolean;
  /** exp(first-answer-token logprob) = top-1 probability, or null if no logprobs. */
  topProb: number | null;
  /** Top-1 probability minus the runner-up's, or null without a top-k. */
  margin: number | null;
  /** Passed the logprob self-consistency checks, or null if no logprobs. */
  consistent: boolean | null;
}

export interface DeterminismObservation {
  id: string;
  runs: number;
  identical: boolean;
  /** Char index where the repeated runs first disagreed, or null if identical. */
  firstDivergenceChar: number | null;
  /**
   * Which repeat first disagreed with run 1 (2-based, since run 1 is the
   * reference). Run 2 alone is the cold-vs-warm signature — the first request
   * prefills cold and every later one hits the prefix cache — so naming the run
   * points at prompt caching rather than at sampling.
   */
  divergedRun: number | null;
}

// ── grading ───────────────────────────────────────────────────────────────────

function isCorrect(item: ClozeItem, text: string): boolean {
  const answer = stripThinking(text);
  if (saysWord(answer, item.expect)) return true;
  return (item.also ?? []).some((alt) => saysWord(answer, alt));
}

interface FirstToken {
  token: string;
  logprob: number;
  top: Array<{ token: string; logprob: number }>;
}

/**
 * Pull the *decisive* answer token out of an OpenAI-shaped `logprobs`.
 *
 * Not always `content[0]`: several chat models emit a leading newline or space
 * token before the answer, and scoring that whitespace would read as fake-high
 * confidence on a token nobody cares about. So skip leading whitespace-only
 * tokens and take the first one with real glyphs. Tolerant of a missing or
 * differently-shaped `top_logprobs`, which just leaves the top-k empty.
 */
export function firstContentToken(logprobs: unknown): FirstToken | null {
  const content = (logprobs as { content?: unknown } | null)?.content;
  if (!Array.isArray(content) || content.length === 0) return null;

  const entries = content as Array<{
    token?: unknown;
    logprob?: unknown;
    top_logprobs?: unknown;
  }>;
  const usable = entries.filter((e) => typeof e?.logprob === "number");
  if (usable.length === 0) return null;

  const decisive =
    usable.find((e) => typeof e.token === "string" && e.token.trim() !== "") ??
    usable[0]!;

  const top = Array.isArray(decisive.top_logprobs)
    ? (decisive.top_logprobs as Array<Record<string, unknown>>)
        .filter((t) => typeof t?.logprob === "number")
        .map((t) => ({
          token: String(t.token ?? ""),
          logprob: Number(t.logprob),
        }))
    : [];

  return {
    token: typeof decisive.token === "string" ? decisive.token : "",
    logprob: Number(decisive.logprob),
    top,
  };
}

/**
 * Does the returned distribution agree with itself? At temperature 0 the token
 * the engine actually emitted must be the argmax of its own top-k, and no
 * logprob may be positive. An engine that emits token X while its own numbers
 * say Y was likelier is confessing a bug — caught with no reference needed.
 *
 * Deliberately robust to wire quirks that are *not* bugs: we compare by numeric
 * logprob (the emitted token's logprob must be the max), never by assuming the
 * top-k arrived sorted or that the token strings render identically. Engines
 * legitimately return `top_logprobs` unsorted, and demanding order would false-
 * positive every token on an otherwise-correct distribution.
 */
export function isConsistent(ft: FirstToken): boolean | null {
  if (ft.top.length === 0) return null;
  const EPS = 1e-3;
  if (ft.top.some((t) => t.logprob > EPS)) return false;
  const maxTop = Math.max(...ft.top.map((t) => t.logprob));
  return ft.logprob >= maxTop - EPS;
}

/**
 * How far clear the top token was of the next one, in probability.
 *
 * The graded Confidence slice saturates on purpose, so a 0.94 and a 0.99 both
 * read as a clean 100 — correct for a floor check, and useless to anyone trying
 * to separate two healthy engines. This is that separation, measured from
 * logprobs the run already paid for.
 *
 * Sorted rather than assumed: engines legitimately return `top_logprobs`
 * unsorted, and taking `top[1]` on faith would report the gap to whichever
 * alternative happened to land second on the wire.
 */
export function topMargin(ft: FirstToken): number | null {
  if (ft.top.length < 2) return null;
  const [first, second] = [...ft.top].sort((a, b) => b.logprob - a.logprob);
  return clamp01(Math.exp(first!.logprob) - Math.exp(second!.logprob));
}

/** Where — and in which repeat — the text first differs from run 1's. */
function firstDivergence(
  runs: string[],
): { charIndex: number; run: number } | null {
  const base = runs[0] ?? "";
  for (const [offset, other] of runs.slice(1).entries()) {
    const run = offset + 2;
    const n = Math.min(base.length, other.length);
    for (let i = 0; i < n; i += 1) {
      if (base[i] !== other[i]) return { charIndex: i, run };
    }
    if (base.length !== other.length) return { charIndex: n, run };
  }
  return null;
}

// ── the pure scorer ───────────────────────────────────────────────────────────

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
/** Percent to two decimals — fine enough to separate two faithful engines. */
const round2 = (n: number): number => Math.round(n * 100) / 100;
/** Keep a fraction at four decimals so a two-decimal percent renders exactly. */
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/**
 * Confidence floor. A faithful engine puts near-all mass on the one right token
 * for a trivial cloze, so mean top-1 probability at or above this reads as a
 * full score; below it, a flattened distribution (degraded quant, wrong
 * numerics) drops the slice. A floor check, like the rest of the suite, rather
 * than a linear "how confident" that would deny a healthy engine a clean 100.
 */
const CONFIDENCE_TARGET = 0.9;

/**
 * Fold raw observations into the card. Pure and total, so the whole scoring
 * story is unit-testable with no network — feed it observations, read the
 * number. The headline blends only the slices that were actually measured.
 */
export function scoreFidelity(
  items: ItemObservation[],
  determinism: DeterminismObservation[],
  opts: { reasoningCaveat: boolean },
): FidelityScore {
  const correct = items.filter((i) => i.correct).length;
  const withConsistency = items.filter((i) => i.consistent !== null);
  const det = determinism.filter((d) => d.runs > 1);

  // Confidence lives on the harder items: the trivial ones are ~100% confident
  // on any healthy engine and tell you nothing. Fall back to all items only if
  // the battery happened to carry no hard ones.
  const hardWithProb = items.filter((i) => i.hard && i.topProb !== null);
  const confItems =
    hardWithProb.length > 0
      ? hardWithProb
      : items.filter((i) => i.topProb !== null);
  const meanProb =
    confItems.length > 0
      ? confItems.reduce((a, i) => a + (i.topProb ?? 0), 0) / confItems.length
      : 0;
  const confMargins = confItems
    .map((i) => i.margin)
    .filter((m): m is number => m !== null);
  const meanMargin =
    confMargins.length > 0
      ? confMargins.reduce((a, m) => a + m, 0) / confMargins.length
      : null;
  const consistentPass = withConsistency.filter((i) => i.consistent).length;
  const identical = det.filter((d) => d.identical).length;

  const raw: Array<{
    id: FidelitySliceId;
    label: string;
    score: number;
    detail: string;
    measured: boolean;
    reason?: string;
  }> = [
    {
      id: "correctness",
      label: "Correctness",
      score: items.length > 0 ? correct / items.length : 0,
      detail: `${correct}/${items.length} items answered correctly`,
      measured: items.length > 0,
      reason: "no battery items ran",
    },
    {
      id: "confidence",
      label: "Confidence",
      score: clamp01(meanProb / CONFIDENCE_TARGET),
      detail:
        confItems.length > 0
          ? [
              `mean top-1 prob ${meanProb.toFixed(3)}`,
              // The gap to the runner-up is what still separates two engines
              // once the slice has saturated at 100.
              meanMargin === null ? null : `margin ${meanMargin.toFixed(3)}`,
              `${confItems.length} ${hardWithProb.length > 0 ? "harder " : ""}items`,
            ]
              .filter(Boolean)
              .join(" · ")
          : "engine returned no logprobs",
      measured: confItems.length > 0,
      reason: "engine returned no logprobs",
    },
    {
      id: "determinism",
      label: "Determinism",
      score: det.length > 0 ? identical / det.length : 0,
      detail:
        det.length > 0
          ? `${identical}/${det.length} greedy prompts reproduced byte-for-byte`
          : "not measured",
      measured: det.length > 0,
      reason: "no determinism prompts ran",
    },
    {
      id: "consistency",
      label: "Logprob consistency",
      score:
        withConsistency.length > 0
          ? consistentPass / withConsistency.length
          : 0,
      detail:
        withConsistency.length > 0
          ? `${consistentPass}/${withConsistency.length} items: emitted token = argmax, valid distribution`
          : "engine returned no top-k logprobs",
      measured: withConsistency.length > 0,
      reason: "engine returned no top-k logprobs",
    },
  ];

  const slices: FidelitySlice[] = raw.map((s) => ({
    id: s.id,
    label: s.label,
    score: round4(s.score),
    weight: FIDELITY_WEIGHTS[s.id],
    detail: s.detail,
    measured: s.measured,
    unmeasuredReason: s.measured ? undefined : s.reason,
  }));

  const measured = slices.filter((s) => s.measured);
  const totalWeight = measured.reduce((a, s) => a + s.weight, 0);
  const pct =
    totalWeight > 0
      ? round2(
          (measured.reduce((a, s) => a + s.weight * s.score, 0) / totalWeight) *
            100,
        )
      : 0;

  // Earliest greedy split, by char index — the single most useful fact.
  let firstDivergence: FirstDivergence | null = null;
  for (const d of det) {
    if (d.firstDivergenceChar === null) continue;
    if (
      firstDivergence === null ||
      d.firstDivergenceChar < firstDivergence.charIndex
    ) {
      firstDivergence = {
        itemId: d.id,
        charIndex: d.firstDivergenceChar,
        run: d.divergedRun ?? 2,
        runs: d.runs,
      };
    }
  }

  return {
    pct,
    slices,
    items: items.length,
    firstDivergence,
    unmeasured: slices.filter((s) => !s.measured).map((s) => s.label),
    reasoningCaveat: opts.reasoningCaveat,
    measurements: {
      meanTopProb: confItems.length > 0 ? round4(meanProb) : null,
      meanMargin: meanMargin === null ? null : round4(meanMargin),
      items: items.map((i) => ({
        id: i.id,
        hard: i.hard,
        correct: i.correct,
        topProb: i.topProb === null ? null : round4(i.topProb),
        margin: i.margin === null ? null : round4(i.margin),
      })),
    },
  };
}

// ── the network probe ─────────────────────────────────────────────────────────

/**
 * Run the battery against a live engine and score it. Returns null when there
 * is no chat-shaped surface to probe. The chat surface is preferred (its
 * logprobs shape is the one we parse); if only another surface exists we still
 * score Correctness + Determinism from its text and mark the logprob slices
 * unmeasured.
 */
export async function runFidelity(
  ctx: RunContext,
  reasoningModel: boolean,
  onProgress?: (label: string) => void,
): Promise<FidelityScore | null> {
  const surface = ctx.present.has("chat") ? "chat" : ctx.evalSurface;
  if (!surface) return null;

  const askLogprobs = ctx.adapters.get(surface)?.capabilities.logprobs === true;

  const items: ItemObservation[] = [];
  for (const [i, item] of BATTERY.entries()) {
    onProgress?.(`cloze battery ${i + 1}/${BATTERY.length}`);
    const request: ChatRequest = {
      turns: [{ type: "user", text: item.prompt }],
      temperature: 0,
      maxTokens: ANSWER_TOKENS,
    };
    if (askLogprobs) {
      request.logprobs = true;
      request.extra = { top_logprobs: TOP_K };
    }

    try {
      const { reply } = await ctx.send(surface, request);
      const ft = askLogprobs ? firstContentToken(reply.logprobs) : null;
      items.push({
        id: item.id,
        correct: isCorrect(item, reply.text),
        hard: item.hard === true,
        topProb: ft ? clamp01(Math.exp(ft.logprob)) : null,
        margin: ft ? topMargin(ft) : null,
        consistent: ft ? isConsistent(ft) : null,
      });
    } catch (err) {
      // Budget exhaustion aborts the whole run (bin/ catches it); anything else
      // is the engine failing a trivial item, which is a fidelity fault.
      if (err instanceof Error && err.name === "BudgetExceededError") throw err;
      items.push({
        id: item.id,
        correct: false,
        hard: item.hard === true,
        topProb: null,
        margin: null,
        consistent: null,
      });
    }
  }

  const determinism: DeterminismObservation[] = [];
  for (const prompt of DETERMINISM_PROMPTS) {
    const runs: string[] = [];
    for (let i = 0; i < DETERMINISM_RUNS; i += 1) {
      onProgress?.(`greedy: ${prompt.id} ${i + 1}/${DETERMINISM_RUNS}`);
      const { reply } = await ctx.send(surface, {
        turns: [{ type: "user", text: prompt.prompt }],
        temperature: 0,
        maxTokens: DETERMINISM_TOKENS,
      });
      runs.push(stripThinking(reply.text));
    }
    const divergence = firstDivergence(runs);
    determinism.push({
      id: prompt.id,
      runs: DETERMINISM_RUNS,
      identical: divergence === null,
      firstDivergenceChar: divergence?.charIndex ?? null,
      divergedRun: divergence?.run ?? null,
    });
  }

  return scoreFidelity(items, determinism, { reasoningCaveat: reasoningModel });
}
