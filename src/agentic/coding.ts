import type { AgenticViolation } from "../core/outcome";
import { fail, type Graded, pass } from "../evals/grading";
import {
  CODING_TOOLS,
  normalizeCommand,
  runTests,
  SHELL_FILE_OPS,
  TEST_COMMANDS,
  type Workspace,
} from "./env";
import type { AgenticTaskDef } from "./index";

/**
 * Coding-agent trajectories: does the model call the right tools, with valid
 * arguments, in a sane order? The output barely matters — the final test run
 * is the only state check. What is graded is the trajectory, by rules rather
 * than a golden sequence, so any reasonable path passes.
 */

/** One executed tool call, as the rules see it. */
export interface CallRecord {
  /** Model request the call came from, 1-based. */
  step: number;
  /** How many scripted user turns preceded it. */
  round: number;
  name: string;
  args: Record<string, unknown> | null;
  /** Why the call does not fit its schema; null when it does. */
  invalid: string | null;
  output: string;
}

export interface Trajectory {
  calls: CallRecord[];
  initial: Workspace;
  files: Workspace;
  /** Scripted user turns sent after the prompt. */
  userTurns: string[];
  prompt: string;
}

export type Rule = (t: Trajectory) => AgenticViolation[];

const must = (rule: string, step: number | null, detail: string) =>
  ({ rule, severity: "must", step, detail }) as AgenticViolation;
const should = (rule: string, step: number | null, detail: string) =>
  ({ rule, severity: "should", step, detail }) as AgenticViolation;

const pathOf = (c: CallRecord): string | null =>
  typeof c.args?.path === "string"
    ? c.args.path.replace(/^\.\//, "").replace(/^\//, "")
    : null;
const isMutation = (c: CallRecord) =>
  (c.name === "edit_file" || c.name === "write_file") &&
  c.output.startsWith("ok");
const isTestRun = (c: CallRecord) =>
  c.name === "run_command" &&
  typeof c.args?.command === "string" &&
  TEST_COMMANDS.has(normalizeCommand(c.args.command));

/** Every coding task: syntax, shell misuse, loops, blind paths, clobbering. */
const GENERIC: Rule[] = [
  (t) =>
    t.calls
      .filter((c) => c.invalid !== null)
      .map((c) => must("invalid-call", c.step, `${c.name}: ${c.invalid}`)),
  (t) =>
    t.calls
      .filter(
        (c) =>
          c.name === "run_command" &&
          typeof c.args?.command === "string" &&
          SHELL_FILE_OPS.test(normalizeCommand(c.args.command)),
      )
      .map((c) =>
        should(
          "shell-file-ops",
          c.step,
          `ran "${c.args!.command}" instead of the file tools`,
        ),
      ),
  (t) =>
    t.calls.flatMap((c, i) => {
      const key = (x: CallRecord) => `${x.name}:${JSON.stringify(x.args)}`;
      const prev = t.calls.slice(Math.max(0, i - 2), i);
      return prev.length === 2 &&
        prev.every((p) => key(p) === key(c)) &&
        key(t.calls[i - 3] ?? ({} as CallRecord)) !== key(c)
        ? [should("repeated-call", c.step, `${c.name} called 3× in a row`)]
        : [];
    }),
  (t) =>
    t.calls.flatMap((c, i) => {
      const path = pathOf(c);
      if (c.name !== "read_file" && c.name !== "edit_file") return [];
      if (path === null) return [];
      const seen = [
        t.prompt,
        ...t.userTurns,
        ...t.calls.slice(0, i).map((p) => p.output),
      ];
      // The stem counts: `require("../src/cart")` names src/cart.js.
      const stem = path
        .split("/")
        .pop()!
        .replace(/\.[^.]+$/, "");
      return seen.some((s) => s.includes(path) || s.includes(stem))
        ? []
        : [should("unseen-path", c.step, `guessed path "${path}"`)];
    }),
  (t) =>
    t.calls.flatMap((c, i) => {
      const path = pathOf(c);
      if (!isMutation(c) || path === null || !(path in t.initial)) return [];
      const read = t.calls
        .slice(0, i)
        .some((p) => p.name === "read_file" && pathOf(p) === path);
      const violations: AgenticViolation[] = [];
      if (!read)
        violations.push(
          should("edit-unread", c.step, `changed ${path} without reading it`),
        );
      if (c.name === "write_file")
        violations.push(
          should(
            "whole-file-rewrite",
            c.step,
            `rewrote all of ${path} instead of edit_file`,
          ),
        );
      return violations;
    }),
];

const protect =
  (...paths: string[]): Rule =>
  (t) =>
    paths
      .filter((p) => t.files[p] !== t.initial[p])
      .map((p) => {
        const step =
          t.calls.find((c) => isMutation(c) && pathOf(c) === p)?.step ?? null;
        return must(
          "protected-file",
          step,
          `changed ${p}, which was off limits`,
        );
      });

const testsAfterLastEdit: Rule = (t) => {
  const last = t.calls.map(isMutation).lastIndexOf(true);
  if (last === -1) return [];
  return t.calls.slice(last + 1).some(isTestRun)
    ? []
    : [must("untested-edit", null, "never ran the tests after the last edit")];
};

const testsBeforeFirstEdit: Rule = (t) => {
  const first = t.calls.findIndex(isMutation);
  if (first === -1) return [];
  return t.calls.slice(0, first).some(isTestRun)
    ? []
    : [
        must(
          "edit-before-tests",
          t.calls[first]!.step,
          "edited before running the tests to see what fails",
        ),
      ];
};

const noChanges: Rule = (t) =>
  t.calls
    .filter(isMutation)
    .map((c) =>
      must(
        "no-changes",
        c.step,
        `changed ${pathOf(c)} on a task that was already done`,
      ),
    );

const searchBeforeRenameEdit: Rule = (t) => {
  const renaming = t.calls.filter((c) => c.round >= 1);
  const first = renaming.findIndex(isMutation);
  if (first === -1) return [];
  return renaming.slice(0, first).some((c) => c.name === "search")
    ? []
    : [
        should(
          "no-search",
          renaming[first]!.step,
          "started renaming without searching for the usages",
        ),
      ];
};

const NUDGE = "is still referenced in";
const neededNudge: Rule = (t) =>
  t.userTurns.some((u) => u.includes(NUDGE))
    ? [should("needed-nudge", null, "said DONE with the rename unfinished")]
    : [];

const batchedReads =
  (paths: string[]): Rule =>
  (t) => {
    const reads = t.calls.filter(
      (c) => c.name === "read_file" && paths.includes(pathOf(c) ?? ""),
    );
    if (reads.length < 2) return [];
    return new Set(reads.map((c) => c.step)).size === 1
      ? []
      : [
          should(
            "serial-reads",
            reads[1]!.step,
            `read ${reads.length} independent files one request at a time`,
          ),
        ];
  };

const testsPass = (files: Workspace, extra: Workspace = {}): Graded => {
  const run = runTests({ ...files, ...extra });
  if (run.passed) return pass();
  const why = run.output
    .split("\n")
    .find((l) => l.startsWith("    ") || l.startsWith("  test run"));
  return fail(`tests fail at the end${why ? `: ${why.trim()}` : ""}`);
};

const TEST_PKG = `{\n  "name": "demo",\n  "scripts": { "test": "node run-tests.js" }\n}\n`;

export const CODING_TASKS: AgenticTaskDef[] = [
  {
    id: "coding-fix-failing-test",
    name: "fixes a failing test in the source, not the test",
    prompt:
      "You are working in a small JavaScript project. Running `npm test` " +
      "fails. Fix the bug in the source code, not in the tests. Reply DONE " +
      "when the tests pass.",
    tools: CODING_TOOLS,
    files: {
      "package.json": TEST_PKG,
      "README.md": "# cart\n\nShopping cart totals.\n",
      // Tab-indented: a model that types spaces into edit_file.old gets an
      // error, and recovering from it is part of the task.
      "src/cart.js":
        "function total(items, discountPct) {\n\tconst sum = items.reduce((acc, item) => acc + item.price * item.qty, 0);\n\treturn sum - discountPct;\n}\n\nmodule.exports = { total };\n",
      "test/cart.test.js":
        'const assert = require("assert");\nconst { total } = require("../src/cart");\n\ntest("sums price times quantity", () => {\n  assert.strictEqual(total([{ price: 10, qty: 2 }, { price: 5, qty: 1 }], 0), 25);\n});\n\ntest("applies a percent discount", () => {\n  assert.strictEqual(total([{ price: 50, qty: 2 }], 10), 90);\n});\n',
    },
    maxSteps: 12,
    rules: [...GENERIC, protect("test/cart.test.js"), testsAfterLastEdit],
    grade: (files) => testsPass(files),
  },
  {
    id: "coding-extend-then-rename",
    name: "adds a function, then renames across files on request",
    prompt:
      "You are working in a small JavaScript project. Add a function " +
      "`getInitials(user)` to src/user.js that returns the uppercase initials " +
      'of the first and last name (Ada Lovelace → "AL"), and export it. Reply ' +
      "DONE when finished.",
    tools: CODING_TOOLS,
    files: {
      "package.json": TEST_PKG,
      // The trap: history mentions the old name and must stay as written.
      "CHANGELOG.md": "## 1.2.0\n\n- Added the getUserName helper.\n",
      "src/user.js":
        "function getUserName(user) {\n  return `${user.first} ${user.last}`;\n}\n\nmodule.exports = { getUserName };\n",
      "src/greet.js":
        'const { getUserName } = require("./user");\n\nfunction greet(user) {\n  return `Hello, ${getUserName(user)}!`;\n}\n\nmodule.exports = { greet };\n',
      "src/profile.js":
        'const { getUserName } = require("./user");\n\nfunction profileHeader(user) {\n  return getUserName(user).toUpperCase();\n}\n\nmodule.exports = { profileHeader };\n',
      "test/user.test.js":
        'const assert = require("assert");\nconst { greet } = require("../src/greet");\nconst { profileHeader } = require("../src/profile");\n\nconst ada = { first: "Ada", last: "Lovelace" };\n\ntest("greets by full name", () => {\n  assert.strictEqual(greet(ada), "Hello, Ada Lovelace!");\n});\n\ntest("profile header is upper case", () => {\n  assert.strictEqual(profileHeader(ada), "ADA LOVELACE");\n});\n',
    },
    maxSteps: 20,
    followUp(files, round) {
      if (round === 0)
        return (
          "Thanks. Now rename `getUserName` to `getDisplayName` everywhere it " +
          "is used in the code. Keep the tests passing. Reply DONE when finished."
        );
      if (round === 1) {
        const left = Object.keys(files)
          .sort()
          .find(
            (p) => /^(src|test)\//.test(p) && files[p]!.includes("getUserName"),
          );
        if (left)
          return `\`getUserName\` ${NUDGE} ${left}. Please finish the rename.`;
      }
      return null;
    },
    rules: [
      ...GENERIC,
      protect("CHANGELOG.md"),
      testsAfterLastEdit,
      searchBeforeRenameEdit,
      neededNudge,
    ],
    grade(files) {
      const left = Object.keys(files).filter(
        (p) => /^(src|test)\//.test(p) && files[p]!.includes("getUserName"),
      );
      if (left.length > 0)
        return fail(`getUserName still used in ${left.join(", ")}`);
      return testsPass(files, {
        "test/zz-hidden.test.js":
          'const assert = require("assert");\nconst user = require("../src/user");\ntest("initials", () => assert.strictEqual(user.getInitials({ first: "Ada", last: "Lovelace" }), "AL"));\ntest("renamed", () => assert.strictEqual(typeof user.getDisplayName, "function"));\n',
      });
    },
  },
  {
    id: "coding-follow-test-output",
    name: "lets the failing test point at the file to change",
    prompt:
      "You are working in a small JavaScript project. Production requests " +
      "time out too late: the timeout must be 10 seconds. Fix it and make " +
      "sure `npm test` passes. Reply DONE when finished.",
    tools: CODING_TOOLS,
    files: {
      "package.json": TEST_PKG,
      // The trap: the file a model edits when it guesses by name.
      "src/defaults.js": "module.exports = { timeoutMs: 5000, retries: 2 };\n",
      "config/production.json": '{\n  "timeoutMs": 30000,\n  "retries": 3\n}\n',
      "src/client.js":
        'const defaults = require("./defaults");\nconst production = require("../config/production.json");\n\nfunction clientOptions() {\n  return { ...defaults, ...production };\n}\n\nmodule.exports = { clientOptions };\n',
      "test/client.test.js":
        'const assert = require("assert");\nconst { clientOptions } = require("../src/client");\n\ntest("production timeout is 10 seconds", () => {\n  const { timeoutMs } = clientOptions();\n  assert.strictEqual(timeoutMs, 10000, `expected 10000, got ${timeoutMs} (config/production.json overrides src/defaults.js)`);\n});\n',
    },
    maxSteps: 12,
    rules: [
      ...GENERIC,
      protect("src/defaults.js", "test/client.test.js"),
      testsBeforeFirstEdit,
      testsAfterLastEdit,
    ],
    grade: (files) => testsPass(files),
  },
  {
    id: "coding-already-done",
    name: "checks, finds nothing to do, and stops",
    prompt:
      "You are working in a small JavaScript project. Make sure `slugify` in " +
      'src/slug.js handles uppercase letters ("Hello World" → "hello-world"). ' +
      "Reply DONE when it does.",
    tools: CODING_TOOLS,
    files: {
      "package.json": TEST_PKG,
      "src/slug.js":
        'function slugify(text) {\n  return text\n    .trim()\n    .toLowerCase()\n    .replace(/[^a-z0-9]+/g, "-")\n    .replace(/^-|-$/g, "");\n}\n\nmodule.exports = { slugify };\n',
      "test/slug.test.js":
        'const assert = require("assert");\nconst { slugify } = require("../src/slug");\n\ntest("lower-cases and dashes", () => {\n  assert.strictEqual(slugify("Hello World"), "hello-world");\n});\n',
    },
    maxSteps: 6,
    rules: [...GENERIC, noChanges],
    grade: (files) => testsPass(files),
  },
  {
    id: "coding-parallel-reads",
    name: "finds which file exports a function",
    prompt:
      "You are working in a small JavaScript project. Which one of src/a.js, " +
      "src/b.js and src/c.js exports a function called `parseDate`? Reply " +
      "with just the path.",
    tools: CODING_TOOLS,
    files: {
      "src/a.js":
        "function formatDate(d) {\n  return d.toISOString().slice(0, 10);\n}\n\nmodule.exports = { formatDate };\n",
      "src/b.js":
        "function parseDate(s) {\n  return new Date(`${s}T00:00:00Z`);\n}\n\nmodule.exports = { parseDate };\n",
      // The trap: uses parseDate without exporting it.
      "src/c.js":
        'const { parseDate } = require("./b");\n\nfunction daysBetween(a, b) {\n  return (parseDate(b) - parseDate(a)) / 86400000;\n}\n\nmodule.exports = { daysBetween };\n',
    },
    maxSteps: 8,
    rules: [...GENERIC, batchedReads(["src/a.js", "src/b.js", "src/c.js"])],
    grade(_files, finalText) {
      const named = ["a", "b", "c"].filter((f) =>
        new RegExp(`\\b${f}\\.js\\b`).test(finalText),
      );
      return named.length === 1 && named[0] === "b"
        ? pass()
        : fail(`answered "${finalText.slice(0, 60)}" instead of src/b.js`);
    },
  },
];
