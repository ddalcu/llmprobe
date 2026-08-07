import type { JsonReport } from "../json";
import { normalizeJsonReport } from "../json";
import { CARD_STYLE } from "./style.css";
import { THEME_BOOT, THEME_SCRIPT, themeSwitcherHtml } from "./theme";
import { COMPARE_SCRIPT } from "./compare-script";
import { COMPARE_PICKER_STYLE } from "./compare-style";
import {
  CATEGORY_LABELS,
  catLabel,
  esc,
  embedJson,
  mustFailures,
  shortModel,
  slug,
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
}

function compareEntry(input: CompareWorkbenchInput, index: number) {
  const r = normalizeJsonReport(input.report);
  const core = tier(r, "core");
  const ext = tier(r, "extended");
  const front = tier(r, "frontier");
  const confMeasured = (r.conformance?.total ?? 0) > 0;
  const capMeasured = (r.capability?.categories?.length ?? 0) > 0;
  const baseSlug = slug(r.target?.model || input.label || `run-${index + 1}`);
  return {
    slug: baseSlug,
    href: input.href ?? null,
    short: shortModel(r.target?.model ?? input.label),
    model: r.target?.model ?? input.label,
    engine: r.target?.engine ?? null,
    baseUrl: r.target?.baseUrl ?? null,
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

/**
 * Interactive compare workbench: blank columns, model dropdowns, sticky freeze header.
 */
export function renderCompareWorkbenchHtml(
  inputs: CompareWorkbenchInput[],
): string {
  const catalog = inputs.map((input, i) => compareEntry(input, i));
  // Disambiguate duplicate slugs
  const seen = new Map<string, number>();
  for (const entry of catalog) {
    const n = (seen.get(entry.slug) ?? 0) + 1;
    seen.set(entry.slug, n);
    if (n > 1) entry.slug = `${entry.slug}-${n}`;
  }

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
      <h1 id="compare-title">Compare models</h1>
      <div class="meta" id="compare-meta">
        <span>Select models in each column</span>
        <span>${catalog.length} in library</span>
      </div>
    </div>
    <nav class="nav-links" aria-label="Compare navigation">
      ${themeSwitcherHtml()}
    </nav>
  </header>

  <div class="narrative" id="compare-narrative">
    <h2>What changed</h2>
    <p class="lead">Pick two models to compare.</p>
    <ul>
      <li>Choose models once at the top — columns stay aligned as you scroll.</li>
      <li>Scores stay independent: Coverage, Conformance, and Capability are never averaged.</li>
    </ul>
  </div>

  <div id="compare-pickers" class="compare-pickers" aria-label="Model pickers"></div>

  <div id="compare-sticky" class="compare-sticky" aria-hidden="true">
    <div id="compare-sticky-inner" class="compare-sticky-inner"></div>
  </div>

  <div id="compare-root"></div>

  <footer class="page">
    <span>Best/worst marked green/red per row only when both columns have a model</span>
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
