import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import type { JsonReport } from "../json";
import { normalizeJsonReport } from "../json";
import { renderCardHtml } from "./single";
import { renderCompareWorkbenchHtml } from "./compare-workbench";
import { CARD_STYLE } from "./style.css";
import { THEME_BOOT, THEME_SCRIPT, themeSwitcherHtml } from "./theme";
import { LIBRARY_SCRIPT } from "./library-script";
import { esc, embedJson, shortModel, slug, tier } from "./shared";

/** Catalog / non-report artifacts that must never enter the ranking table. */
const SKIP_JSON = new Set([
  "library.json",
  "compare-model.json",
  "view-model.json",
]);

export class LibraryEmptyError extends Error {
  constructor(dir: string, detail?: string) {
    super(
      `no llmprobe --save reports found in ${dir}${detail ? ` (${detail})` : ""}. ` +
        `Put probe JSON saves in this directory (or its parent), then re-run ` +
        `\`llmprobe --library ${dir}\`.`,
    );
    this.name = "LibraryEmptyError";
  }
}

export interface LibraryRun {
  slug: string;
  label: string;
  report: JsonReport;
  href: string;
  src: string;
  jsonName: string;
}

export function isJsonReport(obj: unknown): obj is JsonReport {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as JsonReport;
  return Boolean(
    o.target &&
      (o.target.model || o.target.baseUrl) &&
      o.coverage &&
      Array.isArray(o.coverage.byTier),
  );
}

function listCandidateJsonFiles(dir: string): string[] {
  const absDir = resolve(dir);
  if (!existsSync(absDir) || !statSync(absDir).isDirectory()) return [];
  const found: string[] = [];
  for (const name of readdirSync(absDir)) {
    if (!name.endsWith(".json")) continue;
    if (SKIP_JSON.has(name)) continue;
    const abs = join(absDir, name);
    try {
      if (!statSync(abs).isFile()) continue;
    } catch {
      continue;
    }
    found.push(abs);
  }
  return found.sort();
}

function loadRunsFromFiles(
  files: string[],
  hrefDir: string,
): LibraryRun[] {
  const runs: LibraryRun[] = [];
  const usedSlugs = new Map<string, number>();
  const hrefRoot = resolve(hrefDir);

  for (const abs of files) {
    let report: JsonReport;
    try {
      report = JSON.parse(readFileSync(abs, "utf8")) as JsonReport;
    } catch {
      continue;
    }
    if (!isJsonReport(report)) continue;
    report = normalizeJsonReport(report);

    let s = slug(report.target?.model || basename(abs, ".json"));
    const n = (usedSlugs.get(s) ?? 0) + 1;
    usedSlugs.set(s, n);
    if (n > 1) s = `${s}-${n}`;

    // Cards always live next to the library index.
    const jsonName =
      resolve(dirname(abs)) === hrefRoot
        ? basename(abs)
        : `${s}.json`;

    runs.push({
      slug: s,
      label: shortModel(report.target?.model) || s,
      report,
      href: `${s}.html`,
      src: abs,
      jsonName,
    });
  }

  return runs;
}

/**
 * Discover valid --save reports for a library directory.
 *
 * Uses JSON files inside the library, and also adopts any *additional* probe
 * saves from the parent directory (prototype layout: saves in `runs/`, HTML in
 * `runs/report-card/`). Parent files are copied into the library when missing
 * so the next rebuild is self-contained.
 *
 * Identity for dedupe is `target.model` (then baseUrl+model).
 */
export function discoverLibraryRuns(
  dir: string,
  options: { adoptFromParent?: boolean } = {},
): LibraryRun[] {
  const absDir = resolve(dir);
  const adopt = options.adoptFromParent !== false;

  mkdirSync(absDir, { recursive: true });

  const identity = (r: LibraryRun): string =>
    `${r.report.target?.model ?? ""}@@${r.report.target?.baseUrl ?? ""}`;

  const present = new Set(
    loadRunsFromFiles(listCandidateJsonFiles(absDir), absDir).map(identity),
  );

  if (adopt) {
    const parent = dirname(absDir);
    if (parent && parent !== absDir) {
      const parentRuns = loadRunsFromFiles(
        listCandidateJsonFiles(parent),
        absDir,
      );
      for (const run of parentRuns) {
        const id = identity(run);
        if (present.has(id)) continue;
        const dest = join(absDir, run.jsonName);
        if (resolve(run.src) !== resolve(dest) && !existsSync(dest)) {
          copyFileSync(run.src, dest);
        }
        present.add(id);
      }
    }
  }

  return loadRunsFromFiles(listCandidateJsonFiles(absDir), absDir);
}

function runSummary(run: LibraryRun) {
  const r = run.report;
  const core = tier(r, "core");
  const ext = tier(r, "extended");
  const front = tier(r, "frontier");
  const confMeasured = (r.conformance?.total ?? 0) > 0;
  const capMeasured = (r.capability?.categories?.length ?? 0) > 0;
  return {
    slug: run.slug,
    href: run.href,
    model: r.target?.model ?? run.label,
    short: shortModel(r.target?.model ?? run.label),
    engine: r.target?.engine ?? null,
    baseUrl: r.target?.baseUrl ?? null,
    source: run.jsonName,
    core: core?.pct ?? null,
    extended: ext?.pct ?? null,
    frontier: front?.pct ?? null,
    conformance: confMeasured ? r.conformance.pct : null,
    capability: capMeasured ? r.capability.pct : null,
    verdict: capMeasured ? r.capability.verdict : null,
    agenticPassed: r.agentic?.passed ?? null,
    agenticTotal: r.agentic?.total ?? null,
    agenticRatio:
      r.agentic && r.agentic.total > 0
        ? r.agentic.passed / r.agentic.total
        : null,
    fidelity: r.fidelity?.pct ?? null,
  };
}

/** Ranking table + search + multi-select compare dock. */
export function renderLibraryHtml(runs: LibraryRun[]): string {
  const catalog = runs.map(runSummary);

  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>llmprobe · model library</title>
<script>${THEME_BOOT}</script>
<style>${CARD_STYLE}</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div>
      <div class="brand">llmprobe</div>
      <h1>Model library</h1>
      <div class="meta">
        <span id="library-count">${catalog.length} model${catalog.length === 1 ? "" : "s"}</span>
        <span>auto-synced from this directory</span>
        <span>scores stay independent</span>
      </div>
    </div>
    <nav class="nav-links">
      <a class="btn" href="index.html">Library</a>
      ${
        catalog.length >= 1
          ? `<a class="btn primary" href="compare.html">Quick compare</a>`
          : ""
      }
      ${themeSwitcherHtml()}
    </nav>
  </header>

  <div class="narrative">
    <h2>How to use this library</h2>
    <p class="lead">Rank models by any column. Open a full report, or pick two models to compare.</p>
    <ul>
      <li><strong>Surface coverage</strong> shows Core | Extended | Frontier (green ≥90%, yellow ≥70%, red below).</li>
      <li><strong>Conformance</strong> and <strong>Capability</strong> stay separate — never averaged into one score.</li>
      <li>Use <strong>Compare</strong> on two rows, then hit <strong>Compare models</strong> in the dock.</li>
    </ul>
  </div>

  <div class="library-toolbar">
    <div class="library-search" role="search">
      <label class="visually-hidden" for="model-search">Search models</label>
      <input
        id="model-search"
        type="search"
        placeholder="Search models…"
        autocomplete="off"
        spellcheck="false"
      />
      <button type="button" class="search-clear" id="search-clear" aria-label="Clear search">×</button>
    </div>
    <div class="sort-ctrl">
      <label for="sort-key">Sort by</label>
      <select id="sort-key">
        <option value="capability">Model capability</option>
        <option value="conformance">Engine conformance</option>
        <option value="coverage">Coverage (Core→Ext→Front)</option>
        <option value="core">Core coverage</option>
        <option value="extended">Extended coverage</option>
        <option value="frontier">Frontier coverage</option>
        <option value="agentic">Agentic</option>
        <option value="fidelity">Fidelity</option>
        <option value="model">Model name</option>
      </select>
      <select id="sort-dir">
        <option value="desc">High → low</option>
        <option value="asc">Low → high</option>
      </select>
    </div>
    <div class="library-count" id="filter-meta">Click column headers to sort · select up to 2 models to compare</div>
  </div>

  <div class="rank-wrap">
    <table class="rank-table" aria-label="Model rankings">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col" data-sort="model">Model <span class="sort-ind">↕</span></th>
          <th scope="col" data-sort="coverage" title="Core | Extended | Frontier">Surface coverage <span class="sort-ind">↕</span></th>
          <th scope="col" data-sort="conformance">Conformance <span class="sort-ind">↕</span></th>
          <th scope="col" data-sort="capability" class="active">Capability <span class="sort-ind">▼</span></th>
          <th scope="col" data-sort="agentic">Agentic <span class="sort-ind">↕</span></th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody id="rank-body"></tbody>
    </table>
  </div>

  <p class="fine" style="margin-top:4px">
    Auto-updates on <code>llmprobe … --library &lt;dir&gt;</code>, or when
    <code>--save</code>/<code>--html</code> write into a directory that already
    has <code>library.json</code>. Rebuild only:
    <code>llmprobe --library &lt;dir&gt;</code>.
  </p>
</div>

<div class="compare-dock" id="compare-dock" role="dialog" aria-label="Compare selection">
  <h3>Compare selection</h3>
  <div class="picks" id="compare-picks"></div>
  <div class="dock-actions">
    <button type="button" class="btn" id="compare-clear">Clear</button>
    <button type="button" class="btn primary" id="compare-go" disabled>Compare models</button>
  </div>
</div>

<script>window.__LIBRARY__=${embedJson(catalog)};</script>
<script>${LIBRARY_SCRIPT}</script>
<script>${THEME_SCRIPT}</script>
</body>
</html>`;
}

export interface SyncLibraryResult {
  dir: string;
  runs: number;
  indexPath: string;
  comparePath: string;
  cardPaths: string[];
}

/**
 * Rebuild library index, compare workbench, and per-model cards from JSON saves in `dir`.
 * Refuses to write an empty catalog (avoids wiping a good index).
 */
export function syncLibrary(dir: string): SyncLibraryResult {
  const absDir = resolve(dir);
  mkdirSync(absDir, { recursive: true });

  const runs = discoverLibraryRuns(absDir);
  if (runs.length === 0) {
    throw new LibraryEmptyError(
      absDir,
      "no valid probe JSON — catalogs like library.json / view-model.json are ignored",
    );
  }

  const cardPaths: string[] = [];

  for (const run of runs) {
    const cardPath = join(absDir, run.href);
    writeFileSync(
      cardPath,
      renderCardHtml(run.report, {
        label: run.jsonName,
        libraryHref: "index.html",
      }),
    );
    cardPaths.push(cardPath);
  }

  const indexPath = join(absDir, "index.html");
  writeFileSync(indexPath, renderLibraryHtml(runs));

  const comparePath = join(absDir, "compare.html");
  writeFileSync(
    comparePath,
    renderCompareWorkbenchHtml(
      runs.map((r) => ({
        label: r.label,
        report: r.report,
        href: r.href,
        file: r.src,
      })),
    ),
  );

  const catalogPath = join(absDir, "library.json");
  writeFileSync(
    catalogPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        runs: runs.map((r) => ({
          ...runSummary(r),
          sourcePath: r.src,
        })),
      },
      null,
      2,
    )}\n`,
  );

  return {
    dir: absDir,
    runs: runs.length,
    indexPath,
    comparePath,
    cardPaths,
  };
}

/**
 * Write (or overwrite) a report JSON into the library under a stable slug name,
 * then rebuild the library. Returns the slug used.
 */
export function ingestReportIntoLibrary(
  dir: string,
  report: JsonReport,
  options: { preferredFileName?: string } = {},
): { slug: string; jsonPath: string; sync: SyncLibraryResult } {
  const absDir = resolve(dir);
  mkdirSync(absDir, { recursive: true });
  const normalized = normalizeJsonReport(report);
  const s = slug(normalized.target?.model || "run");
  const jsonName = options.preferredFileName?.endsWith(".json")
    ? basename(options.preferredFileName)
    : `${s}.json`;
  const jsonPath = join(absDir, jsonName);
  writeFileSync(jsonPath, `${JSON.stringify(normalized, null, 2)}\n`);
  const sync = syncLibrary(absDir);
  return { slug: s, jsonPath, sync };
}

/** True when dir looks like an llmprobe library (has library.json). */
export function isLibraryDir(dir: string): boolean {
  try {
    return existsSync(join(resolve(dir), "library.json"));
  } catch {
    return false;
  }
}

/**
 * Infer a library directory from --save / --html paths when they already
 * point into an existing library, or when --library is set.
 */
export function resolveLibraryDir(options: {
  library?: string;
  save?: string;
  html?: string;
}): string | null {
  if (options.library) return resolve(options.library);

  for (const p of [options.save, options.html]) {
    if (!p) continue;
    const parent = resolve(p, "..");
    if (isLibraryDir(parent)) return parent;
  }
  return null;
}

