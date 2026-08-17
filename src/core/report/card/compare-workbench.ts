import type { JsonReport } from "../json";
import { normalizeJsonReport } from "../json";
import { CARD_STYLE } from "./style.css";
import { THEME_BOOT, THEME_SCRIPT, themeSwitcherHtml } from "./theme";
import { COMPARE_SCRIPT } from "./compare-script";
import { COMPARE_PICKER_STYLE } from "./compare-style";
import {
  CATEGORY_LABELS,
  catLabel,
  endpointLabel,
  esc,
  embedJson,
  mustFailures,
  runSlug,
  shortModel,
  tier,
} from "./shared";

const SERIES = ["#1f6feb", "#0d7a45", "#c98a00", "#9b59b6", "#e05a3c"];

export interface CompareWorkbenchInput {
  label: string;
  report: JsonReport;
  /** Relative or absolute path to the single-run HTML, if available. */
  href?: string | null;
  /** Source JSON path (for slug fallback). */
  file?: string;
  /** Run identity — must match the library's slug so ?a=/?b= links resolve. */
  slug?: string;
  /** When the run happened (ISO), for disambiguating repeat runs. */
  recordedAt?: string | null;
}

function compareEntry(input: CompareWorkbenchInput, index: number) {
  const r = normalizeJsonReport(input.report);
  const core = tier(r, "core");
  const ext = tier(r, "extended");
  const front = tier(r, "frontier");
  const confMeasured = (r.conformance?.total ?? 0) > 0;
  const capMeasured = (r.capability?.categories?.length ?? 0) > 0;
  // Identity is the run, not the model: the same model on two servers is
  // exactly the comparison this page exists for.
  const baseSlug =
    input.slug ??
    runSlug(
      r.target?.model || input.label || `run-${index + 1}`,
      r.target?.baseUrl,
    );
  const measured = (r.bench?.contextScaling ?? []).filter((p) => !p.note);
  return {
    slug: baseSlug,
    href: input.href ?? null,
    short: shortModel(r.target?.model ?? input.label),
    model: r.target?.model ?? input.label,
    engine: r.target?.engine ?? null,
    baseUrl: r.target?.baseUrl ?? null,
    host: endpointLabel(r.target?.baseUrl) || null,
    recordedAt: input.recordedAt ?? r.run?.startedAt ?? null,
    contextScaling: measured.map((p) => ({
      tokens: p.inputTokens ?? p.targetTokens,
      decode: p.decodeTokPerSec,
      ttft: p.ttftMs,
    })),
    core: core?.pct ?? null,
    extended: ext?.pct ?? null,
    frontier: front?.pct ?? null,
    missing: {
      core: core?.missing ?? [],
      extended: ext?.missing ?? [],
      frontier: front?.missing ?? [],
    },
    conformance: confMeasured ? r.conformance.pct : null,
    confPassed: confMeasured ? r.conformance.passed : null,
    confTotal: confMeasured ? r.conformance.total : null,
    bySurface: (r.conformance?.bySurface ?? []).map((s) => ({
      surface: s.surface,
      pct: s.pct,
      passed: s.passed,
      total: s.total,
    })),
    capability: capMeasured ? r.capability.pct : null,
    verdict: capMeasured ? r.capability.verdict : null,
    categories: (r.capability?.categories ?? []).map((c) => ({
      category: c.category,
      label: catLabel(c.category),
      pct: c.pct,
    })),
    agenticPassed: r.agentic?.passed ?? null,
    agenticTotal: r.agentic?.total ?? null,
    fidelity: r.fidelity?.pct ?? null,
    mustViolations: mustFailures(r).length,
  };
}

export interface CompareWorkbenchOptions {
  /** Link back to the model library index (default: index.html). */
  libraryHref?: string | null;
}

/**
 * Interactive compare workbench: blank columns, model dropdowns, sticky freeze header.
 */
export function renderCompareWorkbenchHtml(
  inputs: CompareWorkbenchInput[],
  options: CompareWorkbenchOptions = {},
): string {
  const catalog = inputs.map((input, i) => compareEntry(input, i));
  // Disambiguate duplicate slugs
  const seen = new Map<string, number>();
  for (const entry of catalog) {
    const n = (seen.get(entry.slug) ?? 0) + 1;
    seen.set(entry.slug, n);
    if (n > 1) entry.slug = `${entry.slug}-${n}`;
  }

  const libraryHref =
    options.libraryHref === null ? null : (options.libraryHref ?? "index.html");
  const libraryNav = libraryHref
    ? `<a class="btn" href="${esc(libraryHref)}">← Library</a>`
    : "";

  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>llmprobe · compare models</title>
<script>${THEME_BOOT}</script>
<style>${CARD_STYLE}</style>
<style>${COMPARE_PICKER_STYLE}</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div>
      <div class="brand">llmprobe compare</div>
      <h1 id="compare-title">Compare runs</h1>
      <div class="meta" id="compare-meta">
        <span>Select runs in each column</span>
        <span>${catalog.length} in library</span>
      </div>
    </div>
    <nav class="nav-links" aria-label="Compare navigation">
      ${libraryNav}
      ${themeSwitcherHtml()}
    </nav>
  </header>

  <div class="narrative" id="compare-narrative">
    <h2>What changed</h2>
    <p class="lead">Pick two to four runs to compare.</p>
    <ul>
      <li>Choose runs once at the top — columns stay aligned as you scroll.</li>
      <li>Scores stay independent: Coverage, Conformance, and Capability are never averaged.</li>
    </ul>
  </div>

  <div id="compare-pickers" class="compare-pickers" aria-label="Model pickers"></div>

  <div id="compare-sticky" class="compare-sticky" aria-hidden="true">
    <div id="compare-sticky-inner" class="compare-sticky-inner"></div>
  </div>

  <div id="compare-root"></div>

  <footer class="page">
    <span>Best/worst marked green/red per row only when at least two columns have a run</span>
    <span class="sep">·</span>
    <span>Never a blended overall score</span>
  </footer>
</div>
<script>window.__COMPARE__=${embedJson(catalog)};window.__CAT_LABELS__=${embedJson(CATEGORY_LABELS)};window.__SERIES__=${embedJson(SERIES)};</script>
<script>${COMPARE_SCRIPT}</script>
<script>${THEME_SCRIPT}</script>
</body>
</html>`;
}
