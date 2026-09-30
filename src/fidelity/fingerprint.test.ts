import { expect, test } from "vitest";

import type { Fingerprint, FingerprintToken } from "../core/outcome";
import {
  compareFingerprints,
  fingerprintTokens,
  truncatedKld,
} from "./fingerprint";

const tok = (t: string, top: Array<[string, number]>): FingerprintToken => ({
  t,
  lp: top.find(([k]) => k === t)?.[1] ?? -9,
  top,
});

const print = (tokens: FingerprintToken[]): Fingerprint => ({
  topK: 5,
  prompts: [{ id: "p", tokens }],
});

const A: FingerprintToken = tok("a", [
  ["a", Math.log(0.9)],
  ["b", Math.log(0.1)],
]);

test("an identical run has zero KLD and full top-1 agreement", () => {
  const delta = compareFingerprints(print([A, A, A]), print([A, A, A]))!;
  expect(delta.meanKld).toBeCloseTo(0, 9);
  expect(delta.top1Pct).toBe(100);
  expect(delta.identicalPaths).toBe(1);
});

test("a flattened distribution shows up as KLD with the path intact", () => {
  const flat = tok("a", [
    ["a", Math.log(0.6)],
    ["b", Math.log(0.4)],
  ]);
  const delta = compareFingerprints(print([A, A]), print([flat, flat]))!;
  expect(delta.meanKld).toBeGreaterThan(0.1);
  expect(delta.top1Pct).toBe(100);
  expect(delta.identicalPaths).toBe(1);
});

test("the walk stops at the first differing token and reports where", () => {
  const other = tok("b", [
    ["b", Math.log(0.7)],
    ["a", Math.log(0.3)],
  ]);
  const delta = compareFingerprints(
    print([A, A, A, A]),
    print([A, other, A, A]),
  )!;
  expect(delta.prompts[0]!.divergedAt).toBe(1);
  expect(delta.compared).toBe(2);
  expect(delta.top1Pct).toBe(50);
  expect(delta.identicalPaths).toBe(0);
});

test("a token missing from one top-k stays finite", () => {
  const cand = tok("a", [["a", Math.log(0.99)]]);
  const kld = truncatedKld(A, cand);
  expect(Number.isFinite(kld)).toBe(true);
  expect(kld).toBeGreaterThanOrEqual(0);
});

test("prompts absent from either run are skipped, and nothing shared is null", () => {
  const other: Fingerprint = {
    topK: 5,
    prompts: [{ id: "q", tokens: [A] }],
  };
  expect(compareFingerprints(print([A]), other)).toBeNull();
});

test("fingerprintTokens tolerates missing top_logprobs and junk entries", () => {
  const tokens = fingerprintTokens({
    content: [
      { token: "x", logprob: -0.123456 },
      { nope: true },
      { token: "y", logprob: -1, top_logprobs: [{ token: "y", logprob: -1 }] },
    ],
  });
  expect(tokens).toEqual([
    { t: "x", lp: -0.1235, top: [] },
    { t: "y", lp: -1, top: [["y", -1]] },
  ]);
  expect(fingerprintTokens(undefined)).toEqual([]);
});
