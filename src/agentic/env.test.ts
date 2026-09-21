import { describe, expect, test } from "vitest";

import {
  CODING_TOOLS,
  executeTool,
  runTests,
  WORKSPACE_TOOLS,
  type Workspace,
} from "./env";

const files = (): Workspace => ({
  "config.json": '{"port":8443}',
  "src/app.js": "code",
});

describe("workspace tools", () => {
  test("exposes exactly list, read and write", () => {
    expect(WORKSPACE_TOOLS.map((t) => t.name).sort()).toEqual([
      "list_files",
      "read_file",
      "write_file",
    ]);
  });

  test("list_files returns every path, sorted, one per line", () => {
    const out = executeTool(files(), "list_files", "{}");
    expect(out).toBe("config.json\nsrc/app.js");
  });

  test("read_file returns the file's contents verbatim", () => {
    const out = executeTool(files(), "read_file", '{"path":"config.json"}');
    expect(out).toBe('{"port":8443}');
  });

  test("read_file tolerates ./ and / path prefixes", () => {
    // Models routinely write "./config.json"; failing them on that would
    // grade path spelling, not agentic ability.
    const fs = files();
    expect(executeTool(fs, "read_file", '{"path":"./config.json"}')).toBe(
      '{"port":8443}',
    );
    expect(executeTool(fs, "read_file", '{"path":"/src/app.js"}')).toBe("code");
  });

  test("read_file on a missing path returns a recoverable error", () => {
    const out = executeTool(files(), "read_file", '{"path":"nope.txt"}');
    expect(out).toContain("no such file");
    expect(out).toContain("nope.txt");
  });

  test("write_file replaces the content and confirms", () => {
    const fs = files();
    const out = executeTool(
      fs,
      "write_file",
      JSON.stringify({ path: "config.json", content: '{"port":9090}' }),
    );
    expect(fs["config.json"]).toBe('{"port":9090}');
    expect(out).toContain("config.json");
    expect(out.toLowerCase()).toContain("ok");
  });

  test("write_file can create a new file", () => {
    const fs = files();
    executeTool(
      fs,
      "write_file",
      JSON.stringify({ path: "new.txt", content: "hello" }),
    );
    expect(fs["new.txt"]).toBe("hello");
  });

  test("an unknown tool name is an error string, not a crash", () => {
    const out = executeTool(files(), "delete_file", "{}");
    expect(out).toContain("unknown tool");
    expect(out).toContain("delete_file");
  });

  test("unparseable arguments are an error string, not a crash", () => {
    const out = executeTool(files(), "read_file", "{not json");
    expect(out.toLowerCase()).toContain("not valid json");
  });

  test("a missing required argument is a recoverable error", () => {
    expect(executeTool(files(), "read_file", "{}")).toContain("path");
    expect(executeTool(files(), "write_file", '{"path":"a.txt"}')).toContain(
      "content",
    );
  });
});

describe("coding tools", () => {
  const exec = (fs: Workspace, name: string, args: Record<string, unknown>) =>
    executeTool(fs, name, JSON.stringify(args), CODING_TOOLS);

  test("edit_file replaces exactly one match and refuses zero or several", () => {
    const fs: Workspace = { "a.js": "let x = 1;\nlet y = 1;\n" };
    expect(
      exec(fs, "edit_file", { path: "a.js", old: "= 2", new: "= 3" }),
    ).toMatch(/matched 0 times/);
    expect(
      exec(fs, "edit_file", { path: "a.js", old: "= 1", new: "= 3" }),
    ).toMatch(/matched 2 times/);
    expect(
      exec(fs, "edit_file", { path: "a.js", old: "x = 1", new: "x = 3" }),
    ).toMatch(/^ok/);
    expect(fs["a.js"]).toBe("let x = 3;\nlet y = 1;\n");
  });

  test("npm test runs the workspace tests through require, fail then pass", () => {
    const fs: Workspace = {
      "src/add.js": "module.exports = { add: (a, b) => a - b };\n",
      "test/add.test.js":
        'const assert = require("assert");\nconst { add } = require("../src/add");\ntest("adds", () => assert.strictEqual(add(2, 3), 5));\n',
    };
    const failed = exec(fs, "run_command", { command: "npm test" });
    expect(failed).toMatch(/FAIL test\/add\.test\.js/);
    expect(failed).toMatch(/-1 !== 5/);

    fs["src/add.js"] = "module.exports = { add: (a, b) => a + b };\n";
    expect(runTests(fs).passed).toBe(true);
  });

  test("a runaway loop in workspace code times out instead of hanging", () => {
    const fs: Workspace = {
      "test/loop.test.js": 'test("spins", () => { while (true) {} });\n',
    };
    const result = runTests(fs);
    expect(result.passed).toBe(false);
    expect(result.output).toMatch(/timed out/);
  });

  test("shell file access is refused with a pointer to the real tools", () => {
    expect(exec({}, "run_command", { command: "cat src/a.js" })).toMatch(
      /read_file/,
    );
  });

  test("the workspace-only toolset still refuses the coding tools", () => {
    expect(executeTool({}, "run_command", '{"command":"npm test"}')).toMatch(
      /unknown tool/,
    );
  });
});
