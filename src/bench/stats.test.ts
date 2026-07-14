import { describe, expect, test } from "bun:test";

import {
  classifySpeculative,
  computeStat,
  median,
  tokensPerSecond,
} from "./stats";

describe("median", () => {
  test("odd count takes the middle", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  test("even count averages the two middle values", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  test("empty is 0, not NaN", () => {
    expect(median([])).toBe(0);
  });
});

describe("computeStat", () => {
  test("reports median with a min–max range — never a single figure", () => {
    // The whole point: timings vary, so a benchmark that prints one number is
    // lying about its own precision.
    const stat = computeStat([40, 42, 38, 41, 39])!;
    expect(stat.median).toBe(40);
    expect(stat.min).toBe(38);
    expect(stat.max).toBe(42);
  });

  test("no samples → null (nothing measured, so nothing claimed)", () => {
    expect(computeStat([])).toBeNull();
  });
});

describe("tokensPerSecond", () => {
  test("computes tok/s from tokens and milliseconds", () => {
    expect(tokensPerSecond(100, 2000)).toBe(50);
  });

  test("returns null when usage is missing — better silent than fabricated", () => {
    expect(tokensPerSecond(null, 2000)).toBeNull();
    expect(tokensPerSecond(undefined, 2000)).toBeNull();
  });

  test("returns null on a zero duration rather than dividing by zero", () => {
    expect(tokensPerSecond(100, 0)).toBeNull();
  });
});

describe("classifySpeculative", () => {
  test("a big predictable-vs-novel speedup reads as effective MTP/speculation", () => {
    // 71 tok/s echoing vs 39 tok/s on novel text — the draft is being accepted.
    const { ratio, verdict } = classifySpeculative(71.2, 39.4);
    expect(ratio).toBeCloseTo(1.81, 1);
    expect(verdict).toBe("effective");
  });

  test("near-parity means speculation is absent or not helping", () => {
    const { verdict } = classifySpeculative(40.5, 40.0);
    expect(verdict).toBe("none");
  });

  test("a modest edge is marginal, not effective", () => {
    const { verdict } = classifySpeculative(42, 40);
    expect(verdict).toBe("marginal");
  });

  test("a zero novel rate degrades gracefully instead of returning Infinity", () => {
    expect(classifySpeculative(40, 0)).toEqual({ ratio: 0, verdict: "none" });
  });
});
