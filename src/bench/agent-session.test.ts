import { afterEach, describe, expect, test } from "vitest";
import { ADAPTERS } from "../conformance/index";
import { EngineClient, type RunConfig } from "../core/client";
import { createContext } from "../core/context";
import {
  type MockEngine,
  type MockDefects,
  startMockEngine,
} from "../fixtures/mock-engine";
import { runBenchmark } from "./index";
import { agentSessionPrefix, agentSessionTask } from "./agent-session-corpus";
import { agentSessionLines } from "../core/report/agent-session";
import { benchSection } from "../core/report/card/bench";

let engine: MockEngine | undefined;
afterEach(() => engine?.stop());
async function bench(
  defects: MockDefects = {},
  overrides: Partial<RunConfig> = {},
) {
  engine = await startMockEngine({
    promptCache: true,
    longDecode: { maxOutputTokens: 64, frameDelayMs: 3 },
    ...defects,
  });
  const config: RunConfig = {
    baseUrl: `${engine.url}/v1`,
    apiKey: "",
    model: "mock-model-12b",
    timeoutMs: 1000,
    depth: "default",
    reasoningHeadroom: 0,
    agentSession: {
      baseTokens: 512,
      targetTokens: 5000,
      maxTurns: 12,
      windowTokens: 16,
      prefixSeed: "session-test",
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

describe("agent session recipe", () => {
  test("deterministic project and recurring tasks yield fresh source bundles", () => {
    expect(agentSessionPrefix("fixed", 2000)).toBe(
      agentSessionPrefix("fixed", 2000),
    );
    expect(agentSessionTask(1)).toEqual(agentSessionTask(1));
    expect(agentSessionTask(5).name).toBe(agentSessionTask(1).name);
    expect(agentSessionTask(5).text).not.toBe(agentSessionTask(1).text);
    expect(agentSessionTask(1).bundleTokens).toBe(256);
    expect(agentSessionTask(2).bundleTokens).toBe(2048);
    expect(agentSessionTask(2).maxTokens).toBe(1024);
  });
});

describe("growing agent session", () => {
  test("reaches measured target with serial requests and unchanged history", async () => {
    const report = await bench();
    const session = report.agentSession!;
    expect(session.stop).toBe("target");
    expect(session.reachedInputTokens).toBeGreaterThanOrEqual(5000);
    expect(session.overshootTokens).toBe(session.reachedInputTokens! - 5000);
    expect(session.turns.length).toBeGreaterThan(2);
    expect(engine!.chatPeakInFlight).toBe(1);
    expect(session.outputTokens).toBe(session.turns.length * 64);
    expect(session.turns.every((turn) => turn.text === "text".repeat(64))).toBe(
      true,
    );
    expect(session.aggregateTokPerSec).toBeCloseTo(
      (session.outputTokens! / session.elapsedMs) * 1000,
    );
    expect(report.contextScaling).toBeNull();
    const measured = engine!.chatBodies.filter((body) =>
      (
        (body.messages as Array<{ content: string }>).at(-1)?.content ?? ""
      ).startsWith("[agent-session turn "),
    );
    for (let i = 1; i < measured.length; i++) {
      const previous = measured[i - 1]!.messages as Array<{
        content: string;
        role: string;
      }>;
      const current = measured[i]!.messages as Array<{
        content: string;
        role: string;
      }>;
      expect(current.slice(0, previous.length)).toEqual(previous);
      expect(current[previous.length]).toMatchObject({
        role: "assistant",
        content: "text".repeat(64),
      });
      expect(measured[i]!.tools).toBeUndefined();
      expect(session.turns[i]!.inputTokens).toBeGreaterThan(
        session.turns[i - 1]!.inputTokens!,
      );
      expect(session.turns[i]!.cachedInputTokens).toBe(10);
    }
    expect(agentSessionLines(session).join("\n")).toContain("aggregate");
    expect(benchSection(report)).toContain("Agent session");
    expect(benchSection(report)).not.toContain("Prefill throughput</td>");
  });

  test("fits starting prefix before measurement", async () => {
    const report = await bench({ bytesPerToken: 5 });
    expect(
      Math.abs(report.agentSession!.prefixInputTokens! - 512),
    ).toBeLessThan(80);
    const measured = engine!.chatBodies.filter((body) =>
      (
        (body.messages as Array<{ content: string }>).at(-1)?.content ?? ""
      ).startsWith("[agent-session turn "),
    );
    expect(
      new Set(
        measured.map((body) => JSON.stringify((body.messages as unknown[])[0])),
      ).size,
    ).toBe(1);
  });

  test("missing input usage cannot claim target attained", async () => {
    const report = await bench({
      longDecode: { maxOutputTokens: 32, omitInputUsage: true },
    });
    expect(report.agentSession!.stop).toBe("missing-usage");
    expect(report.agentSession!.reachedInputTokens).toBeNull();
    expect(report.agentSession!.turns).toHaveLength(1);
  });

  test("safety limit leaves target visibly unmet", async () => {
    const report = await bench(
      {},
      {
        agentSession: {
          baseTokens: 512,
          targetTokens: 100000,
          maxTurns: 2,
          windowTokens: 16,
        },
      },
    );
    expect(report.agentSession!.stop).toBe("turn-limit");
    expect(report.agentSession!.overshootTokens).toBeNull();
    expect(report.agentSession!.note).toContain("before target");
  });

  test("context overflow keeps completed trajectory and named failure", async () => {
    const report = await bench({ rejectAbovePromptBytes: 10000 });
    expect(report.agentSession!.stop).toBe("engine-error");
    expect(report.agentSession!.note).toContain("context window exceeded");
    expect(report.agentSession!.turns.at(-1)?.error).toContain("HTTP 400");
    expect(report.agentSession!.aggregateTokPerSec).toBeNull();
  });

  test("budget exhaustion preserves measured turns", async () => {
    const report = await bench({}, { budgetTokens: 4000 });
    expect(report.agentSession!.stop).toBe("budget");
    expect(report.agentSession!.turns.length).toBeGreaterThan(0);
    expect(report.agentSession!.note).toContain("token budget exhausted");
  });
});
