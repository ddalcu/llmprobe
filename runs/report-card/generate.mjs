#!/usr/bin/env node
/**
 * Thin wrapper — the product CLI owns report cards and library sync.
 *
 *   node runs/report-card/generate.mjs
 *   node runs/report-card/generate.mjs /path/to/library-dir
 *
 * Equivalent to:
 *   llmprobe --library runs/report-card
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const libraryDir = resolve(process.argv[2] || __dirname);
const cli = join(repoRoot, "bin/dist/llmprobe.mjs");

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!existsSync(cli)) {
  fail(
    `Product CLI not built: ${cli}\n` +
      `Run: npm run build:cli\n` +
      `Then: llmprobe --library ${libraryDir}`,
  );
}

console.log(`Rebuilding library via product CLI → ${libraryDir}`);
const result = spawnSync(process.execPath, [cli, "--library", libraryDir], {
  cwd: repoRoot,
  stdio: "inherit",
});

process.exit(result.status === null ? 1 : result.status);
