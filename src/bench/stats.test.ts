import { describe, expect, test } from "vitest";

import {
  analyzeStepProfile,
  classifyBatching,
  classifyLoadDrift,
  classifyPrefixCache,
  classifySpeculative,
  computeStat,
  decodeRate,
  median,
  tokensPerSecond,
} from "./stats";

/** Frame arrival times for `steps` server steps of `perStep` frames each. */
function arrivals(steps: number, perStep: number, stepMs = 25): number[] {
  const times: number[] = [];
  for (let s = 0; s < steps; s += 1) {
    for (let i = 0; i < perStep; i += 1) times.push(s * stepMs);
  }
  return times;
}

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

describe("decodeRate", () => {
  test("measures first token to last token, not first token to end of stream", () => {
    // 21 frames, 20 ms apart: 20 intervals over 400 ms = 50 tok/s. The old
    // window ran to end-of-stream, so the finish_reason chunk, the usage frame,
    // `[DONE]` and the body close all landed in the denominator.
    const arrive = Array.from({ length: 21 }, (_, i) => i * 20);
    expect(decodeRate(arrive, 21)).toBeCloseTo(50, 5);
  });

  test("trailing frames after the last token cannot deflate the rate", () => {
    // Same 21 tokens, but the stream stays open another 400 ms for the usage
    // frame and teardown. Timing to stream-end would report 25 tok/s — half.
    const arrive = Array.from({ length: 21 }, (_, i) => i * 20);
    const asMeasured = decodeRate(arrive, 21);
    const withTeardown = ((21 - 1) / (400 + 400)) * 1000;
    expect(asMeasured).toBeCloseTo(50, 5);
    expect(withTeardown).toBeCloseTo(25, 5);
  });

  test("counts only visible tokens, so a thinking phase cannot inflate it", () => {
    // 400 ms of visible output. Passing completion_tokens (200, including a
    // 180-token scratchpad) against visible-only time reads ~5x too fast.
    const arrive = Array.from({ length: 21 }, (_, i) => i * 20);
    expect(decodeRate(arrive, 21)).toBeCloseTo(50, 5);
    expect(decodeRate(arrive, 200)!).toBeGreaterThan(400);
  });

  test("a single frame spans no interval, so there is nothing to report", () => {
    // The whole body in one read. Timing to stream-end would have measured
    // teardown and called it decode.
    expect(decodeRate([100], 50)).toBeNull();
    expect(decodeRate([100, 100], 50)).toBeNull();
  });

  test("degenerate token counts yield null rather than a number", () => {
    expect(decodeRate([0, 20, 40], null)).toBeNull();
    expect(decodeRate([0, 20, 40], 1)).toBeNull();
    expect(decodeRate([], 50)).toBeNull();
  });
});

describe("classifyPrefixCache", () => {
  test("a repeat that skips the prefill reads as an active cache", () => {
    const { speedup, verdict } = classifyPrefixCache(3410, 190);
    expect(speedup).toBeCloseTo(17.9, 1);
    expect(verdict).toBe("active");
  });

  test("same latency twice means nothing was reused", () => {
    expect(classifyPrefixCache(3410, 3380).verdict).toBe("none");
  });

  test("reporting cached tokens while re-prefilling anyway is still 'none'", () => {
    // The failure the existing cached_tokens assertion cannot see: usage says
    // the cache hit, the clock says it re-ingested the whole prompt.
    expect(classifyPrefixCache(3400, 3300).verdict).toBe("none");
  });

  test("an unmeasurable pair degrades to unknown, never to a verdict", () => {
    expect(classifyPrefixCache(null, 190).verdict).toBe("unknown");
    expect(classifyPrefixCache(3410, null).verdict).toBe("unknown");
    expect(classifyPrefixCache(3410, 0).verdict).toBe("unknown");
  });

  test("a cold prefill too fast to matter is unknown, not a 3× cache hit", () => {
    // 3 ms against 1 ms is arithmetically a 3× speedup and evidence of
    // nothing — there was no prefill for a cache to skip.
    expect(classifyPrefixCache(3, 1).verdict).toBe("unknown");
    expect(classifyPrefixCache(3, 1).speedup).toBeNull();
  });
});

describe("classifyBatching", () => {
  test("near-linear aggregate throughput is real continuous batching", () => {
    const { efficiency, verdict } = classifyBatching(45.9, 168.0, 4);
    expect(efficiency).toBeCloseTo(0.92, 2);
    expect(verdict).toBe("batched");
  });

  test("flat aggregate under load is a queue in front of one slot", () => {
    // llama.cpp with a single slot: four streams finish in four times the
    // wall clock, so aggregate never rises above one stream's rate.
    const { efficiency, verdict } = classifyBatching(45.9, 46.2, 4);
    expect(efficiency).toBeCloseTo(0.25, 2);
    expect(verdict).toBe("serialized");
  });

  test("a partial win is named as such rather than rounded to either extreme", () => {
    expect(classifyBatching(45.9, 100, 4).verdict).toBe("partial");
  });

  test("no baseline means no verdict", () => {
    expect(classifyBatching(null, 168, 4).verdict).toBe("unknown");
    expect(classifyBatching(45.9, null, 4).verdict).toBe("unknown");
    expect(classifyBatching(0, 168, 4).verdict).toBe("unknown");
  });
});

describe("classifyLoadDrift", () => {
  test("a small wobble over a long run is steady", () => {
    const { driftPct, verdict } = classifyLoadDrift(48.3, 47.1);
    expect(driftPct).toBeCloseTo(-2.5, 1);
    expect(verdict).toBe("steady");
  });

  test("the machine slowing under sustained load is degraded", () => {
    // Thermal throttling, or something else landing on the box mid-run. Either
    // way every number above it was taken while the ground was moving.
    const { driftPct, verdict } = classifyLoadDrift(48.3, 41.2);
    expect(driftPct).toBeCloseTo(-14.7, 1);
    expect(verdict).toBe("degraded");
  });

  test("finishing faster than it started is flagged too, not silently blessed", () => {
    // Means the warmup did not warm it, so the headline figures are
    // pessimistic — still a run whose numbers moved while being taken.
    expect(classifyLoadDrift(40, 48).verdict).toBe("improved");
  });

  test("a missing end or start measurement is unknown", () => {
    expect(classifyLoadDrift(null, 47.1).verdict).toBe("unknown");
    expect(classifyLoadDrift(48.3, null).verdict).toBe("unknown");
    expect(classifyLoadDrift(0, 47.1).verdict).toBe("unknown");
  });
});

describe("analyzeStepProfile", () => {
  test("evenly spaced frames, one token each — one token per step, no speculation", () => {
    const profile = analyzeStepProfile(arrivals(24, 1), 24);
    expect(profile.tokensPerStep).toBeCloseTo(1, 2);
    expect(profile.steps).toBe(24);
    expect(profile.note).toBeNull();
  });

  test("frames arriving in pairs — two tokens per step, the MTP signature", () => {
    // A draft of 1 accepted every step: both tokens land in the same server
    // step, so they arrive together and the gap between pairs is a full step.
    const profile = analyzeStepProfile(arrivals(12, 2), 24);
    expect(profile.tokensPerStep).toBeCloseTo(2, 2);
    expect(profile.steps).toBe(12);
    expect(profile.note).toBeNull();
  });

  test("counts tokens per step from usage, so packing k tokens into one frame is seen too", () => {
    // Some engines emit all of a step's accepted tokens in a single SSE frame.
    // Frame gaps then look perfectly even; only usage reveals the 3×.
    const profile = analyzeStepProfile(arrivals(20, 1), 60);
    expect(profile.tokensPerStep).toBeCloseTo(3, 2);
    expect(profile.note).toBeNull();
  });

  test("a body that arrived in one read is indeterminate, not one token per step", () => {
    // Buffering proxies and non-streaming mocks deliver every frame at once.
    // There are no steps to see, so claiming "no speculation" would be a lie.
    const profile = analyzeStepProfile(new Array(32).fill(0), 32);
    expect(profile.tokensPerStep).toBeNull();
    expect(profile.note).toMatch(/one read|not individually timed/i);
  });

  test("two big writes are reported as buffered, never as spectacular speculation", () => {
    // The dangerous false positive: 32 tokens in 2 writes computes to 16
    // tokens/step, which no real draft path achieves.
    const profile = analyzeStepProfile([...arrivals(2, 16, 50)], 32);
    expect(profile.tokensPerStep).toBeNull();
    expect(profile.note).toMatch(/buffered/i);
  });

  test("too few frames to profile — says so rather than guessing", () => {
    expect(analyzeStepProfile(arrivals(4, 1), 4).note).toMatch(/too few/i);
  });

  test("no usage means no tokens-per-step, since frames are not tokens", () => {
    expect(analyzeStepProfile(arrivals(24, 1), null).tokensPerStep).toBeNull();
  });

  test("jittery real-world gaps still read as one token per step", () => {
    const times = [0];
    const jitter = [
      24, 27, 22, 26, 25, 23, 28, 24, 25, 26, 22, 27, 25, 24, 26, 23, 25, 27,
      24, 26, 25, 23, 24,
    ];
    for (const g of jitter) times.push(times.at(-1)! + g);
    const profile = analyzeStepProfile(times, times.length);
    expect(profile.tokensPerStep).toBeCloseTo(1, 1);
    expect(profile.note).toBeNull();
  });
});
