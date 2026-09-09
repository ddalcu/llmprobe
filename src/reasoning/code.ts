import assert from "node:assert";
import vm from "node:vm";

import { visibleText } from "./grade";
import type { ReasoningCase } from "./types";

const TIMEOUT_MS = 3_000;

export interface ExtractedCode {
  code: string;
  /** Came from a closed fence, not a bare-text fallback. */
  anchored: boolean;
}

const FENCE = /```[^\n]*\n([\s\S]*?)```/g;

const defines = (code: string, name: string) =>
  new RegExp(`(function\\s*\\*?\\s*${name}\\b|\\b${name}\\s*=)`).test(code);

/** The last fenced block that defines the entry point, else the last fence, else the whole text. */
export function extractCode(text: string, entryPoint: string): ExtractedCode {
  const blocks = [...text.matchAll(FENCE)].map((m) => m[1]!.trim());
  if (blocks.length === 0) return { code: text.trim(), anchored: false };
  const defining = blocks.filter((b) => defines(b, entryPoint));
  const code = defining.length ? defining.at(-1)! : blocks.at(-1)!;
  return { code, anchored: true };
}

export interface CodeGrade {
  passed: boolean;
  /** "pass", or the first line of what went wrong. */
  got: string;
  anchored: boolean;
}

function run(source: string): string | null {
  const require = (id: string) => {
    if (id === "assert" || id === "node:assert") return assert;
    throw new Error(`require('${id}') is not available in the eval sandbox`);
  };
  const context = vm.createContext({
    require,
    console: { log() {}, error() {}, warn() {}, info() {} },
  });
  try {
    vm.runInContext(source, context, { timeout: TIMEOUT_MS });
    return null;
  } catch (err) {
    if (
      err instanceof Error &&
      (err as NodeJS.ErrnoException).code === "ERR_SCRIPT_EXECUTION_TIMEOUT"
    )
      return `timed out after ${TIMEOUT_MS / 1000}s`;
    const msg =
      err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return msg.split("\n")[0]!.slice(0, 160);
  }
}

export function gradeCode(tc: ReasoningCase, generated: string): CodeGrade {
  const { code, anchored } = extractCode(
    visibleText(generated),
    tc.entryPoint!,
  );
  // A model that answers with only the body is completing the prompt, so
  // finish it for them; the tests then decide, not the format.
  const source = defines(code, tc.entryPoint!) ? code : tc.question + code;
  const error = run(`${source}\n\n${tc.tests}`);
  return { passed: error === null, got: error ?? "pass", anchored };
}
