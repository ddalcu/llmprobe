/**
 * @deprecated Removed as a standalone prototype.
 *
 * Report-card view models and HTML live in the product tree:
 *   src/core/report/card/
 *
 * Rebuild this library with:
 *   npm run build:cli && llmprobe --library runs/report-card
 *   # or: node runs/report-card/generate.mjs
 */
console.error(
  "view-model.mjs is deprecated. Use: llmprobe --library runs/report-card",
);
process.exit(1);
