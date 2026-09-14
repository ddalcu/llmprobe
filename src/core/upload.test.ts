import { describe, expect, it } from "vitest";
import { resolveUploadUrl, uploadPayload } from "./upload";
import type { JsonReport } from "./report/json";

const machine = { platform: "darwin", arch: "arm64", cpu: "M3", memGB: 36 };

const report = (bench: unknown): JsonReport =>
  ({
    version: 2,
    run: { startedAt: "2026-09-09T10:00:00.000Z" },
    target: { baseUrl: "http://localhost:8080", model: "qwen3", engine: "llama.cpp" },
    machine,
    bench,
  }) as unknown as JsonReport;

describe("resolveUploadUrl", () => {
  it("prefers the flag value", () => {
    expect(resolveUploadUrl("http://flag", "http://env")).toBe("http://flag");
  });

  it("falls back to the env var, then to localhost", () => {
    expect(resolveUploadUrl(undefined, "http://env")).toBe("http://env");
    expect(resolveUploadUrl(undefined, undefined)).toBe("http://localhost:3000");
  });

  it("strips a trailing slash", () => {
    expect(resolveUploadUrl("http://flag/", undefined)).toBe("http://flag");
  });
});

describe("uploadPayload", () => {
  it("keys on model, engine, endpoint and start time", () => {
    const payload = uploadPayload(report({ decodeTokPerSec: { median: 42 } }));
    expect(payload.key).toBe(
      "llama.cpp|qwen3|http://localhost:8080|2026-09-09T10:00:00.000Z",
    );
    expect(payload.data.machine).toEqual(machine);
  });

  it("refuses a run with no benchmark", () => {
    expect(() => uploadPayload(report(undefined))).toThrow(/--no-bench/);
  });
});
