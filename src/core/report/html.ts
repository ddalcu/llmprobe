/**
 * Product HTML report entry point.
 *
 * Intent-based report cards (overview, drill-downs, themes) live in ./card/.
 * Chart.js helpers remain exported for bench comparison tooling.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import type { JsonReport } from "./json";
import {
  renderCardHtml,
  type CardHtmlOptions,
} from "./card/single";
import { esc as escShared, embedJson as embedJsonShared } from "./card/shared";

export { CARD_STYLE as STYLE } from "./card/style.css";

export function esc(s: string): string {
  return escShared(s);
}

export function embedJson(value: unknown): string {
  return embedJsonShared(value);
}

export function fmtTokensK(n: number): string {
  return n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n);
}

export function chartJsBundle(): string {
  const require = createRequire(import.meta.url);
  const path = join(dirname(require.resolve("chart.js")), "chart.umd.js");
  return readFileSync(path, "utf8").replace(/<\/script/g, "<\\/script");
}

export type HtmlRenderOptions = CardHtmlOptions;

/**
 * Self-contained HTML report card for one probe run.
 */
export function renderHtml(
  report: JsonReport,
  options: HtmlRenderOptions = {},
): string {
  return renderCardHtml(report, options);
}
