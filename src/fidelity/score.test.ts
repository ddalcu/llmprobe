import { describe, expect, it } from "vitest";

import {
  type DeterminismObservation,
  firstContentToken,
  isConsistent,
  type ItemObservation,
  scoreFidelity,
} from "./index";

const item = (over: Partial<ItemObservation> = {}): ItemObservation => ({
  id: "x",
  correct: true,
  hard: true,
  topProb: 1,
  consistent: true,
  ...over,
});

const det = (over: Partial<DeterminismObservation> = {}): DeterminismObservation => ({
  id: "d",
  runs: 3,
  identical: true,
  firstDivergenceChar: null,
  ...over,
});

describe("scoreFidelity", () => {
  it("a perfect engine scores 100", () => {
    const score = scoreFidelity(
      [item(), item(), item()],
      [det(), det()],
      { reasoningCaveat: false },
    );
    expect(score.pct).toBe(100);
    expect(score.unmeasured).toEqual([]);
    expect(score.firstDivergence).toBeNull();
  });

  it("blends slices by weight (40/25/25/10)", () => {
    // Correctness 0.5, everything else perfect → 0.4*0.5 + 0.6*1 = 0.8.
    const score = scoreFidelity(
      [item({ correct: true }), item({ correct: false })],
      [det()],
      { reasoningCaveat: false },
    );
    expect(score.pct).toBe(80);
  });

  it("drops logprob slices out of the denominator when absent, never scores them zero", () => {
    // No logprobs: only Correctness (0.4) + Determinism (0.25) count. A perfect
    // engine on those two must still read 100, not be punished to ~65 for the
    // missing slices.
    const score = scoreFidelity(
      [item({ topProb: null, consistent: null })],
      [det()],
      { reasoningCaveat: false },
    );
    expect(score.pct).toBe(100);
    expect(score.unmeasured).toContain("Confidence");
    expect(score.unmeasured).toContain("Logprob consistency");
    const confidence = score.slices.find((s) => s.id === "confidence");
    expect(confidence?.measured).toBe(false);
  });

  it("a flattened distribution costs Confidence but leaves Correctness intact", () => {
    // Right answers, but the engine is barely confident (degraded quant).
    const score = scoreFidelity(
      [item({ topProb: 0.3 }), item({ topProb: 0.3 })],
      [det()],
      { reasoningCaveat: false },
    );
    // Confidence floor curve: min(1, 0.3/0.9) = 0.333.
    // 0.4*1 + 0.25*0.333 + 0.25*1 + 0.1*1 = 0.8333 → 83.33% at two decimals.
    expect(score.pct).toBe(83.33);
    const correctness = score.slices.find((s) => s.id === "correctness");
    expect(correctness?.score).toBe(1);
  });

  it("scores Confidence over the harder items only", () => {
    // Easy items are saturated (1.0); the hard ones are flatter (0.5).
    // Confidence must reflect the hard subset, or the trivial items drown out
    // the only slice that carries the quant-quality signal.
    const score = scoreFidelity(
      [
        item({ id: "e1", hard: false, topProb: 1 }),
        item({ id: "e2", hard: false, topProb: 1 }),
        item({ id: "h1", hard: true, topProb: 0.5 }),
        item({ id: "h2", hard: true, topProb: 0.5 }),
      ],
      [det()],
      { reasoningCaveat: false },
    );
    const confidence = score.slices.find((s) => s.id === "confidence");
    // min(1, 0.5/0.9) = 0.556, not the 1.0 that averaging in easy items gives.
    expect(confidence?.score).toBeCloseTo(0.5556, 3);
  });

  it("reports the earliest greedy divergence across prompts", () => {
    const score = scoreFidelity(
      [item()],
      [
        det({ id: "a", identical: false, firstDivergenceChar: 120 }),
        det({ id: "b", identical: false, firstDivergenceChar: 40 }),
        det({ id: "c" }),
      ],
      { reasoningCaveat: false },
    );
    expect(score.firstDivergence).toEqual({ itemId: "b", charIndex: 40, runs: 3 });
    // 2 of 3 prompts split → determinism 1/3.
    const determinism = score.slices.find((s) => s.id === "determinism");
    expect(determinism?.score).toBeCloseTo(1 / 3, 2);
  });

  it("passes the reasoning caveat through", () => {
    const score = scoreFidelity([item()], [det()], { reasoningCaveat: true });
    expect(score.reasoningCaveat).toBe(true);
  });
});

describe("firstContentToken", () => {
  it("extracts the first token and its top-k from an OpenAI-shaped logprobs", () => {
    const ft = firstContentToken({
      content: [
        {
          token: " Paris",
          logprob: -0.05,
          top_logprobs: [
            { token: " Paris", logprob: -0.05 },
            { token: " Lyon", logprob: -3.2 },
          ],
        },
      ],
    });
    expect(ft?.token).toBe(" Paris");
    expect(ft?.logprob).toBeCloseTo(-0.05, 3);
    expect(ft?.top).toHaveLength(2);
  });

  it("returns null when there are no logprobs", () => {
    expect(firstContentToken(undefined)).toBeNull();
    expect(firstContentToken({ content: [] })).toBeNull();
  });

  it("skips a leading whitespace token to reach the real answer", () => {
    const ft = firstContentToken({
      content: [
        { token: "\n", logprob: 0, top_logprobs: [{ token: "\n", logprob: 0 }] },
        {
          token: "Paris",
          logprob: -0.2,
          top_logprobs: [{ token: "Paris", logprob: -0.2 }],
        },
      ],
    });
    expect(ft?.token).toBe("Paris");
  });
});

describe("isConsistent", () => {
  const ft = (
    logprob: number,
    top: Array<{ token: string; logprob: number }>,
  ) => ({ token: "x", logprob, top });

  it("passes when the emitted token is the numeric argmax", () => {
    expect(
      isConsistent(ft(-0.05, [
        { token: "a", logprob: -0.05 },
        { token: "b", logprob: -3.1 },
      ])),
    ).toBe(true);
  });

  it("tolerates an unsorted top-k (engines legitimately return it unordered)", () => {
    // Argmax is last in the list; a sorted-order assumption would false-fail.
    expect(
      isConsistent(ft(-0.1, [
        { token: "b", logprob: -2.4 },
        { token: "a", logprob: -0.1 },
      ])),
    ).toBe(true);
  });

  it("fails when the emitted token is NOT the argmax (a real bug)", () => {
    expect(
      isConsistent(ft(-1.8, [
        { token: "a", logprob: -0.1 },
        { token: "x", logprob: -1.8 },
      ])),
    ).toBe(false);
  });

  it("fails on a positive logprob", () => {
    expect(isConsistent(ft(0.5, [{ token: "a", logprob: 0.5 }]))).toBe(false);
  });

  it("is null when there is no top-k to check against", () => {
    expect(isConsistent(ft(-0.1, []))).toBeNull();
  });
});
