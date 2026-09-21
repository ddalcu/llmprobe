import assert from "node:assert";
import { posix } from "node:path";
import vm from "node:vm";

import type { ToolDef } from "../core/adapter";
import { tryParseJson } from "../core/assert";

/**
 * The simulated workspace: a handful of files in a plain object, and the tools
 * to act on them — three for the original tasks, six for the coding ones. Executed in-process by llmprobe, so a "tool call" costs
 * nothing and the final state can be graded as a string comparison — the
 * terminal-bench idea without a sandbox.
 *
 * Every failure a tool can produce comes back as an `error:` string in the
 * tool result, never as a thrown exception. Recovering from a bad path or a
 * malformed argument is part of what the tasks measure.
 */

export type Workspace = Record<string, string>;

export const WORKSPACE_TOOLS: ToolDef[] = [
  {
    name: "list_files",
    description: "List every file in the workspace.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "read_file",
    description: "Read the full contents of one file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path of the file to read." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "write_file",
    description:
      "Replace a file's entire contents. Creates the file if it does not exist.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path of the file to write." },
        content: { type: "string", description: "The new file contents." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
];

const pathArg = { type: "string", description: "Workspace-relative path." };

/** What a coding agent has: the workspace tools plus search, edit and a shell. */
export const CODING_TOOLS: ToolDef[] = [
  ...WORKSPACE_TOOLS,
  {
    name: "search",
    description:
      "Find a literal string in every file. Returns path:line: text for each match.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Literal text to find." },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  {
    name: "edit_file",
    description:
      "Replace one exact occurrence of `old` with `new` in a file. `old` must match the file exactly, whitespace included, and only once.",
    parameters: {
      type: "object",
      properties: {
        path: pathArg,
        old: { type: "string", description: "Exact text to replace." },
        new: { type: "string", description: "Replacement text." },
      },
      required: ["path", "old", "new"],
      additionalProperties: false,
    },
  },
  {
    name: "run_command",
    description:
      "Run a shell command in the project root. Use `npm test` to run the test suite.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command to run." },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
];

export const TEST_COMMANDS = new Set([
  "npm test",
  "npm run test",
  "npm t",
  "npx vitest run",
  "npx jest",
  "node --test",
]);
export const SHELL_FILE_OPS = /^(cat|ls|grep|rg|sed|awk|head|tail|find)\b/;

export const normalizeCommand = (command: string): string =>
  command.trim().replace(/\s+/g, " ");

/**
 * Why a call does not fit its tool's schema, or null when it does. The
 * schemas are flat objects of strings, so this checks exactly that.
 */
export function invalidCall(
  tools: ToolDef[],
  name: string,
  argsJson: string,
): string | null {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return `unknown tool "${name}"`;
  const parsed = tryParseJson(argsJson === "" ? "{}" : argsJson);
  if (!parsed.ok) return "arguments were not valid JSON";
  const args = parsed.value;
  if (typeof args !== "object" || args === null || Array.isArray(args))
    return "arguments were not a JSON object";
  const schema = tool.parameters as {
    properties: Record<string, { type: string }>;
    required?: string[];
  };
  for (const key of schema.required ?? []) {
    if (!(key in args)) return `missing required argument "${key}"`;
  }
  for (const [key, value] of Object.entries(args)) {
    const prop = schema.properties[key];
    if (!prop) return `unexpected argument "${key}"`;
    if (typeof value !== prop.type)
      return `argument "${key}" must be a ${prop.type}`;
  }
  return null;
}

const TEST_TIMEOUT_MS = 1_000;

/**
 * `npm test` for the workspace: every *.test.js, CommonJS require between
 * workspace files, a global `test(name, fn)`. Runs in one vm context with a
 * timeout over the whole run, so a model's infinite loop costs a second.
 */
export function runTests(files: Workspace): {
  passed: boolean;
  output: string;
} {
  const lines: string[] = [];
  let failed = 0;
  let passed = 0;

  const run = () => {
    const context = vm.createContext({});
    const cache = new Map<string, { exports: unknown }>();

    const resolve = (from: string, id: string): string => {
      const base = posix.normalize(posix.join(posix.dirname(from), id));
      for (const path of [
        base,
        `${base}.js`,
        `${base}.json`,
        `${base}/index.js`,
      ]) {
        if (path in files) return path;
      }
      throw new Error(`Cannot find module '${id}' from ${from}`);
    };

    const load = (
      path: string,
      test: (name: string, fn: () => void) => void,
    ): unknown => {
      const cached = cache.get(path);
      if (cached) return cached.exports;
      const module = { exports: {} as unknown };
      cache.set(path, module);
      if (path.endsWith(".json")) {
        module.exports = JSON.parse(files[path]!);
        return module.exports;
      }
      const require = (id: string) =>
        id === "assert" || id === "node:assert"
          ? assert
          : load(resolve(path, id), test);
      const wrapped = vm.runInContext(
        `(function (require, module, exports, test) {\n${files[path]}\n})`,
        context,
        { filename: path },
      ) as (...args: unknown[]) => void;
      wrapped(require, module, module.exports, test);
      return module.exports;
    };

    const oneLine = (err: unknown) =>
      (err instanceof Error ? `${err.name}: ${err.message}` : String(err))
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join(" ")
        .slice(0, 200);

    for (const path of Object.keys(files)
      .filter((p) => p.endsWith(".test.js"))
      .sort()) {
      const results: string[] = [];
      let fileFailed = false;
      const test = (name: string, fn: () => void) => {
        try {
          fn();
          passed += 1;
          results.push(`  ✓ ${name}`);
        } catch (err) {
          failed += 1;
          fileFailed = true;
          results.push(`  ✗ ${name}`, `    ${oneLine(err)}`);
        }
      };
      try {
        load(path, test);
      } catch (err) {
        failed += 1;
        fileFailed = true;
        results.push(`  ${oneLine(err)}`);
      }
      lines.push(`${fileFailed ? "FAIL" : "PASS"} ${path}`, ...results);
    }
  };

  try {
    // Host code runs inside this script's stack, so the watchdog covers it.
    vm.runInNewContext("run()", { run }, { timeout: TEST_TIMEOUT_MS });
  } catch (err) {
    const timedOut =
      err instanceof Error &&
      (err as NodeJS.ErrnoException).code === "ERR_SCRIPT_EXECUTION_TIMEOUT";
    lines.push(
      timedOut
        ? `  test run timed out after ${TEST_TIMEOUT_MS / 1000}s`
        : `  ${err instanceof Error ? err.message : String(err)}`,
    );
    failed += 1;
  }

  lines.push(`Tests: ${failed} failed, ${passed} passed`);
  return { passed: failed === 0 && passed > 0, output: lines.join("\n") };
}

/**
 * "./config.json" and "/config.json" mean config.json. Failing a model on
 * path spelling would grade form, not agentic ability.
 */
function normalizePath(path: string): string {
  return path.replace(/^\.\//, "").replace(/^\//, "");
}

export function executeTool(
  files: Workspace,
  name: string,
  argsJson: string,
  tools: ToolDef[] = WORKSPACE_TOOLS,
): string {
  if (!tools.some((t) => t.name === name)) {
    return `error: unknown tool "${name}" — available: ${tools.map((t) => t.name).join(", ")}`;
  }
  const parsed = tryParseJson(argsJson === "" ? "{}" : argsJson);
  if (!parsed.ok) return "error: arguments were not valid JSON";
  const args = (parsed.value ?? {}) as Record<string, unknown>;

  switch (name) {
    case "list_files":
      return Object.keys(files).sort().join("\n");

    case "read_file": {
      if (typeof args.path !== "string") {
        return 'error: missing required argument "path"';
      }
      const path = normalizePath(args.path);
      if (!(path in files)) {
        return `error: no such file "${path}" — use list_files to see what exists`;
      }
      return files[path]!;
    }

    case "write_file": {
      if (typeof args.path !== "string") {
        return 'error: missing required argument "path"';
      }
      if (typeof args.content !== "string") {
        return 'error: missing required argument "content" (must be a string)';
      }
      const path = normalizePath(args.path);
      files[path] = args.content;
      return `ok: wrote ${args.content.length} bytes to "${path}"`;
    }

    case "search": {
      if (typeof args.pattern !== "string" || args.pattern === "") {
        return 'error: missing required argument "pattern"';
      }
      const hits = Object.keys(files)
        .sort()
        .flatMap((path) =>
          files[path]!.split("\n").flatMap((line, i) =>
            line.includes(args.pattern as string)
              ? [`${path}:${i + 1}: ${line}`]
              : [],
          ),
        );
      return hits.length > 0 ? hits.slice(0, 50).join("\n") : "no matches";
    }

    case "edit_file": {
      if (typeof args.path !== "string") {
        return 'error: missing required argument "path"';
      }
      if (typeof args.old !== "string" || typeof args.new !== "string") {
        return 'error: "old" and "new" must both be strings';
      }
      const path = normalizePath(args.path);
      if (!(path in files)) return `error: no such file "${path}"`;
      const count =
        args.old === "" ? 0 : files[path]!.split(args.old).length - 1;
      if (count !== 1) {
        return count === 0
          ? `error: old text matched 0 times in "${path}" — it must match the file exactly, whitespace included`
          : `error: old text matched ${count} times in "${path}" — include more surrounding text so it matches once`;
      }
      files[path] = files[path]!.replace(args.old, () => args.new as string);
      return `ok: edited "${path}"`;
    }

    case "run_command": {
      if (typeof args.command !== "string") {
        return 'error: missing required argument "command"';
      }
      const command = normalizeCommand(args.command);
      if (TEST_COMMANDS.has(command)) return runTests(files).output;
      if (SHELL_FILE_OPS.test(command)) {
        return "error: no shell file access here — use list_files, read_file or search";
      }
      return "error: command not available in this sandbox — only `npm test` runs";
    }

    default:
      return `error: unknown tool "${name}"`;
  }
}
