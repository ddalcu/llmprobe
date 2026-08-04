import { describe, expect, test } from "vitest";

import type { ChatReply, ChatRequest, ToolCall } from "../core/adapter";
import { BudgetExceededError } from "../core/client";
import type { RunContext } from "../core/context";
import { runAgentic, runAgenticTask, scoreAgentic, TASKS } from "./index";

const task = (id: string) => {
  const found = TASKS.find((t) => t.id === id);
  if (!found) throw new Error(`no task ${id}`);
  return found;
};

const call = (name: string, args: Record<string, unknown>): ToolCall => ({
  id: `c_${name}`,
  name,
  argsJson: JSON.stringify(args),
});

type Scripted = { text?: string; toolCalls?: ToolCall[] };

/**
 * A model played from a script: reply k answers request k, and the last entry
 * repeats forever (which is how the loop tests model a model that never stops).
 */
function scriptedCtx(script: Scripted[]): {
  ctx: RunContext;
  requests: ChatRequest[];
} {
  const requests: ChatRequest[] = [];

  const send = async (_surface: string, request: ChatRequest) => {
    const plan = script[Math.min(requests.length, script.length - 1)]!;
    requests.push(request);

    const reply: ChatReply = {
      id: "r1",
      text: plan.text ?? "",
      toolCalls: plan.toolCalls ?? [],
      finishReason: plan.toolCalls?.length ? "tool_calls" : "stop",
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cachedInputTokens: null,
        reasoningTokens: null,
      },
      reasoningText: null,
      logprobs: undefined,
      raw: {},
    };

    return {
      reply,
      status: 200,
      headers: new Headers(),
      raw: {},
      text: "",
      durationMs: 1,
    };
  };

  const ctx = {
    config: {} as RunContext["config"],
    client: {} as RunContext["client"],
    depth: "default",
    adapters: new Map(),
    present: new Set(["chat"]),
    evalSurface: "chat",
    send,
    sendStream: async () => {
      throw new Error("not stubbed");
    },
    raw: async () => {
      throw new Error("not stubbed");
    },
  } as RunContext;

  return { ctx, requests };
}

describe("the driver loop", () => {
  test("a model that reads the file and answers passes in two steps", async () => {
    const { ctx, requests } = scriptedCtx([
      { toolCalls: [call("read_file", { path: "config.json" })] },
      { text: "8443" },
    ]);

    const result = await runAgenticTask(ctx, task("agentic-read"));

    expect(result.passed).toBe(true);
    expect(result.steps).toBe(2);
    expect(result.failure).toBeUndefined();

    // The second request must carry the tool exchange back to the model —
    // the call turn and a result turn holding the real file content.
    const turns = requests[1]!.turns;
    const toolResult = turns.find((t) => t.type === "tool-result");
    expect(toolResult).toBeDefined();
    expect((toolResult as { output: string }).output).toContain("8443");
  });

  test("tool calls run at temperature 0 so reruns are reproducible", async () => {
    const { ctx, requests } = scriptedCtx([{ text: "8443" }]);
    await runAgenticTask(ctx, task("agentic-read"));
    expect(requests[0]!.temperature).toBe(0);
  });

  test("a model that answers from its priors without looking is no-tool-call", async () => {
    const { ctx } = scriptedCtx([{ text: "The port is 8080." }]);

    const result = await runAgenticTask(ctx, task("agentic-read"));

    expect(result.passed).toBe(false);
    expect(result.failure).toBe("no-tool-call");
  });

  test("a model that loops without finishing hits the step cap", async () => {
    const { ctx, requests } = scriptedCtx([
      { toolCalls: [call("list_files", {})] },
    ]);

    const result = await runAgenticTask(ctx, task("agentic-read"));

    expect(result.passed).toBe(false);
    expect(result.failure).toBe("step-limit");
    expect(requests.length).toBe(task("agentic-read").maxSteps);
    expect(result.steps).toBe(task("agentic-read").maxSteps);
  });

  test("a model that looked but answered wrong is wrong-answer, not no-tool-call", async () => {
    const { ctx } = scriptedCtx([
      { toolCalls: [call("read_file", { path: "config.json" })] },
      { text: "8080" },
    ]);

    const result = await runAgenticTask(ctx, task("agentic-read"));

    expect(result.passed).toBe(false);
    expect(result.failure).toBe("wrong-answer");
  });

  test("a model that did the work but never stops still fails, and the detail says so", async () => {
    const correct = JSON.stringify({
      network: { host: "localhost", port: 9090 },
      debug: false,
    });
    const { ctx } = scriptedCtx([
      {
        toolCalls: [
          call("write_file", {
            path: "config/settings.json",
            content: correct,
          }),
        ],
      },
      { toolCalls: [call("list_files", {})] },
    ]);

    const result = await runAgenticTask(ctx, task("agentic-edit"));

    expect(result.passed).toBe(false);
    expect(result.failure).toBe("step-limit");
    expect(result.detail).toMatch(/never stopped/i);
  });

  test("an engine error fails the task as engine-error instead of crashing the run", async () => {
    const ctx = scriptedCtx([]).ctx;
    ctx.send = async () => {
      throw new Error("socket hang up");
    };

    const result = await runAgenticTask(ctx, task("agentic-read"));

    expect(result.passed).toBe(false);
    expect(result.failure).toBe("engine-error");
    expect(result.detail).toContain("socket hang up");
  });

  test("a blown token budget propagates — it must stop the whole run", async () => {
    const ctx = scriptedCtx([]).ctx;
    ctx.send = async () => {
      throw new BudgetExceededError(1000, 500);
    };

    await expect(runAgenticTask(ctx, task("agentic-read"))).rejects.toThrow(
      BudgetExceededError,
    );
    await expect(runAgentic(ctx)).rejects.toThrow(BudgetExceededError);
  });
});

describe("grading the edit task", () => {
  const edit = () => task("agentic-edit");
  const solved = () => {
    const fs = { ...edit().files };
    fs["config/settings.json"] = JSON.stringify(
      { network: { host: "localhost", port: 9090 }, debug: false },
      null,
      2,
    );
    return fs;
  };

  test("changing the port in the right file passes", () => {
    expect(edit().grade(solved(), "DONE").passed).toBe(true);
  });

  test("an untouched workspace fails", () => {
    const graded = edit().grade({ ...edit().files }, "DONE");
    expect(graded.passed).toBe(false);
    expect(graded.message).toContain("8080");
  });

  test("dropping the other settings while editing fails", () => {
    const fs = { ...edit().files };
    fs["config/settings.json"] = '{"network":{"port":9090}}';
    const graded = edit().grade(fs, "DONE");
    expect(graded.passed).toBe(false);
  });

  test("clobbering the file with invalid JSON fails and says why", () => {
    const fs = { ...edit().files };
    fs["config/settings.json"] = "port: 9090";
    const graded = edit().grade(fs, "DONE");
    expect(graded.passed).toBe(false);
    expect(graded.message).toContain("JSON");
  });

  test("collateral edits to unrelated files fail even when the port is right", () => {
    const fs = solved();
    fs["README.md"] = "# demo service\n\nThe service listens on port 9090.\n";
    const graded = edit().grade(fs, "DONE");
    expect(graded.passed).toBe(false);
    expect(graded.message).toContain("README.md");
  });
});

describe("grading the indirection task", () => {
  const indirect = () => task("agentic-indirect");

  test("updating the file build.cfg points to passes", () => {
    const fs = { ...indirect().files };
    fs["VERSION"] = "2.2.0\n";
    expect(indirect().grade(fs, "DONE").passed).toBe(true);
  });

  test("editing the decoy version.txt instead fails, naming the trap", () => {
    const fs = { ...indirect().files };
    fs["version.txt"] = "2.2.0\n";
    const graded = indirect().grade(fs, "DONE");
    expect(graded.passed).toBe(false);
    expect(graded.message).toContain("version.txt");
  });

  test("rewriting the pointer instead of the target fails", () => {
    const fs = { ...indirect().files };
    fs["build.cfg"] =
      "# build configuration\nversion_file = VERSION\nversion = 2.2.0\n";
    fs["VERSION"] = "2.2.0\n";
    const graded = indirect().grade(fs, "DONE");
    expect(graded.passed).toBe(false);
  });
});

describe("scoreAgentic", () => {
  test("counts tasks, not samples, and never emits NaN", () => {
    const score = scoreAgentic([
      { id: "a", name: "a", passed: true, steps: 2 },
      { id: "b", name: "b", passed: true, steps: 5 },
      { id: "c", name: "c", passed: false, steps: 8, failure: "step-limit" },
    ]);

    expect(score.passed).toBe(2);
    expect(score.total).toBe(3);
    expect(score.pct).toBe(66.7);

    expect(scoreAgentic([]).pct).toBe(0);
  });
});
