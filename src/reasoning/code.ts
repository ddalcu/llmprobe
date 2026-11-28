import assert from "node:assert";
import vm from "node:vm";

import { visibleText } from "./grade";
import type { ReasoningCase } from "./types";

const TIMEOUT_MS = 3_000;
/**
 * MultiPL-E ports Python arbitrary-precision integer assertions directly into
 * unquoted JS number literals (e.g. mbpp_67_bell_number's 55-digit B(56)),
 * which V8 rounds to float64 at parse time while valid Number DP recurrences
 * drift by 1–2 ULPs and valid BigInt solutions fail node:assert's typeof check.
 */
const UNSAFE_INT_REL_TOL = 8 * Number.EPSILON;

function matchesUnsafeIntLiteral(actual: unknown, expected: unknown): boolean {
  if (typeof expected !== "number" || !Number.isFinite(expected)) return false;
  if (typeof actual === "bigint") {
    if (Number.isSafeInteger(expected)) return actual === BigInt(expected);
    return (
      Math.abs(expected) > Number.MAX_SAFE_INTEGER &&
      Number(actual) === expected
    );
  }
  return (
    typeof actual === "number" &&
    Number.isFinite(actual) &&
    Math.abs(expected) > Number.MAX_SAFE_INTEGER &&
    Math.abs(actual - expected) <= UNSAFE_INT_REL_TOL * Math.abs(expected)
  );
}

function normalizeUnsafeIntExpected(
  actual: unknown,
  expected: unknown,
): unknown {
  if (matchesUnsafeIntLiteral(actual, expected)) return expected;
  if (
    Array.isArray(actual) &&
    Array.isArray(expected) &&
    actual.length === expected.length
  ) {
    let changed = false;
    const mapped = actual.map((item, i) => {
      const next = normalizeUnsafeIntExpected(item, expected[i]);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? mapped : actual;
  }
  return actual;
}

const sandboxAssert = Object.assign(
  (...args: Parameters<typeof assert>) => assert(...args),
  assert,
  {
    deepEqual(
      actual: unknown,
      expected: unknown,
      ...rest: [string, ...unknown[]] | [Error] | []
    ) {
      const normalized = normalizeUnsafeIntExpected(actual, expected);
      if (rest.length === 0) {
        assert.deepEqual(normalized, expected);
      } else if (typeof rest[0] === "string") {
        assert.deepEqual(normalized, expected, rest[0], ...rest.slice(1));
      } else {
        assert.deepEqual(normalized, expected, rest[0]);
      }
    },
  },
);

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
    if (id === "assert" || id === "node:assert") return sandboxAssert;
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
