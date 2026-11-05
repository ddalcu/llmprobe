import { afterEach, describe, expect, test } from "vitest";
import { EngineClient, type RunConfig } from "../core/client";
import { createContext } from "../core/context";
import { ADAPTERS } from "../conformance/index";
import {
  startMockEngine,
  type MockEngine,
  type MockDefects,
} from "../fixtures/mock-engine";
import { runBenchmark } from "./index";
import { longDecodePrefix } from "./long-decode";
import { decodeWindows } from "./stats";
import { longDecodeLines } from "../core/report/long-decode";
import { benchSection } from "../core/report/card/bench";

let engine: MockEngine | undefined;
afterEach(() => engine?.stop());

async function benchmark(
  defects: MockDefects = {},
  overrides: Partial<RunConfig> = {},
) {
  engine = await startMockEngine({
    promptCache: true,
    longDecode: {},
    ...defects,
  });
  const config: RunConfig = {
    baseUrl: `${engine.url}/v1`,
    apiKey: "",
    model: "mock-model-12b",
    timeoutMs: 1000,
    depth: "default",
    reasoningHeadroom: 0,
    benchRuns: 1,
    longDecode: {
      contextTokens: 512,
      maxTokens: 256,
      windowTokens: 32,
      prefixSeed: "test-prefix",
    },
    ...overrides,
  };
  const ctx = createContext({
    config,
    client: new EngineClient(config),
    adapters: new Map(ADAPTERS.map((adapter) => [adapter.id, adapter])),
    present: new Set(["models", "chat"]),
    evalSurface: "chat",
  });
  return (await runBenchmark(ctx, false))!;
}

describe("long decode windows", () => {
  test("captures late slowdown without treating chunks as single tokens", () => {
    const profile = decodeWindows(
      Array.from({ length: 10 }, (_, i) => ({
        chars: 40,
        timeMs: i <= 4 ? i * 100 : 400 + (i - 4) * 200,
      })),
      100,
      20,
    );
    expect(profile.summary).toMatchObject({
      completeWindows: 4,
      firstTokPerSec: 100,
      lastTokPerSec: 50,
      minTokPerSec: 50,
      maxTokPerSec: 100,
      changePct: -50,
    });
    expect(profile.windows.at(-1)?.complete).toBe(false);
    expect(profile.windows[0]?.startTokens).toBe(10);
  });

  test("groups simultaneous arrivals and retains real chunk boundaries", () => {
    const profile = decodeWindows(
      [
        { chars: 4, timeMs: 0 },
        { chars: 4, timeMs: 0 },
        { chars: 16, timeMs: 100 },
        { chars: 16, timeMs: 100 },
        { chars: 4, timeMs: 200 },
      ],
      110,
      20,
    );
    expect(profile.windows[0]).toMatchObject({
      startTokens: 20,
      endTokens: 100,
      tokPerSec: 800,
    });
    expect(profile.summary?.changePct).toBeNull();
    expect(profile.windows[1]?.complete).toBe(false);
    expect(profile.decodeTokPerSec).toBe(450);
  });

  test("does not fabricate window statistics from a blob or absent usage", () => {
    expect(
      decodeWindows([{ chars: 400, timeMs: 100 }], 100, 20).summary,
    ).toBeNull();
    expect(
      decodeWindows(
        [
          { chars: 40, timeMs: 100 },
          { chars: 40, timeMs: 100 },
        ],
        20,
        5,
      ).windows,
    ).toEqual([]);
    expect(
      decodeWindows(
        [
          { chars: 40, timeMs: 100 },
          { chars: 40, timeMs: 200 },
        ],
        null,
        5,
      ).summary,
    ).toBeNull();
  });

  test("distinguishes mean window rate from time-weighted whole-generation rate", () => {
    const profile = decodeWindows(
      [
        { chars: 4, timeMs: 0 },
        { chars: 40, timeMs: 1000 },
        { chars: 40, timeMs: 3000 },
      ],
      21,
      10,
    );
    expect(profile.summary).toMatchObject({
      meanTokPerSec: 7.5,
      medianTokPerSec: 7.5,
    });
  });
});

describe("shared-prefix long decode benchmark", () => {
  test("seed fixes only the prefix identity", () => {
    expect(longDecodePrefix("same", 512)).toBe(longDecodePrefix("same", 512));
    expect(longDecodePrefix("same", 512)).not.toBe(
      longDecodePrefix("different", 512),
    );
  });

  test("preserves prefix across workloads and runs, reports late degradation", async () => {
    const report = await benchmark(
      {
        longDecode: {
          frameDelayMs: 2,
          slowAfterTokens: 128,
          slowFrameDelayMs: 15,
        },
      },
      { benchRuns: 2 },
    );
    const long = report.longDecode!;
    expect(long.workloads.map((workload) => workload.id)).toEqual([
      "code",
      "prose",
      "predictable",
    ]);
    expect(report.contextScaling).toBeNull();
    for (const workload of long.workloads) {
      expect(workload.samples).toHaveLength(2);
      for (const sample of workload.samples) {
        expect(sample.reachedCap).toBe(true);
        expect(sample.summary!.lastTokPerSec).toBeLessThan(
          sample.summary!.firstTokPerSec * 0.5,
        );
        expect(sample.cachedInputTokens).toBe(10);
        expect(sample.finishReason).toBe("length");
      }
    }
    const bodies = engine!.chatBodies;
    const prefixes = bodies.map(
      (body) => (body.messages as Array<{ content: string }>)[0]!.content,
    );
    expect(new Set(prefixes).size).toBe(1);
    expect(prefixes[0]).toContain("test-prefix");
    expect(
      bodies.filter((body) => body.max_completion_tokens === 256),
    ).toHaveLength(9);
    const text = longDecodeLines(long).join("\n");
    expect(text).toContain("mean");
    expect(text).toContain("first");
    expect(benchSection(report)).toContain("Long decode");
    expect(benchSection(report)).not.toContain("Decode throughput</td>");
  });

  test("records natural stops and rejected length forcing", async () => {
    const report = await benchmark({
      longDecode: {
        maxOutputTokens: 48,
        rejectLengthForcing: true,
        frameDelayMs: 10,
      },
    });
    expect(report.longDecode!.lengthNote).toContain("ignore_eos not supported");
    for (const workload of report.longDecode!.workloads) {
      const sample = workload.samples[0]!;
      expect(sample.reachedCap).toBe(false);
      expect(sample.finishReason).toBe("stop");
      expect(sample.note).toContain("48 of 256");
      expect(sample.windows.at(-1)?.complete).toBe(false);
    }
    expect(
      engine!.chatBodies
        .filter((body) => body.max_completion_tokens === 256)
        .every((body) => body.ignore_eos === undefined),
    ).toBe(true);
  });

  test("records sampling and reasoning settings without changing the prefix", async () => {
    const report = await benchmark(
      {},
      {
        benchSampling: { name: "precise", temperature: 0.2, topP: 0.9 },
        reasoningEffort: "low",
      },
    );
    expect(report.longDecode!.sampling).toEqual({
      temperature: 0.2,
      topP: 0.9,
    });
    expect(report.longDecode!.reasoningEffort).toBe("low");
    expect(
      engine!.chatBodies.every(
        (body) =>
          body.temperature === 0.2 &&
          body.top_p === 0.9 &&
          body.reasoning_effort === "low",
      ),
    ).toBe(true);
  });

  test("a single buffered blob retains end-to-end rate without inventing decode speed", async () => {
    const report = await benchmark({ longDecode: { tokensPerFrame: 1000 } });
    for (const workload of report.longDecode!.workloads) {
      const sample = workload.samples[0]!;
      expect(sample.outputTokens).toBe(256);
      expect(sample.summary).toBeNull();
      expect(sample.decodeTokPerSec).toBeNull();
      expect(sample.endToEndTokPerSec).toBeGreaterThan(0);
      expect(sample.note).toContain("one frame");
    }
  });

  test("missing usage and single-blob streams leave windows unmeasured", async () => {
    const report = await benchmark({
      longDecode: { omitUsage: true, tokensPerFrame: 1000 },
    });
    for (const workload of report.longDecode!.workloads) {
      expect(workload.samples[0]?.summary).toBeNull();
      expect(workload.samples[0]?.decodeTokPerSec).toBeNull();
      expect(workload.samples[0]?.outputTokens).toBeNull();
      expect(workload.samples[0]?.reachedCap).toBeNull();
    }
  });

  test("escapes prefix identity in HTML", async () => {
    const report = await benchmark(
      {},
      {
        longDecode: {
          contextTokens: 512,
          maxTokens: 64,
          windowTokens: 16,
          prefixSeed: "<script>",
        },
      },
    );
    expect(benchSection(report)).toContain("&lt;script&gt;");
    expect(benchSection(report)).not.toContain("<script>");
  });
});
