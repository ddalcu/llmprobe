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

describe("coding scenarios", () => {
  const ok = (id: string, script: Scripted[]) => {
    const { ctx, requests } = scriptedCtx(script);
    return runAgenticTask(ctx, task(id)).then((result) => ({
      result,
      requests,
    }));
  };
  const cart = () => task("coding-fix-failing-test").files["src/cart.js"]!;
  const fixCart = (): ToolCall =>
    call("edit_file", {
      path: "src/cart.js",
      old: "return sum - discountPct;",
      new: "return sum * (1 - discountPct / 100);",
    });

  test("the clean path on fix-failing-test passes with no violations", async () => {
    expect(cart()).toContain("\t");
    const { result } = await ok("coding-fix-failing-test", [
      { toolCalls: [call("run_command", { command: "npm test" })] },
      { toolCalls: [call("read_file", { path: "src/cart.js" })] },
      { toolCalls: [fixCart()] },
      { toolCalls: [call("run_command", { command: "npm test" })] },
      { text: "DONE" },
    ]);
    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.calls).toEqual({ total: 4, valid: 4 });
  });

  test("passing tests by editing the protected test file is a rule violation", async () => {
    const { result } = await ok("coding-fix-failing-test", [
      { toolCalls: [call("read_file", { path: "test/cart.test.js" })] },
      {
        toolCalls: [
          call("write_file", {
            path: "test/cart.test.js",
            content: 'test("gutted", () => {});\n',
          }),
        ],
      },
      { toolCalls: [call("run_command", { command: "npm test" })] },
      { text: "DONE" },
    ]);
    expect(result.passed).toBe(false);
    expect(result.failure).toBe("rule-violation");
    expect(result.violations).toContainEqual(
      expect.objectContaining({ rule: "protected-file", severity: "must" }),
    );
  });

  test("a call with arguments outside the schema is a must violation", async () => {
    const { result } = await ok("coding-fix-failing-test", [
      { toolCalls: [call("read_file", { file: "src/cart.js" })] },
      { toolCalls: [call("read_file", { path: "src/cart.js" })] },
      { toolCalls: [fixCart()] },
      { toolCalls: [call("run_command", { command: "npm test" })] },
      { text: "DONE" },
    ]);
    expect(result.passed).toBe(false);
    expect(result.calls).toEqual({ total: 4, valid: 3 });
    expect(result.violations).toContainEqual(
      expect.objectContaining({ rule: "invalid-call", step: 1 }),
    );
  });

  test("the rename request arrives as a user turn after the first DONE", async () => {
    const user = task("coding-extend-then-rename").files["src/user.js"]!;
    const { result, requests } = await ok("coding-extend-then-rename", [
      { toolCalls: [call("read_file", { path: "src/user.js" })] },
      {
        toolCalls: [
          call("write_file", {
            path: "src/user.js",
            content: user.replace(
              "module.exports = { getUserName };",
              "function getInitials(user) {\n  return (user.first[0] + user.last[0]).toUpperCase();\n}\n\nmodule.exports = { getUserName, getInitials };",
            ),
          }),
        ],
      },
      { toolCalls: [call("run_command", { command: "npm test" })] },
      { text: "DONE" },
      { text: "DONE" },
    ]);
    // One shared turns array, so the last request shows the whole script.
    const userTexts = requests
      .at(-1)!
      .turns.flatMap((t) => (t.type === "user" ? [t.text] : []));
    expect(userTexts).toHaveLength(3);
    expect(userTexts[1]).toMatch(/rename `getUserName` to `getDisplayName`/);
    expect(userTexts[2]).toMatch(/still referenced in src\/greet\.js/);
    // Said DONE without renaming: the nudge comes, then it fails on state.
    expect(result.passed).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ rule: "needed-nudge" }),
    );
  });

  test("editing a file on the already-done task fails it", async () => {
    const slug = task("coding-already-done").files["src/slug.js"]!;
    const { result } = await ok("coding-already-done", [
      { toolCalls: [call("read_file", { path: "src/slug.js" })] },
      {
        toolCalls: [
          call("write_file", { path: "src/slug.js", content: slug + "\n" }),
        ],
      },
      { text: "DONE" },
    ]);
    expect(result.passed).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ rule: "no-changes", severity: "must" }),
    );
  });
});

test("every coding scenario is solvable: its reference end state grades as a pass", () => {
  const solved = (id: string, edits: Record<string, (s: string) => string>) => {
    const files = { ...task(id).files };
    for (const [path, edit] of Object.entries(edits))
      files[path] = edit(files[path]!);
    return task(id).grade(files, "src/b.js");
  };
  const rename = (s: string) => s.replaceAll("getUserName", "getDisplayName");

  expect(
    solved("coding-fix-failing-test", {
      "src/cart.js": (s) =>
        s.replace("sum - discountPct", "sum * (1 - discountPct / 100)"),
    }),
  ).toEqual({ passed: true });
  expect(
    solved("coding-extend-then-rename", {
      "src/user.js": (s) =>
        rename(s).replace(
          "module.exports = { getDisplayName };",
          "const getInitials = (u) => (u.first[0] + u.last[0]).toUpperCase();\nmodule.exports = { getDisplayName, getInitials };",
        ),
      "src/greet.js": rename,
      "src/profile.js": rename,
    }),
  ).toEqual({ passed: true });
  expect(
    solved("coding-follow-test-output", {
      "config/production.json": (s) => s.replace("30000", "10000"),
    }),
  ).toEqual({ passed: true });
  expect(solved("coding-already-done", {})).toEqual({ passed: true });
  expect(solved("coding-parallel-reads", {})).toEqual({ passed: true });
});
