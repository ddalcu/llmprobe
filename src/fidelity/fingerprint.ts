import type { ChatRequest } from "../core/adapter";
import type { RunContext } from "../core/context";
import type { Fingerprint, FingerprintToken } from "../core/outcome";

/**
 * Logprob fingerprint — the raw material for "is this engine still computing
 * the same function as that older run?"
 *
 * Black-box KL divergence cannot teacher-force: the chat API scores only what
 * the engine itself generates. So the fingerprint records the greedy path on a
 * few fixed prompts, and the comparison walks two fingerprints together for as
 * long as both engines emitted the same tokens. Up to that point the contexts
 * are identical, so the two distributions are directly comparable; at the first
 * disagreement the contexts differ and the walk stops (that position is itself
 * the headline: "diverged at token 23").
 */

/** 20 is the OpenAI ceiling for top_logprobs. */
const FINGERPRINT_TOP_K = 20;
const FINGERPRINT_TOKENS = 64;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** OpenAI-shaped `logprobs.content` → fingerprint tokens; tolerant of gaps. */
export function fingerprintTokens(logprobs: unknown): FingerprintToken[] {
  const content = (logprobs as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return [];
  const tokens: FingerprintToken[] = [];
  for (const entry of content as Array<Record<string, unknown>>) {
    if (typeof entry?.token !== "string" || typeof entry.logprob !== "number")
      continue;
    const top = Array.isArray(entry.top_logprobs)
      ? (entry.top_logprobs as Array<Record<string, unknown>>)
          .filter(
            (x) =>
              typeof x?.token === "string" && typeof x.logprob === "number",
          )
          .map((x): [string, number] => [
            x.token as string,
            round4(x.logprob as number),
          ])
      : [];
    tokens.push({ t: entry.token, lp: round4(entry.logprob), top });
  }
  return tokens;
}

export async function collectFingerprint(
  ctx: RunContext,
  surface: string,
  promptSet: Array<{ id: string; prompt: string }>,
  onProgress?: (label: string) => void,
): Promise<Fingerprint | null> {
  const prompts: Fingerprint["prompts"] = [];
  for (const [i, prompt] of promptSet.entries()) {
    onProgress?.(`fingerprint ${i + 1}/${promptSet.length}`);
    const request: ChatRequest = {
      turns: [{ type: "user", text: prompt.prompt }],
      temperature: 0,
      maxTokens: FINGERPRINT_TOKENS,
      logprobs: true,
      extra: { top_logprobs: FINGERPRINT_TOP_K },
    };
    try {
      const { reply } = await ctx.send(surface, request);
      const tokens = fingerprintTokens(reply.logprobs);
      if (tokens.length > 0) prompts.push({ id: prompt.id, tokens });
    } catch (err) {
      if (err instanceof Error && err.name === "BudgetExceededError") throw err;
    }
  }
  return prompts.length > 0 ? { topK: FINGERPRINT_TOP_K, prompts } : null;
}

// ── comparison (pure) ────────────────────────────────────────────────────────

export interface PromptDelta {
  id: string;
  /** Positions both engines were scored at (shared prefix + the split token). */
  compared: number;
  /** Positions where both engines' top-1 token agreed. */
  agreed: number;
  meanKld: number;
  /** Token index where the greedy paths split, or null if they never did. */
  divergedAt: number | null;
}

export interface FingerprintDelta {
  prompts: PromptDelta[];
  compared: number;
  /** 0..100, share of compared positions with the same top-1 token. */
  top1Pct: number;
  /** Mean KL(reference ‖ candidate) in nats over compared positions. */
  meanKld: number;
  maxKld: number;
  /** Prompts whose greedy paths never split. */
  identicalPaths: number;
}

const top1 = (t: FingerprintToken): string =>
  t.top.reduce<[string, number]>(
    (best, cur) => (cur[1] > best[1] ? cur : best),
    [t.t, t.lp],
  )[0];

/**
 * KL(ref ‖ cand) in nats over the union of the two top-k sets. A token missing
 * from one side's top-k is given that side's smallest listed probability (an
 * upper bound on anything the engine left out), and both sides are renormalised
 * over the union — a truncated estimate, stable and never infinite.
 */
export function truncatedKld(
  ref: FingerprintToken,
  cand: FingerprintToken,
): number {
  const side = (t: FingerprintToken): Map<string, number> => {
    const m = new Map<string, number>();
    for (const [tok, lp] of t.top) m.set(tok, Math.exp(lp));
    if (!m.has(t.t)) m.set(t.t, Math.exp(t.lp));
    return m;
  };
  const a = side(ref);
  const b = side(cand);
  const floorA = Math.min(...a.values());
  const floorB = Math.min(...b.values());
  const union = [...new Set([...a.keys(), ...b.keys()])];
  const pa = union.map((k) => a.get(k) ?? floorA);
  const pb = union.map((k) => b.get(k) ?? floorB);
  const za = pa.reduce((x, y) => x + y, 0);
  const zb = pb.reduce((x, y) => x + y, 0);
  let kld = 0;
  for (let i = 0; i < pa.length; i += 1) {
    const p = pa[i]! / za;
    const q = pb[i]! / zb;
    if (p > 0) kld += p * Math.log(p / q);
  }
  return Math.max(0, kld);
}

/** Null when the two runs share no prompt with logprobs. */
export function compareFingerprints(
  ref: Fingerprint,
  cand: Fingerprint,
): FingerprintDelta | null {
  const prompts: PromptDelta[] = [];
  let compared = 0;
  let agreed = 0;
  let kldSum = 0;
  let maxKld = 0;

  for (const r of ref.prompts) {
    const c = cand.prompts.find((p) => p.id === r.id);
    if (!c) continue;
    const n = Math.min(r.tokens.length, c.tokens.length);
    let pAgreed = 0;
    let pKld = 0;
    let pCompared = 0;
    let divergedAt: number | null = null;
    for (let i = 0; i < n; i += 1) {
      const rt = r.tokens[i]!;
      const ct = c.tokens[i]!;
      const kld = truncatedKld(rt, ct);
      pCompared += 1;
      pKld += kld;
      maxKld = Math.max(maxKld, kld);
      if (top1(rt) === top1(ct)) pAgreed += 1;
      // Greedy emitted tokens differ: every later context differs too.
      if (rt.t !== ct.t) {
        divergedAt = i;
        break;
      }
    }
    if (pCompared === 0) continue;
    prompts.push({
      id: r.id,
      compared: pCompared,
      agreed: pAgreed,
      meanKld: pKld / pCompared,
      divergedAt,
    });
    compared += pCompared;
    agreed += pAgreed;
    kldSum += pKld;
  }

  if (compared === 0) return null;
  return {
    prompts,
    compared,
    top1Pct: (agreed / compared) * 100,
    meanKld: kldSum / compared,
    maxKld,
    identicalPaths: prompts.filter((p) => p.divergedAt === null).length,
  };
}
