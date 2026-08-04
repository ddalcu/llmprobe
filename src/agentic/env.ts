import type { ToolDef } from "../core/adapter";
import { tryParseJson } from "../core/assert";

/**
 * The simulated workspace: a handful of files in a plain object, three tools
 * to act on them. Executed in-process by llmprobe, so a "tool call" costs
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
): string {
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

    default:
      return `error: unknown tool "${name}" — available: list_files, read_file, write_file`;
  }
}
