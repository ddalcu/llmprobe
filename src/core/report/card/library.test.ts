import {
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import type { JsonReport } from "../json";
import {
  ingestReportIntoLibrary,
  isLibraryDir,
  LibraryEmptyError,
  syncLibrary,
} from "./library";

function sample(model: string, baseUrl = "http://localhost/v1"): JsonReport {
  return {
    version: 2,
    target: { baseUrl, model, engine: "test" },
    coverage: {
      byTier: [
        {
          tier: "core",
          supported: 2,
          total: 2,
          pct: 100,
          missing: [],
          unprobed: [],
        },
      ],
      credits: [],
      entries: [],
    },
    conformance: {
      pct: 100,
      passed: 1,
      total: 1,
      bySurface: [{ surface: "chat", passed: 1, total: 1, pct: 100 }],
      results: [],
    },
    capability: {
      pct: 80,
      verdict: "capable",
      categories: [
        { category: "tool-selection", passed: 6, total: 6, pct: 100 },
      ],
      weakCategories: [],
      evals: [],
    },
    durationMs: 1000,
  };
}

describe("library auto-sync", () => {
  test("ingest + sync writes index, compare, cards, and library.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "llmprobe-lib-"));
    const a = ingestReportIntoLibrary(dir, sample("model-alpha"));
    expect(existsSync(a.jsonPath)).toBe(true);
    expect(existsSync(join(dir, "library.json"))).toBe(true);
    expect(existsSync(join(dir, "index.html"))).toBe(true);
    expect(existsSync(join(dir, "compare.html"))).toBe(true);
    expect(a.sync.runs).toBe(1);

    const b = ingestReportIntoLibrary(dir, sample("model-beta"));
    expect(b.sync.runs).toBe(2);

    const index = readFileSync(join(dir, "index.html"), "utf8");
    expect(index).toContain("__LIBRARY__");
    expect(index).toContain("model-alpha");
    expect(index).toContain("model-beta");
    expect(index).toContain("Quick compare");

    const compare = readFileSync(join(dir, "compare.html"), "utf8");
    expect(compare).toContain("compare-pickers");
    expect(compare).toContain("__COMPARE__");

    const card = readFileSync(a.sync.cardPaths[0]!, "utf8");
    expect(card).toContain('href="index.html"');
    expect(card).toContain("Surface coverage");
  });

  test("same model on two endpoints keeps both runs", () => {
    const dir = mkdtempSync(join(tmpdir(), "llmprobe-lib-"));
    const llama = ingestReportIntoLibrary(
      dir,
      sample("qwen3-30b", "http://localhost:8080/v1"),
    );
    const ollama = ingestReportIntoLibrary(
      dir,
      sample("qwen3-30b", "http://localhost:11434/v1"),
    );

    // Comparing engines on one model is the point of the library. Keying on
    // the model alone made the second probe silently overwrite the first.
    expect(ollama.jsonPath).not.toBe(llama.jsonPath);
    expect(existsSync(llama.jsonPath)).toBe(true);
    expect(ollama.sync.runs).toBe(2);

    const index = readFileSync(join(dir, "index.html"), "utf8");
    expect(index).toContain("localhost:8080");
    expect(index).toContain("localhost:11434");
  });

  test("re-probing the same endpoint updates in place", () => {
    const dir = mkdtempSync(join(tmpdir(), "llmprobe-lib-"));
    const first = ingestReportIntoLibrary(
      dir,
      sample("qwen3-30b", "http://localhost:8080/v1"),
    );
    const again = ingestReportIntoLibrary(
      dir,
      sample("qwen3-30b", "http://localhost:8080/v1"),
    );
    expect(again.jsonPath).toBe(first.jsonPath);
    expect(again.sync.runs).toBe(1);
  });

  test("syncLibrary rebuilds from existing JSON without re-ingest", () => {
    const dir = mkdtempSync(join(tmpdir(), "llmprobe-lib-"));
    writeFileSync(
      join(dir, "custom.json"),
      `${JSON.stringify(sample("custom-model"), null, 2)}\n`,
    );
    const result = syncLibrary(dir);
    expect(result.runs).toBe(1);
    expect(isLibraryDir(dir)).toBe(true);
  });

  test("adopts probe JSON from the parent directory when the library is empty", () => {
    const parent = mkdtempSync(join(tmpdir(), "llmprobe-parent-"));
    const lib = join(parent, "report-card");
    writeFileSync(
      join(parent, "sample-alpha.json"),
      `${JSON.stringify(sample("alpha-model"), null, 2)}\n`,
    );
    writeFileSync(
      join(parent, "sample-beta.json"),
      `${JSON.stringify(sample("beta-model"), null, 2)}\n`,
    );
    // Catalog junk in the library must not block discovery
    mkdirSync(lib, { recursive: true });
    writeFileSync(join(lib, "library.json"), '{"runs":[]}\n');
    writeFileSync(join(lib, "view-model.json"), '{"version":1}\n');

    const result = syncLibrary(lib);
    expect(result.runs).toBe(2);
    expect(existsSync(join(lib, "alpha-model--localhost.html"))).toBe(true);
    const index = readFileSync(join(lib, "index.html"), "utf8");
    expect(index).toContain("alpha-model");
    expect(index).toContain("beta-model");
  });

  test("the catalog carries each run's own timestamp, not the rebuild's", () => {
    const dir = mkdtempSync(join(tmpdir(), "llmprobe-date-"));

    const dated = sample("dated-model");
    dated.run = {
      depth: "default",
      mode: "probe",
      startedAt: "2026-01-02T03:04:05.000Z",
      phases: {
        coverage: { status: "measured" },
        conformance: { status: "measured" },
        capability: { status: "measured" },
        agentic: { status: "not-run" },
        fidelity: { status: "not-run" },
        performance: { status: "not-run" },
      },
    };
    writeFileSync(join(dir, "dated.json"), `${JSON.stringify(dated)}\n`);

    // A v1 save has no run block at all. It must fall back to when the file
    // was written — stamping it "now" would float every legacy run to the top
    // of a most-recent-first table on every rebuild.
    const legacy = sample("legacy-model");
    legacy.version = 1;
    delete legacy.run;
    const legacyPath = join(dir, "legacy.json");
    writeFileSync(legacyPath, `${JSON.stringify(legacy)}\n`);
    const legacyMtime = statSync(legacyPath).mtime.toISOString();

    syncLibrary(dir);
    const catalog = JSON.parse(
      readFileSync(join(dir, "library.json"), "utf8"),
    ) as { runs: Array<{ model: string; recordedAt: string }> };
    const byModel = (m: string) =>
      catalog.runs.find((r) => r.model === m)!.recordedAt;

    expect(byModel("dated-model")).toBe("2026-01-02T03:04:05.000Z");
    expect(byModel("legacy-model")).toBe(legacyMtime);
  });

  test("performance columns read null, not zero, when a run had no benchmark", () => {
    const dir = mkdtempSync(join(tmpdir(), "llmprobe-bench-"));

    const benched = sample("benched-model", "http://localhost:1/v1");
    benched.bench = {
      decodeTokPerSec: { median: 82.4, min: 80, max: 85, samples: [82.4] },
      streamCaveat: null,
      ttftMs: { median: 240, min: 220, max: 260, samples: [240] },
      prefillTokPerSec: { median: 1900, min: 1800, max: 2000, samples: [1900] },
      prefillPromptTokens: 2048,
      speculative: null,
      prefixCache: null,
      batching: null,
      loadDrift: null,
      machine: { platform: "darwin", arch: "arm64", cpu: null, memGB: 64 },
      contextScaling: null,
    };
    writeFileSync(join(dir, "benched.json"), `${JSON.stringify(benched)}\n`);
    writeFileSync(
      join(dir, "plain.json"),
      `${JSON.stringify(sample("plain-model", "http://localhost:2/v1"))}\n`,
    );

    syncLibrary(dir);
    const catalog = JSON.parse(
      readFileSync(join(dir, "library.json"), "utf8"),
    ) as {
      runs: Array<{
        model: string;
        decode: number | null;
        prefill: number | null;
        ttft: number | null;
      }>;
    };
    const row = (m: string) => catalog.runs.find((r) => r.model === m)!;

    expect(row("benched-model")).toMatchObject({
      decode: 82.4,
      prefill: 1900,
      ttft: 240,
    });
    // Zero would rank a never-benchmarked engine as the slowest one measured.
    expect(row("plain-model")).toMatchObject({
      decode: null,
      prefill: null,
      ttft: null,
    });
  });

  test("refuses to write an empty catalog", () => {
    const dir = mkdtempSync(join(tmpdir(), "llmprobe-empty-"));
    writeFileSync(join(dir, "library.json"), '{"runs":[]}\n');
    expect(() => syncLibrary(dir)).toThrow(LibraryEmptyError);
  });
});

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
