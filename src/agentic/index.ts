import type { ToolDef, Turn } from "../core/adapter";
import { tryParseJson } from "../core/assert";
import { BudgetExceededError, TargetUnreachableError } from "../core/client";
import type { RunContext } from "../core/context";
import type {
  AgenticFailure,
  AgenticScore,
  AgenticTaskResult,
} from "../core/outcome";
import {
  expectNumber,
  fail,
  type Graded,
  pass,
  stripThinking,
} from "../evals/grading";
import { type CallRecord, CODING_TASKS, type Rule } from "./coding";
import {
  executeTool,
  invalidCall,
  WORKSPACE_TOOLS,
  type Workspace,
} from "./env";

/**
 * Agentic — can the model run a short tool loop, not just answer one call?
 *
 * The capability card asks "does a single tool call come out right". This card
 * asks the question people actually have about a local model: read the right
 * file, act on what it found, verify, stop. Workspace tasks, each with a trap that
 * catches the characteristic failure of models that clear the floor but fall
 * apart as agents — answering from priors instead of looking, editing the
 * plausible file instead of the configured one, never stopping.
 *
 * Grading is deterministic: the final workspace state (or final answer) is
 * compared by string, at temperature 0, k=1. The step cap is ~2× the optimal
 * path, so "ran out of steps" means looping, not tight budgeting. The coding
 * tasks (./coding.ts) grade the tool trajectory as well.
 */

// Room for an edit_file or write_file carrying a whole small module.
const STEP_MAX_TOKENS = 1024;

export interface AgenticTaskDef {
  id: string;
  name: string;
  prompt: string;
  files: Workspace;
  /** Model requests allowed — roughly twice the optimal path. */
  maxSteps: number;
  /**
   * Judge the end state. `finalText` is the model's closing reply ("" when it
   * hit the step cap); edit tasks should grade the files alone, so a correct
   * edit followed by a missing sign-off still counts as the work being done.
   */
  grade(files: Workspace, finalText: string): Graded;
  /** Defaults to the three workspace tools. */
  tools?: ToolDef[];
  /**
   * The scripted user: called each time the model stops, with how many times
   * it has stopped before. A string is the next user turn; null ends the task.
   */
  followUp?(files: Workspace, round: number): string | null;
  /** Trajectory rules; a task with rules reports violations and call counts. */
  rules?: Rule[];
}

const WORKSPACE_TASKS: AgenticTaskDef[] = [
  {
    id: "agentic-read",
    name: "reads the config instead of answering from priors",
    prompt:
      "You have tools to inspect a small file workspace. What port does the " +
      "server listen on according to config.json? Reply with just the number.",
    files: {
      "config.json": `{\n  "server": { "host": "0.0.0.0", "port": 8443 },\n  "log_level": "info"\n}\n`,
      // The trap: a plausible number in prose. A model that answers 8080
      // pattern-matched the README (or its priors) instead of looking.
      "README.md":
        "# demo service\n\nRun `npm start` to launch. The dev server usually runs on port 8080.\n",
    },
    maxSteps: 4,
    grade: (_files, finalText) => expectNumber(finalText, 8443, "server port"),
  },
  {
    id: "agentic-edit",
    name: "finds where the port really lives and edits only that",
    prompt:
      "You have tools to inspect and modify a small file workspace. The " +
      "service must listen on port 9090. Find where the port is actually " +
      "configured and change it. Do not change anything else. Reply DONE " +
      "when you are finished.",
    files: {
      "src/app.js": `const settings = require("../config/settings.json");\nconst server = require("./server");\n\nserver.listen(settings.network.port);\n`,
      "config/settings.json": `{\n  "network": { "host": "localhost", "port": 8080 },\n  "debug": false\n}\n`,
      "README.md":
        "# demo service\n\nThe service listens on port 8080 by default.\n",
    },
    maxSteps: 8,
    grade: (files) => {
      const task = WORKSPACE_TASKS.find((t) => t.id === "agentic-edit")!;

      let settings: unknown;
      try {
        settings = JSON.parse(files["config/settings.json"] ?? "");
      } catch {
        return fail("config/settings.json is no longer valid JSON");
      }

      const network = (settings as Record<string, any>)?.network;
      if (network?.port !== 9090) {
        return fail(
          `network.port is still ${JSON.stringify(network?.port ?? 8080)}, expected 9090`,
        );
      }
      if (network?.host !== "localhost" || (settings as any)?.debug !== false) {
        return fail("changed other settings besides the port");
      }

      for (const path of ["src/app.js", "README.md"]) {
        if (files[path] !== task.files[path]) {
          return fail(`edited ${path}, which the task said to leave alone`);
        }
      }
      return pass();
    },
  },
  {
    id: "agentic-indirect",
    name: "follows the pointer in build.cfg instead of guessing",
    prompt:
      "You have tools to inspect and modify a small file workspace. Bump the " +
      "project's version to 2.2.0. build.cfg records which file holds the " +
      "version — update that file and nothing else. Reply DONE when you are " +
      "finished.",
    files: {
      "build.cfg":
        "# build configuration\nversion_file = VERSION\noptimize = true\n",
      VERSION: "2.1.7\n",
      // The trap: the file a model edits when it guesses by name instead of
      // reading the pointer.
      "version.txt": "1.0.0\n",
      "README.md": "# widget\n\nSee build.cfg for build settings.\n",
    },
    maxSteps: 8,
    grade: (files) => {
      const task = WORKSPACE_TASKS.find((t) => t.id === "agentic-indirect")!;

      if (files["version.txt"] !== task.files["version.txt"]) {
        return fail(
          "edited version.txt — the pointer in build.cfg names VERSION, not version.txt",
        );
      }
      for (const path of ["build.cfg", "README.md"]) {
        if (files[path] !== task.files[path]) {
          return fail(`edited ${path}, which the task said to leave alone`);
        }
      }
      if ((files["VERSION"] ?? "").trim() !== "2.2.0") {
        return fail(
          `VERSION still reads "${(files["VERSION"] ?? "").trim()}", expected 2.2.0`,
        );
      }
      return pass();
    },
  },
];

export const TASKS: AgenticTaskDef[] = [...WORKSPACE_TASKS, ...CODING_TASKS];

export async function runAgenticTask(
  ctx: RunContext,
  task: AgenticTaskDef,
): Promise<AgenticTaskResult> {
  const surface = ctx.evalSurface;
  if (!surface) throw new Error("no chat-shaped surface available");

  const tools = task.tools ?? WORKSPACE_TOOLS;
  const files: Workspace = { ...task.files };
  const turns: Turn[] = [{ type: "user", text: task.prompt }];
  const calls: CallRecord[] = [];
  const userTurns: string[] = [];

  let steps = 0;
  let usedTool = false;

  // Rules only speak for tasks that declare them; a must violation fails a
  // task whose end state was otherwise right.
  const finish = (
    graded: { passed: boolean; message?: string },
    failure: AgenticFailure | undefined,
    detail: string | undefined,
  ): AgenticTaskResult => {
    const result: AgenticTaskResult = {
      id: task.id,
      name: task.name,
      passed: graded.passed && failure === undefined,
      steps,
    };
    if (task.rules) {
      const trajectory = {
        calls,
        initial: task.files,
        files,
        userTurns,
        prompt: task.prompt,
      };
      result.violations = task.rules.flatMap((rule) => rule(trajectory));
      result.calls = {
        total: calls.length,
        valid: calls.filter((c) => c.invalid === null).length,
      };
      const broken = result.violations.find((v) => v.severity === "must");
      if (result.passed && broken) {
        result.passed = false;
        failure = "rule-violation";
        detail = broken.detail;
      }
    }
    if (!result.passed) {
      result.failure = failure ?? "wrong-answer";
      if (detail) result.detail = detail;
    }
    return result;
  };

  while (steps < task.maxSteps) {
    steps += 1;

    let reply;
    try {
      reply = (
        await ctx.send(surface, {
          turns,
          tools,
          temperature: 0,
          maxTokens: STEP_MAX_TOKENS,
        })
      ).reply;
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      // The target is gone — the remaining tasks would only measure a corpse.
      if (err instanceof TargetUnreachableError) throw err;
      return finish(
        { passed: false },
        "engine-error",
        err instanceof Error ? err.message : String(err),
      );
    }

    // No tool calls means the model considers itself done: the scripted user
    // may have more to ask, otherwise grade it.
    if (reply.toolCalls.length === 0) {
      const text = stripThinking(reply.text);
      const next = task.followUp?.(files, userTurns.length) ?? null;
      if (next !== null) {
        userTurns.push(next);
        turns.push({ type: "assistant-text", text });
        turns.push({ type: "user", text: next });
        continue;
      }
      const graded = task.grade(files, text);
      // A coding task is about the trajectory; a right answer without one is
      // a guess.
      if (graded.passed && (usedTool || !task.rules))
        return finish(graded, undefined, undefined);
      return finish(
        graded,
        usedTool ? "wrong-answer" : "no-tool-call",
        usedTool
          ? graded.message
          : `never used a tool${graded.message ? ` — ${graded.message}` : ""}`,
      );
    }

    usedTool = true;
    for (const call of reply.toolCalls) {
      const output = executeTool(files, call.name, call.argsJson, tools);
      const parsed = tryParseJson(call.argsJson === "" ? "{}" : call.argsJson);
      calls.push({
        step: steps,
        round: userTurns.length,
        name: call.name,
        args:
          parsed.ok && typeof parsed.value === "object" && parsed.value !== null
            ? (parsed.value as Record<string, unknown>)
            : null,
        invalid: invalidCall(tools, call.name, call.argsJson),
        output,
      });
      turns.push({ type: "assistant-tool-call", call });
      turns.push({
        type: "tool-result",
        toolCallId: call.id,
        toolName: call.name,
        output,
      });
    }
  }

  // Still calling tools at the cap. Grade the state anyway: "did the work but
  // never stopped" and "never got there" are different diagnoses.
  const state = task.grade(files, "");
  return finish(
    { passed: false },
    "step-limit",
    state.passed
      ? `the work itself was done — the model never stopped calling tools`
      : `hit the ${task.maxSteps}-step cap${state.message ? ` (${state.message})` : ""}`,
  );
}

export function scoreAgentic(tasks: AgenticTaskResult[]): AgenticScore {
  const passed = tasks.filter((t) => t.passed).length;
  const pct =
    tasks.length === 0 ? 0 : Math.round((passed / tasks.length) * 1000) / 10;
  return { tasks, passed, total: tasks.length, pct };
}

export async function runAgentic(
  ctx: RunContext,
  onProgress?: (result: AgenticTaskResult) => void,
): Promise<AgenticScore> {
  const results: AgenticTaskResult[] = [];
  for (const task of TASKS) {
    const result = await runAgenticTask(ctx, task);
    results.push(result);
    onProgress?.(result);
  }
  return scoreAgentic(results);
}
