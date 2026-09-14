import { describe, expect, it } from "vitest";
import { hardwareLabel, summarize } from "./summary";

const full = {
  target: { model: "qwen3-30b", engine: "llama.cpp", baseUrl: "http://h:8080" },
  machine: {
    platform: "darwin",
    arch: "arm64",
    cpu: "Apple M3 Max",
    memGB: 36,
  },
  run: { startedAt: "2026-09-09T10:00:00.000Z", label: "kv8" },
  coverage: {
    byTier: [
      { tier: "core", pct: 90 },
      { tier: "extended", pct: 20 },
    ],
  },
  conformance: { pct: 88 },
  capability: { pct: 71, verdict: "capable" },
  bench: {
    decodeTokPerSec: { median: 42.5 },
    prefillTokPerSec: { median: 900 },
    ttftMs: { median: 120 },
  },
};

describe("hardwareLabel", () => {
  it("joins cpu, memory and platform", () => {
    expect(hardwareLabel(full.machine)).toBe(
      "Apple M3 Max · 36GB · darwin/arm64",
    );
  });

  it("falls back when the machine is missing", () => {
    expect(hardwareLabel(undefined)).toBe("unknown");
  });
});

describe("summarize", () => {
  it("projects the fields the table shows", () => {
    expect(summarize("k1", full)).toEqual({
      key: "k1",
      model: "qwen3-30b",
      engine: "llama.cpp",
      hardware: "Apple M3 Max · 36GB · darwin/arm64",
      label: "kv8",
      startedAt: "2026-09-09T10:00:00.000Z",
      coverage: 90,
      conformance: 88,
      capability: 71,
      verdict: "capable",
      decodeTokPerSec: 42.5,
      prefillTokPerSec: 900,
      ttftMs: 120,
    });
  });

  it("nulls every number a sparse report does not carry", () => {
    const sparse = { target: { model: "m" } };
    expect(summarize("k2", sparse)).toMatchObject({
      engine: null,
      hardware: "unknown",
      coverage: null,
      decodeTokPerSec: null,
      ttftMs: null,
    });
  });
});
