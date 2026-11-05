import { execFile, execFileSync, spawnSync } from "node:child_process";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { type MockEngine, startMockEngine } from "../src/fixtures/mock-engine";

const cwd = process.cwd();
const cli = "bin/dist/llmprobe.mjs";
let engine: MockEngine | undefined;
afterEach(() => engine?.stop());
beforeAll(() =>
  execFileSync("npm", ["run", "build:cli"], { cwd, stdio: "pipe" }),
);

describe("long-decode CLI", () => {
  test.each([
    ["--decode-tokens", "1024"],
    ["--long-decode", "--decode-window", "1.5"],
    ["--long-decode", "--decode-tokens", "0"],
    ["--long-decode", "--concurrency", "2"],
    ["--long-decode", "--eval"],
    ["--long-decode", "--no-bench"],
  ])("rejects invalid settings %j", (...args) => {
    const result = spawnSync(process.execPath, [cli, "localhost:1", ...args], {
      cwd,
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/needs|require|incompatible/);
  });

  test("runs only long decode, saves window data in JSON, leaves scored phases unrun", async () => {
    engine = await startMockEngine({
      promptCache: true,
      longDecode: { frameDelayMs: 3 },
    });
    const report = await new Promise<string>((resolve, reject) => {
      execFile(
        process.execPath,
        [
          cli,
          engine!.url,
          "--model",
          "mock-model-12b",
          "--long-decode",
          "--decode-context",
          "512",
          "--decode-tokens",
          "128",
          "--decode-window",
          "32",
          "--runs",
          "1",
          "--prefix-seed",
          "cli-test",
          "--reasoning",
          "off",
          "--no-save",
          "--json",
        ],
        { cwd },
        (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        },
      );
    });
    const parsed = JSON.parse(report);
    expect(parsed.bench.longDecode.prefixSeed).toBe("cli-test");
    expect(parsed.bench.longDecode.workloads).toHaveLength(3);
    expect(
      parsed.bench.longDecode.workloads[0].samples[0].summary.completeWindows,
    ).toBeGreaterThan(1);
    expect(parsed.run.phases.conformance.status).toBe("not-run");
    expect(parsed.bench.contextScaling).toBeNull();
  });
});
