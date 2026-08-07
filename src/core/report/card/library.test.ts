import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import type { JsonReport } from "../json";
import {
  ingestReportIntoLibrary,
  isLibraryDir,
  libraryIndexHrefFrom,
  LibraryEmptyError,
  resolveLibraryDir,
  syncLibrary,
} from "./library";

function sample(model: string): JsonReport {
  return {
    version: 2,
    target: { baseUrl: "http://localhost/v1", model, engine: "test" },
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

  test("resolveLibraryDir prefers --library then existing library parents", () => {
    const dir = mkdtempSync(join(tmpdir(), "llmprobe-lib-"));
    writeFileSync(join(dir, "library.json"), "{}\n");
    expect(
      resolveLibraryDir({
        library: dir,
        save: "/tmp/other/x.json",
      }),
    ).toBe(resolve(dir));
    expect(
      resolveLibraryDir({
        save: join(dir, "m.json"),
      }),
    ).toBe(resolve(dir));
    expect(resolveLibraryDir({ save: "/tmp/no-lib/m.json" })).toBeNull();
  });

  test("resolveLibraryDir auto-creates report-card beside --html", () => {
    expect(resolveLibraryDir({ html: "runs/my-run-1.html" })).toBe(
      resolve("runs/report-card"),
    );
    expect(resolveLibraryDir({ html: "/tmp/out/report-card/model.html" })).toBe(
      resolve("/tmp/out/report-card"),
    );
  });

  test("libraryIndexHrefFrom is relative so ← Library works from sibling cards", () => {
    expect(libraryIndexHrefFrom("runs/my-run-1.html", "runs/report-card")).toBe(
      "report-card/index.html",
    );
    expect(
      libraryIndexHrefFrom("runs/report-card/model.html", "runs/report-card"),
    ).toBe("index.html");
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
    expect(
      existsSync(join(lib, "alpha-model.json")) ||
        existsSync(join(lib, "alpha-model.html")),
    ).toBe(true);
    const index = readFileSync(join(lib, "index.html"), "utf8");
    expect(index).toContain("alpha-model");
    expect(index).toContain("beta-model");
  });

  test("refuses to write an empty catalog", () => {
    const dir = mkdtempSync(join(tmpdir(), "llmprobe-empty-"));
    writeFileSync(join(dir, "library.json"), '{"runs":[]}\n');
    expect(() => syncLibrary(dir)).toThrow(LibraryEmptyError);
  });
});

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
