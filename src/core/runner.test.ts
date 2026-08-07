import { describe, expect, test } from "vitest";

import { Inconclusive, Unsupported } from "./assert";
import { TargetUnreachableError } from "./client";
import type { ConformanceTest, EvalDef, RunContext } from "./context";
import { SURFACES } from "./registry";
import {
  buildCoverageEntries,
  type FeatureSupport,
  runConformance,
  runEvals,
} from "./runner";

function ctx(overrides: Partial<RunContext> = {}): RunContext {
  return {
    config: {} as RunContext["config"],
    client: {} as RunContext["client"],
    depth: "default",
    adapters: new Map(),
    present: new Set(["chat"]),
    evalSurface: "chat",
    send: async () => {
      throw new Error("not stubbed");
    },
    sendStream: async () => {
      throw new Error("not stubbed");
    },
    raw: async () => {
      throw new Error("not stubbed");
    },
    ...overrides,
  } as RunContext;
}

const testDef = (over: Partial<ConformanceTest> = {}): ConformanceTest => ({
  id: "t",
  name: "t",
  surface: "chat",
  tier: "core",
  run: async (_c, a) => {
    a.must("ok", "ok", true);
  },
  ...over,
});

describe("runConformance", () => {
  test("a missing surface makes the test unsupported and its feature unsupported", async () => {
    const { results, featureSupport } = await runConformance(
      [testDef({ surface: "responses", feature: "mcp-tools" })],
      ctx({ present: new Set(["chat"]) }),
    );

    expect(results[0]!.outcome).toBe("unsupported");
    expect(featureSupport.get("mcp-tools")).toMatchObject({ supported: false });
  });

  test("a passing test marks its feature supported", async () => {
    const { results, featureSupport } = await runConformance(
      [testDef({ feature: "tools" })],
      ctx(),
    );

    expect(results[0]!.outcome).toBe("pass");
    expect(featureSupport.get("tools")!.supported).toBe(true);
  });

  test("a MUST failure fails the test but keeps the feature supported", async () => {
    // The feature exists — it's just broken. That's a Conformance story, not a
    // Coverage one.
    const { results, featureSupport } = await runConformance(
      [
        testDef({
          feature: "tools",
          run: async (_c, a) => {
            a.must("bad", "bad", false, "wrong finish_reason");
          },
        }),
      ],
      ctx(),
    );

    expect(results[0]!.outcome).toBe("fail");
    expect(featureSupport.get("tools")!.supported).toBe(true);
  });

  test("a SHOULD failure alone does not fail the test", async () => {
    const { results } = await runConformance(
      [
        testDef({
          run: async (_c, a) => {
            a.must("ok", "ok", true);
            a.should("nit", "nit", false, "missing system_fingerprint");
          },
        }),
      ],
      ctx(),
    );

    expect(results[0]!.outcome).toBe("pass");
  });

  test("an honest rejection is unsupported, not a failure", async () => {
    const { results, featureSupport } = await runConformance(
      [
        testDef({
          feature: "logprobs",
          run: async () => ({
            featureSupported: false,
            unsupportedDetail: "rejects `logprobs` with 400",
          }),
        }),
      ],
      ctx(),
    );

    expect(results[0]!.outcome).toBe("unsupported");
    expect(featureSupport.get("logprobs")!.supported).toBe(false);
  });

  test("silently ignoring a requested param costs BOTH coverage and conformance", async () => {
    // The rule that gives the suite teeth: a 200 OK with the requested feature
    // quietly absent is worse than a clean 400, because callers can't detect it.
    const { results, featureSupport } = await runConformance(
      [
        testDef({
          feature: "logprobs",
          run: async (_c, a) => {
            a.must(
              "not-silently-ignored",
              "logprobs honored when requested",
              false,
              "accepted `logprobs: true` with 200 OK but returned none",
            );
            return {
              featureSupported: false,
              unsupportedDetail: "accepted but ignored",
            };
          },
        }),
      ],
      ctx(),
    );

    expect(results[0]!.outcome).toBe("fail");
    expect(featureSupport.get("logprobs")!.supported).toBe(false);
  });

  test("Unsupported thrown mid-test is unsupported", async () => {
    const { results } = await runConformance(
      [
        testDef({
          feature: "vision",
          run: async () => {
            throw new Unsupported("engine rejects image content parts");
          },
        }),
      ],
      ctx(),
    );

    expect(results[0]!.outcome).toBe("unsupported");
    expect(results[0]!.reason).toContain("image content parts");
  });

  test("Inconclusive keeps the feature supported and never scores", async () => {
    const { results, featureSupport } = await runConformance(
      [
        testDef({
          feature: "tools",
          run: async () => {
            throw new Inconclusive("model never emitted a tool call");
          },
        }),
      ],
      ctx(),
    );

    expect(results[0]!.outcome).toBe("inconclusive");
    // The engine *has* tools — we just couldn't get the model to use them.
    expect(featureSupport.get("tools")!.supported).toBe(true);
  });

  test("an unexpected throw is the engine's fault", async () => {
    const { results } = await runConformance(
      [
        testDef({
          run: async () => {
            throw new Error("socket hang up");
          },
        }),
      ],
      ctx(),
    );

    expect(results[0]!.outcome).toBe("fail");
    expect(results[0]!.assertions[0]!.message).toContain("socket hang up");
  });

  test("a dead target is reported as unreachable, not as a failed assertion", async () => {
    const { results } = await runConformance(
      [
        testDef({
          run: async () => {
            throw new TargetUnreachableError(
              "/chat/completions",
              Object.assign(new Error("fetch failed"), {
                cause: { code: "ECONNREFUSED" },
              }),
            );
          },
        }),
      ],
      ctx(),
    );

    // Scoring a corpse as "the engine answered wrongly" is what turned a
    // crashed process into "0/26 responses" and a model that can't name a
    // chemical symbol.
    expect(results[0]!.outcome).toBe("unreachable");
    expect(results[0]!.assertions).toEqual([]);
  });

  test("consecutive transport failures abort the run instead of scoring zeros", async () => {
    const dead = () => {
      throw new TargetUnreachableError(
        "/chat/completions",
        new Error("socket hang up"),
      );
    };

    const { results, unreachable } = await runConformance(
      [
        testDef({ id: "alive", name: "alive" }),
        testDef({ id: "d1", run: dead }),
        testDef({ id: "d2", run: dead }),
        testDef({ id: "d3", run: dead }),
        testDef({ id: "never-run-1" }),
        testDef({ id: "never-run-2" }),
      ],
      ctx(),
    );

    expect(unreachable).toMatchObject({ after: "alive", notRun: 2 });
    expect(results.map((r) => r.id)).toEqual(["alive", "d1", "d2", "d3"]);
  });

  test("a recovered target does not trip the abort", async () => {
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls <= 2)
        throw new TargetUnreachableError(
          "/chat/completions",
          new Error("socket hang up"),
        );
    };

    const { results, unreachable } = await runConformance(
      [
        testDef({ id: "a", run: flaky }),
        testDef({ id: "b", run: flaky }),
        testDef({ id: "c", run: flaky }),
        testDef({ id: "d", run: flaky }),
      ],
      ctx(),
    );

    expect(unreachable).toBeUndefined();
    expect(results).toHaveLength(4);
  });

  test("quick depth runs only the smoke set", async () => {
    const { results } = await runConformance(
      [testDef({ id: "a", quick: true }), testDef({ id: "b" })],
      ctx({ depth: "quick" }),
    );

    expect(results.find((r) => r.id === "a")!.outcome).toBe("pass");
    expect(results.find((r) => r.id === "b")!.outcome).toBe("skipped");
  });

  test("slow tests are held back until --full", async () => {
    const { results } = await runConformance(
      [testDef({ id: "slow", slow: true })],
      ctx({ depth: "default" }),
    );
    expect(results[0]!.outcome).toBe("skipped");

    const full = await runConformance(
      [testDef({ id: "slow", slow: true })],
      ctx({ depth: "full" }),
    );
    expect(full.results[0]!.outcome).toBe("pass");
  });

  test("a feature marked unsupported once is not upgraded by a later test", async () => {
    const { featureSupport } = await runConformance(
      [
        testDef({
          id: "a",
          feature: "vision",
          run: async () => ({ featureSupported: false }),
        }),
        testDef({ id: "b", feature: "vision" }),
      ],
      ctx(),
    );

    expect(featureSupport.get("vision")!.supported).toBe(false);
  });
});

describe("runEvals", () => {
  const support = (entries: Record<string, boolean>): FeatureSupport =>
    new Map(Object.entries(entries).map(([k, v]) => [k, { supported: v }]));

  const evalDef = (over: Partial<EvalDef> = {}): EvalDef => ({
    id: "e",
    name: "e",
    category: "tool-selection",
    run: async () => ({ passed: true }),
    ...over,
  });

  test("runs k samples so flaky tool calling is visible", async () => {
    let call = 0;
    const results = await runEvals(
      [
        evalDef({
          k: 3,
          run: async () => ({ passed: ++call === 1 }),
        }),
      ],
      ctx(),
      support({}),
    );

    expect(results[0]!.samples.map((s) => s.passed)).toEqual([
      true,
      false,
      false,
    ]);
  });

  test("an eval needing a feature the engine lacks is excluded, not failed", async () => {
    // Vision evals against a vision-less engine say nothing about the model.
    const results = await runEvals(
      [evalDef({ requiresFeature: "vision" })],
      ctx(),
      support({ vision: false }),
    );

    expect(results[0]!.outcome).toBe("unsupported");
    expect(results[0]!.samples).toHaveLength(0);
  });

  test("an engine error during an eval is a failed sample, not a crash", async () => {
    const results = await runEvals(
      [
        evalDef({
          run: async () => {
            throw new Error("500 from engine");
          },
        }),
      ],
      ctx(),
      support({}),
    );

    expect(results[0]!.samples[0]).toMatchObject({ passed: false });
    expect(results[0]!.samples[0]!.message).toContain("500");
  });

  test("with no chat-shaped surface at all, evals cannot run", async () => {
    const results = await runEvals(
      [evalDef()],
      ctx({ evalSurface: null }),
      support({}),
    );
    expect(results[0]!.outcome).toBe("unsupported");
  });
});

describe("runEvals unreachable", () => {
  test("a dead target stops the evals instead of grading the model at zero", async () => {
    const support: FeatureSupport = new Map();
    const evals: EvalDef[] = [
      {
        id: "e1",
        name: "knows a chemical symbol",
        category: "knowledge",
        run: async () => {
          throw new TargetUnreachableError(
            "/chat/completions",
            new Error("socket hang up"),
          );
        },
      },
    ];

    await expect(runEvals(evals, ctx(), support)).rejects.toBeInstanceOf(
      TargetUnreachableError,
    );
  });
});

describe("buildCoverageEntries", () => {
  test("a missing surface drags its dependent features down with it", async () => {
    // No Responses surface means no MCP tools and no previous_response_id —
    // and all three cost coverage. This is the normative bite.
    const entries = buildCoverageEntries(
      SURFACES,
      new Set(["chat", "models"]),
      new Map(),
    );

    const byId = (id: string) => entries.find((e) => e.item.id === id)!;

    expect(byId("responses").supported).toBe(false);
    expect(byId("mcp-tools").supported).toBe(false);
    expect(byId("mcp-tools").detail).toContain("responses not implemented");
  });

  test("features carry the detail explaining why they're missing", () => {
    const entries = buildCoverageEntries(
      SURFACES,
      new Set(["chat"]),
      new Map([
        ["logprobs", { supported: false, detail: "accepted but ignored" }],
      ]),
    );

    const logprobs = entries.find((e) => e.item.id === "logprobs")!;
    expect(logprobs.detail).toBe("accepted but ignored");
  });
});
