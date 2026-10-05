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

describe("workload benchmark CLI", () => {
  test.each([
    ["--decode-tokens", "1024"],
    ["--long-decode", "--decode-window", "1.5"],
    ["--long-decode", "--decode-tokens", "0"],
    ["--long-decode", "--concurrency", "2"],
    ["--long-decode", "--eval"],
    ["--long-decode", "--no-bench"],
    ["--session-base", "30000"],
    ["--agent-session", "--runs", "2"],
    ["--agent-session", "--long-decode"],
    ["--agent-session", "--session-base", "2000", "--session-target", "1000"],
    ["--agent-session", "--concurrency", "2"],
  ])("rejects invalid settings %j", (...args) => {
    const result = spawnSync(process.execPath, [cli, "localhost:1", ...args], {
      cwd,
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/needs|require|incompatible|must exceed/);
  });

  test("agent session CLI leaves scored phases unrun and reaches measured context", async () => {
    engine = await startMockEngine({
      promptCache: true,
      longDecode: { maxOutputTokens: 64, frameDelayMs: 3 },
    });
    const output = await new Promise<string>((resolve, reject) =>
      execFile(
        process.execPath,
        [
          cli,
          engine!.url,
          "--model",
          "mock-model-12b",
          "--agent-session",
          "--session-base",
          "512",
          "--session-target",
          "5000",
          "--decode-window",
          "16",
          "--prefix-seed",
          "cli-session",
          "--reasoning",
          "off",
          "--no-save",
          "--json",
        ],
        { cwd },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      ),
    );
    const report = JSON.parse(output);
    expect(report.bench.agentSession.stop).toBe("target");
    expect(report.bench.agentSession.prefixSeed).toBe("cli-session");
    expect(report.run.phases.conformance.status).toBe("not-run");
    expect(report.bench.longDecode).toBeUndefined();
  });

  test("an unfinished session records partial performance rather than target success", async () => {
    engine = await startMockEngine({
      longDecode: { maxOutputTokens: 32, frameDelayMs: 3 },
    });
    const output = await new Promise<string>((resolve, reject) =>
      execFile(
        process.execPath,
        [
          cli,
          engine!.url,
          "--model",
          "mock-model-12b",
          "--agent-session",
          "--session-base",
          "512",
          "--session-target",
          "5000",
          "--session-max-turns",
          "1",
          "--no-save",
          "--json",
        ],
        { cwd },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      ),
    );
    const report = JSON.parse(output);
    expect(report.bench.agentSession.stop).toBe("turn-limit");
    expect(report.run.phases.performance.status).toBe("partial");
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
