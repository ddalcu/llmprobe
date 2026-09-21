import { createHash } from "node:crypto";

import type { JsonReport } from "../../src/core/report/json";
import { normalizeJsonReport } from "../../src/core/report/json";
import { renderCardHtml } from "../../src/core/report/card/single";
import {
  isJsonReport,
  renderLibraryHtml,
  runLabel,
  type LibraryRun,
} from "../../src/core/report/card/library";
import { renderCompareWorkbenchHtml } from "../../src/core/report/card/compare-workbench";
import { runSlug } from "../../src/core/report/card/shared";

export interface StoredRun {
  key: string;
  data: unknown;
  createdAt: Date;
}

/** Slugs key compare links (`compare.html?a=`), so they come from the run's key, not list order. */
export function libraryRuns(rows: StoredRun[]): LibraryRun[] {
  return rows.flatMap(({ key, data, createdAt }) => {
    if (!isJsonReport(data)) return [];
    const recordedAt = data.run?.startedAt ?? createdAt.toISOString();
    const report = normalizeJsonReport(data);
    const hash = createHash("sha1").update(key).digest("hex").slice(0, 8);
    return [
      {
        slug: `${runSlug(report.target?.model, report.target?.baseUrl)}-${hash}`,
        label: runLabel(report),
        report,
        href: `card.html?key=${encodeURIComponent(key)}`,
        src: key,
        jsonName: key,
        recordedAt,
      },
    ];
  });
}

export const libraryPage = (runs: LibraryRun[]) =>
  renderLibraryHtml(runs, { dirLabel: "upload archive", hosted: true });

export const comparePage = (runs: LibraryRun[]) =>
  renderCompareWorkbenchHtml(
    runs.map((r) => ({
      label: r.label,
      report: r.report,
      href: r.href,
      slug: r.slug,
      recordedAt: r.recordedAt,
    })),
    { libraryHref: "index.html" },
  );

export const cardPage = (data: JsonReport) =>
  renderCardHtml(normalizeJsonReport(data), { libraryHref: "index.html" });
