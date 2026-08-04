import { describe, expect, test } from "vitest";

import { executeTool, WORKSPACE_TOOLS, type Workspace } from "./env";

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
