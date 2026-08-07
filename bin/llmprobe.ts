#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import {
  ADAPTERS,
  buildConformanceTests,
  primarySurface,
} from "../src/conformance/index";
import { bearerAuth, type SurfaceAdapter } from "../src/core/adapter";
import {
  BudgetExceededError,
  EngineClient,
  type RunConfig,
  type RunDepth,
} from "../src/core/client";
import { createContext } from "../src/core/context";
import { detectEngine } from "../src/core/engine-id";
import { pickModel } from "../src/core/model-picker";
import type {
  ConformanceResult,
  CreditEntry,
  EvalResult,
  RunReport,
} from "../src/core/outcome";
import {
  detectCatchAll,
  normalizeRoot,
  probeCredits,
  probeEndpoint,
} from "../src/core/probe";
import { detectReasoning, REASONING_HEADROOM } from "../src/core/reasoning";
import { CREDITS, SURFACES } from "../src/core/registry";
import { paletteFor } from "../src/core/report/colors";
import {
  buildJsonReport,
  diffBaseline,
  type ReportPhase,
  type ReportRunScope,
  type JsonReport,
} from "../src/core/report/json";
import { renderComparisonHtml } from "../src/core/report/compare";
import { renderHtml } from "../src/core/report/html";
import {
  ingestReportIntoLibrary,
  isLibraryDir,
  LibraryEmptyError,
  resolveLibraryDir,
  syncLibrary,
} from "../src/core/report/card/library";
import { slug } from "../src/core/report/card/shared";
import { renderMarkdown } from "../src/core/report/markdown";
import { renderReport } from "../src/core/report/terminal";
import {
  buildCoverageEntries,
  type FeatureSupport,
  runConformance,
  runEvals,
} from "../src/core/runner";
import {
  scoreCapability,
  scoreConformance,
  scoreCoverage,
} from "../src/core/score";
import { runAgentic } from "../src/agentic/index";
import { runBenchmark } from "../src/bench/index";
import { runFidelity } from "../src/fidelity/index";
import { ALL_EVALS } from "../src/evals/index";

interface Args {
  target?: string;
  apiKey?: string;
  model?: string;
  depth: RunDepth;
  json: boolean;
  markdown: boolean;
  bench: boolean;
  /** Run the benchmark and nothing else — no conformance, evals, agentic or fidelity. */
  benchOnly: boolean;
  timeoutSec: number;
  budget?: number;
  baseline?: string;
  save?: string;
  html?: string;
  /** Directory for the model library (index + cards + compare); auto-synced. */
  library?: string;
  /** Saved reports to put side by side instead of probing an engine. */
  compare?: string[];
  noColor: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    depth: "default",
    json: false,
    markdown: false,
    bench: false,
    benchOnly: false,
    timeoutSec: 60,
    noColor: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = () => argv[++i];

    switch (arg) {
      case "-k":
      case "--api-key":
        args.apiKey = next();
        break;
      case "-m":
      case "--model":
        args.model = next();
        break;
      case "--quick":
        args.depth = "quick";
        break;
      case "--full":
        args.depth = "full";
        break;
      case "--json":
        args.json = true;
        break;
      case "--markdown":
        args.markdown = true;
        break;
      case "--bench":
        args.bench = true;
        break;
      case "--bench-only":
        args.bench = true;
        args.benchOnly = true;
        break;
      case "--timeout":
        args.timeoutSec = Number(next());
        break;
      case "--budget":
        args.budget = Number(next());
        break;
      case "--baseline":
        args.baseline = next();
        break;
      case "--save":
        args.save = next();
        break;
      case "--html":
        args.html = next();
        break;
      case "--library":
        args.library = next();
        break;
      case "--compare": {
        // Variadic: everything up to the next flag. Comparing two files is the
        // common case and `--compare a.json b.json` is how people will type it.
        const files: string[] = [];
        while (i + 1 < argv.length && !argv[i + 1]!.startsWith("-")) {
          files.push(argv[++i]!);
        }
        args.compare = files;
        break;
      }
      case "--no-color":
        args.noColor = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        if (!arg.startsWith("-") && !args.target) args.target = arg;
    }
  }

  return args;
}

/**
 * A test slower than this gets its wall clock printed beside the tick. Most
 * finish in well under a second, so the ones that don't are worth naming —
 * usually an engine that thinks before every answer, or a cold prefill.
 */
const SLOW_TEST_MS = 3_000;

/** Control-flow marker for --bench-only: leave the scored phases unrun. */
class SkipToBench extends Error {}

/** 16384 → "16.4k". Matches how the report's context table reads. */
const fmtTokens = (n: number): string =>
  n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n);

const fmtCount = (n: number): string => n.toLocaleString("en-US");

const HELP = `llmprobe — LLM engine conformance & capability suite

Usage: llmprobe <base-url> [options]

Probes every standard surface at an OpenAI-compatible endpoint, scores what it
implements, and separately grades the model's capability.

  Coverage     how much of the standard surface exists (Core / Extended / Frontier)
  Conformance  of what IS implemented, how correct is it (MUST assertions only)
  Capability   below floor / capable / strong (deterministic evals, calibrated for 12B+)
  Agentic      multi-step tool tasks in a simulated workspace (harder than the floor)

Options:
  -k, --api-key <key>   API key (optional for local engines)
  -m, --model <name>    Model to test (default: interactive picker from
                        /v1/models on a TTY; first model if non-interactive.
                        Required when /v1/models is empty or unreachable)
      --quick           Surface probe + core smoke tests only
      --full            Everything, including the slow tests (long context, caching)
      --bench           Add a performance benchmark: decode tok/s, TTFT, prefill,
                        and an MTP/speculative-decoding probe (informational)
      --bench-only      Run only the benchmark — no conformance, evals, agentic
                        or fidelity. Surface discovery still runs; it is free.
      --json            Machine-readable output (also the baseline format)
      --markdown        README-ready report with badges
      --baseline <f>    Diff against a saved run and flag regressions
      --save <f>        Write the JSON report to a file
      --html <f>        Write a self-contained report card (themes, drill-downs)
      --library <dir>   Model library directory: ingest this run, rebuild
                        index.html, compare.html, and per-model cards from all
                        *.json saves in the dir. Also: llmprobe --library <dir>
                        rebuilds without probing. Auto-syncs when --save/--html
                        already point into a dir that has library.json.
      --compare <f...>  Interactive compare workbench from saved --save reports
                        instead of probing. Needs --html. Pick models per column;
                        sticky freeze header while scrolling.
      --budget <n>      Hard ceiling on total tokens (paid endpoints)
      --timeout <sec>   Per-request timeout (default: 60; --bench requests are
                        never timed out — a cold prefill takes what it takes)
      --no-color        Disable ANSI colour
  -h, --help            Show this help

Examples:
  llmprobe localhost:8080                      # llama.cpp
  llmprobe localhost:1234/v1                   # LM Studio
  llmprobe localhost:11434/v1                  # Ollama
  llmprobe https://openrouter.ai/api/v1 -k $OPENROUTER_API_KEY
  llmprobe localhost:8080 --save baselines/llama-cpp.json
  llmprobe localhost:8080 --baseline baselines/llama-cpp.json
  llmprobe localhost:8080 --library runs/report-card
  llmprobe --library runs/report-card              # rebuild library only
  llmprobe --compare a.json b.json c.json --html compare.html
`;

/**
 * Build one page from several saved runs. Probes nothing — the reports already
 * on disk are the whole input, so a comparison costs no tokens and no engine.
 */
function runComparison(args: Args): void {
  const files = args.compare ?? [];
  const c = paletteFor(!args.noColor);

  if (files.length < 2) {
    console.error("--compare needs at least two saved JSON reports");
    process.exit(1);
  }
  if (!args.html) {
    console.error("--compare needs --html <file> to write the comparison to");
    process.exit(1);
  }

  const loaded = files.map((file) => {
    let report: JsonReport;
    try {
      report = JSON.parse(readFileSync(file, "utf8")) as JsonReport;
    } catch (err) {
      console.error(
        `could not read ${file}: ${err instanceof Error ? err.message : err}`,
      );
      process.exit(1);
    }
    if (!report?.target || !report?.coverage) {
      console.error(`${file} is not an llmprobe --save report`);
      process.exit(1);
    }
    return { file, report };
  });

  // Prefer the model name; fall back through engine to the filename. Two runs
  // of the same model get the filename appended so the legend stays readable.
  const base = loaded.map(
    ({ file, report }) =>
      report.target.model || report.target.engine || basename(file, ".json"),
  );
  const inputs = loaded.map(({ file, report }, i) => ({
    label:
      base.filter((b) => b === base[i]).length > 1
        ? `${base[i]} (${basename(file, ".json")})`
        : base[i]!,
    report,
  }));

  const htmlDir = dirname(resolve(args.html));
  const libraryHref = isLibraryDir(htmlDir) ? "index.html" : null;
  writeFileSync(args.html, renderComparisonHtml(inputs, { libraryHref }));
  console.log(
    `${c.gray("comparison of")} ${inputs.length} ${c.gray("runs →")} ${args.html}`,
  );
  if (libraryHref) {
    console.log(`${c.gray("  library →")} ${join(htmlDir, "index.html")}`);
  }
}

function logLibrarySync(
  c: ReturnType<typeof paletteFor>,
  result: ReturnType<typeof syncLibrary>,
  extra?: { ingested?: string },
): void {
  console.log(
    `${c.gray("library")} ${result.runs} model${result.runs === 1 ? "" : "s"} ${c.gray("→")} ${result.dir}`,
  );
  if (extra?.ingested) {
    console.log(`${c.gray("  ingested →")} ${extra.ingested}`);
  }
  if (result.models.length > 0 && result.models.length <= 12) {
    console.log(`${c.gray("  models →")} ${result.models.join(", ")}`);
  }
  console.log(`${c.gray("  index →")} ${result.indexPath}`);
  console.log(`${c.gray("  compare →")} ${result.comparePath}`);
  console.log(
    `${c.gray("  cards →")} ${result.cardPaths.length} report card${result.cardPaths.length === 1 ? "" : "s"}`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }

  if (args.compare) {
    runComparison(args);
    return;
  }

  // Rebuild library from existing saves without probing.
  if (args.library && !args.target) {
    const c = paletteFor(!args.noColor);
    try {
      const result = syncLibrary(args.library);
      logLibrarySync(c, result);
    } catch (err) {
      if (err instanceof LibraryEmptyError) {
        console.error(err.message);
        process.exit(1);
      }
      throw err;
    }
    return;
  }

  if (!args.target) {
    console.log(HELP);
    process.exit(1);
  }

  const quiet = args.json || args.markdown;
  const c = paletteFor(!args.noColor && !quiet);
  const log = (line = "") => {
    if (!quiet) console.log(line);
  };

  const root = normalizeRoot(args.target);
  const apiKey = args.apiKey ?? process.env.LLMPROBE_API_KEY ?? "";
  const startedAt = Date.now();

  log(`${c.bold("llmprobe")} ${c.gray("·")} probing ${root}`);
  log();

  // ── 1. Surface discovery ────────────────────────────────────────────────
  // Empty-body POSTs: the server rejects them on validation long before any
  // inference runs, so mapping the whole surface costs nothing in tokens.

  const adapterById = new Map<string, SurfaceAdapter>(
    ADAPTERS.map((adapter) => [adapter.id, adapter]),
  );

  const headersFor = (surfaceId: string): Record<string, string> => {
    const adapter = adapterById.get(surfaceId);
    const partial = { apiKey } as RunConfig;
    return adapter ? adapter.headers(partial) : bearerAuth(partial);
  };

  // Some servers (LM Studio) answer every unknown path with HTTP 200 and an
  // error body. Learn what "not here" looks like before trusting any probe.
  const catchAll = await detectCatchAll(root, headersFor("chat"), 8000);
  if (catchAll) {
    log(
      c.gray(
        `  (server answers unknown paths with HTTP ${catchAll.statuses.join("/")}; matching replies are read as absent)`,
      ),
    );
  }

  const present = new Set<string>();
  let effectiveBase: string | null = null;
  let reachable = false;

  for (const surface of SURFACES) {
    const probe = await probeEndpoint({
      root,
      method: surface.method,
      path: surface.path,
      headers: headersFor(surface.id),
      timeoutMs: 8000,
      catchAll,
    });

    if (probe.status !== "network-error") reachable = true;

    if (probe.present) {
      present.add(surface.id);
      effectiveBase ??= probe.effectiveBaseUrl ?? `${root}/v1`;
    }

    log(
      `  ${probe.present ? c.green("✓") : c.gray("✗")} ${surface.label.padEnd(24)} ${c.gray(
        probe.present ? `HTTP ${probe.status}` : (probe.reason ?? "absent"),
      )}`,
    );
  }

  if (!reachable) {
    console.error(
      `\n${c.red("Error:")} cannot reach ${root}. Is the engine running?`,
    );
    process.exit(2);
  }

  if (present.size === 0) {
    console.error(
      `\n${c.red("Error:")} no standard surface found at ${root} — not an OpenAI-compatible endpoint?`,
    );
    process.exit(2);
  }

  const baseUrl = effectiveBase ?? `${root}/v1`;

  // Detected, shown, worth exactly zero points.
  const creditProbes = await probeCredits(
    root,
    CREDITS,
    headersFor("chat"),
    5000,
    catchAll,
  );
  const credits: CreditEntry[] = creditProbes
    .filter((probe) => probe.present)
    .map((probe) => ({ id: probe.credit.id, label: probe.credit.label }));

  for (const credit of credits) {
    log(
      `  ${c.yellow("○")} ${credit.label.padEnd(24)} ${c.gray("detected, not scored")}`,
    );
  }

  // ── 2. Resolve the model + read the engine's identity header ─────────────
  // The `Server` header is the only trustworthy engine identifier. Guessing
  // from the surface (e.g. "it serves /api/chat, so it's Ollama") is wrong —
  // mlx-serve, LM Studio and llama.cpp all ship the Ollama-compatible shim
  // without being Ollama.

  let model = args.model ?? "";
  let serverHeader: string | null = null;
  let modelIds: string[] = [];
  let modelsListError: string | null = null;
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: bearerAuth({ apiKey } as RunConfig),
      signal: AbortSignal.timeout(8000),
    });
    serverHeader = res.headers.get("server");
    if (!model) {
      if (!res.ok) {
        modelsListError = `GET ${baseUrl}/models → HTTP ${res.status}`;
      } else {
        const data = (await res.json()) as { data?: Array<{ id?: string }> };
        modelIds = (data?.data ?? [])
          .map((m) => m.id)
          .filter((id): id is string => typeof id === "string" && id.length > 0);
        if (modelIds.length === 0) {
          modelsListError = `GET ${baseUrl}/models returned no model ids`;
        }
      }
    }
  } catch (err) {
    modelsListError =
      err instanceof Error ? err.message : "failed to list /v1/models";
  }

  if (!model && modelIds.length > 0) {
    const interactive =
      !quiet && process.stdin.isTTY === true && process.stdout.isTTY === true;
    if (modelIds.length === 1 || !interactive) {
      model = modelIds[0]!;
      if (!interactive && modelIds.length > 1) {
        log(
          c.gray(
            `  (non-interactive — using first model: ${model}; pass --model to pick another)`,
          ),
        );
      }
    } else {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      try {
        model = await pickModel(modelIds, {
          ask: (question) => rl.question(question),
          print: (line) => console.log(line),
        });
      } finally {
        rl.close();
      }
      log();
    }
  }

  if (!model) {
    console.error(
      `\n${c.red("Error:")} could not determine a model — pass one with --model <id>.`,
    );
    if (modelsListError) {
      console.error(c.gray(`  ${modelsListError}`));
    }
    console.error(
      c.gray(
        "  Tip: list models with curl, e.g. curl -s http://localhost:8080/v1/models",
      ),
    );
    console.error(
      c.gray(
        "  Example: llmprobe localhost:8080 --model my-model --library runs/report-card",
      ),
    );
    process.exit(2);
  }

  const evalSurface = primarySurface(present);

  const baseConfig: RunConfig = {
    baseUrl,
    apiKey,
    model,
    timeoutMs: args.timeoutSec * 1000,
    depth: args.depth,
    budgetTokens: args.budget,
    reasoningHeadroom: 0,
  };

  const client = new EngineClient(baseConfig);

  // Reasoning models spend their whole budget thinking and return empty content
  // if we cap them tightly. Detect that once, or the capability card measures
  // our token budget rather than the model.
  const thinks = evalSurface
    ? await detectReasoning(client, adapterById.get(evalSurface)!, baseConfig)
    : false;

  const config: RunConfig = {
    ...baseConfig,
    reasoningHeadroom: thinks ? REASONING_HEADROOM : 0,
  };

  const ctx = createContext({
    config,
    client,
    adapters: adapterById,
    present,
    evalSurface,
  });

  log();
  log(
    `${c.gray("model:")} ${model}   ${c.gray("depth:")} ${args.depth}${
      thinks
        ? c.gray(`   reasoning model — +${REASONING_HEADROOM} token headroom`)
        : ""
    }`,
  );
  log();

  // ── 3. Conformance, then 4. capability ──────────────────────────────────

  let conformanceResults: ConformanceResult[] = [];
  let evalResults: EvalResult[] = [];
  let featureSupport: FeatureSupport = new Map();
  let unprobed = new Set<string>();
  let budgetHit = false;

  // --bench-only skips straight to the benchmark. Surface discovery above
  // already ran, because it costs nothing and the benchmark needs to know which
  // chat-shaped surface to measure through.
  try {
    if (args.benchOnly) throw new SkipToBench();
    const run = await runConformance(
      buildConformanceTests(present),
      ctx,
      (result) => {
        if (result.outcome === "unsupported" || result.outcome === "skipped") {
          return;
        }

        const icon =
          result.outcome === "pass"
            ? c.green("✓")
            : result.outcome === "fail"
              ? c.red("✗")
              : c.yellow("?");
        // Only the slow ones carry a time. Stamping all 267 lines would bury
        // the outliers, and the outliers are the entire reason to look.
        const took =
          result.durationMs !== undefined && result.durationMs >= SLOW_TEST_MS
            ? c.gray(`  ${(result.durationMs / 1000).toFixed(1)}s`)
            : "";
        log(`  ${icon} ${result.name}${took}`);

        if (result.outcome === "fail") {
          const failures = result.assertions.filter(
            (a) => !a.passed && a.severity === "MUST",
          );
          for (const failure of failures) {
            log(
              `      ${c.red("→")} ${c.gray(failure.message ?? failure.label)}`,
            );
          }
        }
        if (result.outcome === "inconclusive") {
          log(`      ${c.yellow("→")} ${c.gray(result.reason ?? "")}`);
        }
      },
    );

    conformanceResults = run.results;
    featureSupport = run.featureSupport;
    unprobed = run.unprobed;

    if (args.depth !== "quick") {
      log();
      evalResults = await runEvals(ALL_EVALS, ctx, featureSupport, (result) => {
        if (result.outcome) return;
        const passed = result.samples.filter((s) => s.passed).length;
        const icon =
          passed === result.samples.length
            ? c.green("✓")
            : passed === 0
              ? c.red("✗")
              : c.yellow("~");
        log(
          `  ${icon} ${result.name} ${c.gray(`${passed}/${result.samples.length}`)}`,
        );
      });
    }
  } catch (err) {
    if (err instanceof SkipToBench) {
      // nothing to do — the phases below are all gated on benchOnly too
    } else if (err instanceof BudgetExceededError) {
      budgetHit = true;
      log(`\n${c.yellow("⚠")} ${err.message} — stopping early.`);
    } else {
      throw err;
    }
  }

  // ── 4b. Agentic — multi-step tool use in a simulated workspace ──────────
  // A harder bar than the capability floor, reported as its own card and never
  // blended into the verdict: a capable model with zero agentic tasks should
  // read as exactly that.

  let agentic: RunReport["agentic"];
  if (
    !budgetHit &&
    !args.benchOnly &&
    args.depth !== "quick" &&
    ctx.evalSurface
  ) {
    if (featureSupport.get("tools")?.supported === true) {
      log();
      log(
        `${c.gray("agentic (multi-step tool tasks in a simulated workspace)...")}`,
      );
      try {
        agentic = await runAgentic(ctx, (result) => {
          const icon = result.passed ? c.green("✓") : c.red("✗");
          const steps = c.gray(
            `${result.steps} step${result.steps === 1 ? "" : "s"}`,
          );
          log(`  ${icon} ${result.name} ${steps}`);
          if (!result.passed && result.detail) {
            log(`      ${c.red("→")} ${c.gray(result.detail)}`);
          }
        });
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          budgetHit = true;
          log(`${c.yellow("⚠")} ${err.message}`);
        } else {
          log(
            `${c.yellow("⚠")} agentic failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } else {
      log();
      log(
        `${c.gray("agentic skipped — tool calling not available on this engine")}`,
      );
    }
  }

  // ── 4c. Fidelity — how faithfully the engine reproduces the model ───────
  // Scored (a single rankable number) but never gates the exit code: a lossy
  // quant is a legitimate config, not a broken engine. Runs by default; a
  // --quick smoke run skips it.

  let fidelity: RunReport["fidelity"];
  if (
    !budgetHit &&
    !args.benchOnly &&
    args.depth !== "quick" &&
    ctx.evalSurface
  ) {
    log();
    log(`${c.gray("fidelity (cloze battery + greedy self-consistency)...")}`);

    // Progress updates one line in place per phase (cloze battery, then each
    // greedy prompt), so a slow run stays live without scrolling a counter
    // ladder. Grouped by the label minus its "N/M" tail; a new group starts a
    // fresh line. Piped output gets none of this — the card is all that matters.
    const tty = !quiet && process.stdout.isTTY === true;
    let fidGroup = "";
    const fidProgress = (label: string) => {
      if (!tty) return;
      const group = label.replace(/\s*\d+\/\d+\s*$/, "");
      if (fidGroup && group !== fidGroup) process.stdout.write("\n");
      fidGroup = group;
      process.stdout.write(`\r  ${c.gray(label)}\x1b[K`);
    };
    const endProgress = () => {
      if (tty && fidGroup) process.stdout.write("\n");
    };

    try {
      fidelity = (await runFidelity(ctx, thinks, fidProgress)) ?? undefined;
      endProgress();
    } catch (err) {
      endProgress();
      if (err instanceof BudgetExceededError) {
        budgetHit = true;
        log(`${c.yellow("⚠")} ${err.message}`);
      } else {
        log(
          `${c.yellow("⚠")} fidelity failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // ── 4d. Benchmark (opt-in) — informational, never scored ────────────────

  let bench: RunReport["bench"];
  if (args.bench && !budgetHit && ctx.evalSurface) {
    log();
    log(`${c.gray("benchmarking (warmup + median of 3)...")}`);
    const benchStart = {
      input: client.usage.inputTokens,
      output: client.usage.outputTokens,
      requests: client.requests,
    };
    try {
      bench =
        (await runBenchmark(
          ctx,
          thinks,
          (label) => log(`  ${c.gray(label)}`),
          // The ladder is the long part — a single 64k rung can run for
          // minutes — so each one reports its numbers as it lands rather than
          // leaving the terminal silent until the whole report prints.
          (point) => {
            const size = `~${fmtTokens(point.inputTokens ?? point.targetTokens)}`;
            if (point.note) {
              log(
                `    ${c.gray(size.padStart(8))}  ${c.yellow(`✗ ${point.note}`)}`,
              );
              return;
            }
            const parts = [
              point.decodeTokPerSec !== null
                ? `${point.decodeTokPerSec} tok/s decode`
                : null,
              point.prefillTokPerSec !== null
                ? `${point.prefillTokPerSec} tok/s prefill`
                : null,
              point.ttftMs !== null
                ? `${(point.ttftMs / 1000).toFixed(1)}s first token`
                : null,
              point.speculative?.tokensPerStep !== null &&
              point.speculative?.tokensPerStep !== undefined
                ? `${point.speculative.tokensPerStep} tok/step`
                : null,
            ].filter(Boolean);
            log(
              `    ${c.bold(size.padStart(8))}  ${c.gray(parts.join(" · "))}`,
            );
          },
          (sample) => {
            const label = sample.label.padEnd(26);
            if (sample.error) {
              log(`  ${c.gray(label)}${c.yellow(sample.error)}`);
            } else if (sample.warmup) {
              // The warmup's number is deliberately thrown away — showing it
              // would invite reading a cold run as a result.
              log(`  ${c.gray(`${label}discarded`)}`);
            } else {
              const value =
                sample.value !== null
                  ? `${Math.round(sample.value * 10) / 10} ${sample.unit}`
                  : "n/a";
              log(`  ${c.gray(label)}${value}`);
            }
          },
        )) ?? undefined;
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        budgetHit = true;
        log(`${c.yellow("⚠")} ${err.message}`);
      } else {
        log(
          `${c.yellow("⚠")} benchmark failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // What the benchmark itself cost. The run footer totals everything; this
    // is the only place the ladder's own bill is visible, and at --full it is
    // most of the run.
    const spent = {
      input: client.usage.inputTokens - benchStart.input,
      output: client.usage.outputTokens - benchStart.output,
      requests: client.requests - benchStart.requests,
    };
    log(
      `  ${c.gray(
        `benchmark used ${fmtCount(spent.input + spent.output)} tokens ` +
          `(${fmtCount(spent.input)} in · ${fmtCount(spent.output)} out) ` +
          `over ${fmtCount(spent.requests)} requests`,
      )}`,
    );
  }

  // ── 5. Score and report ─────────────────────────────────────────────────

  const entries = buildCoverageEntries(
    SURFACES,
    present,
    featureSupport,
    unprobed,
  );

  const report: RunReport = {
    target: { baseUrl, model, engine: detectEngine(serverHeader) },
    coverage: scoreCoverage(entries, credits),
    conformance: scoreConformance(conformanceResults),
    capability: scoreCapability(evalResults),
    agentic,
    fidelity,
    bench,
    usage: { ...client.usage },
    durationMs: Date.now() - startedAt,
  };

  const phase = (
    status: ReportPhase,
    reason?: string,
  ): { status: ReportPhase; reason?: string } => ({ status, reason });
  const runScope: ReportRunScope = {
    depth: args.depth,
    mode: args.benchOnly ? "bench-only" : "probe",
    startedAt: new Date(startedAt).toISOString(),
    phases: {
      coverage: phase(
        unprobed.size > 0 ? "partial" : "measured",
        unprobed.size > 0
          ? `${unprobed.size} items were not probed`
          : undefined,
      ),
      conformance: phase(
        args.benchOnly
          ? "not-run"
          : budgetHit
            ? "interrupted"
            : args.depth === "quick"
              ? "partial"
              : conformanceResults.length > 0
                ? "measured"
                : "unavailable",
        args.benchOnly
          ? "benchmark-only run"
          : budgetHit
            ? "token budget exhausted"
            : args.depth === "quick"
              ? "quick depth omits slow conformance checks"
              : conformanceResults.length > 0
                ? undefined
                : "no conformance results",
      ),
      capability: phase(
        args.benchOnly || args.depth === "quick"
          ? "not-run"
          : budgetHit
            ? "interrupted"
            : evalResults.length > 0
              ? "measured"
              : "unavailable",
        args.benchOnly
          ? "benchmark-only run"
          : args.depth === "quick"
            ? "quick depth omits capability evals"
            : budgetHit
              ? "token budget exhausted"
              : evalResults.length > 0
                ? undefined
                : "no capability evals",
      ),
      agentic: phase(
        agentic
          ? "measured"
          : args.benchOnly || args.depth === "quick"
            ? "not-run"
            : budgetHit
              ? "interrupted"
              : !ctx.evalSurface ||
                  featureSupport.get("tools")?.supported !== true
                ? "unavailable"
                : "failed",
        agentic
          ? undefined
          : args.benchOnly
            ? "benchmark-only run"
            : args.depth === "quick"
              ? "quick depth omits agentic tasks"
              : budgetHit
                ? "token budget exhausted"
                : !ctx.evalSurface
                  ? "no chat-shaped evaluation surface"
                  : featureSupport.get("tools")?.supported !== true
                    ? "tool calling unavailable"
                    : "agentic phase did not produce a score",
      ),
      fidelity: phase(
        fidelity
          ? "measured"
          : args.benchOnly || args.depth === "quick"
            ? "not-run"
            : budgetHit
              ? "interrupted"
              : !ctx.evalSurface
                ? "unavailable"
                : "failed",
        fidelity
          ? undefined
          : args.benchOnly
            ? "benchmark-only run"
            : args.depth === "quick"
              ? "quick depth omits fidelity"
              : budgetHit
                ? "token budget exhausted"
                : !ctx.evalSurface
                  ? "no chat-shaped evaluation surface"
                  : "fidelity phase did not produce a score",
      ),
      performance: phase(
        bench
          ? "measured"
          : !args.bench
            ? "not-run"
            : budgetHit
              ? "interrupted"
              : !ctx.evalSurface
                ? "unavailable"
                : "failed",
        bench
          ? undefined
          : !args.bench
            ? "benchmark not requested"
            : budgetHit
              ? "token budget exhausted"
              : !ctx.evalSurface
                ? "no chat-shaped evaluation surface"
                : "benchmark did not produce a report",
      ),
    },
    budget: { limitTokens: args.budget, exhausted: budgetHit },
  };

  const json = buildJsonReport(report, {
    entries,
    conformance: conformanceResults,
    evals: evalResults,
    run: runScope,
  });

  let baselineContext: Parameters<typeof renderHtml>[1] | undefined;
  let baselineDiff: ReturnType<typeof diffBaseline> | undefined;
  if (args.baseline) {
    const baseline = JSON.parse(
      readFileSync(args.baseline, "utf8"),
    ) as JsonReport;
    baselineDiff = diffBaseline(baseline, json);
    baselineContext = {
      baseline: {
        label: args.baseline,
        regressions: baselineDiff.regressions.map(
          (item) => `${item.id}: ${item.before} → ${item.after}`,
        ),
        improvements: baselineDiff.improvements.map(
          (item) => `${item.id}: ${item.before} → ${item.after}`,
        ),
      },
    };
  }

  if (args.save) writeFileSync(args.save, `${JSON.stringify(json, null, 2)}\n`);

  const libraryDir = resolveLibraryDir({
    library: args.library,
    save: args.save,
    html: args.html,
  });

  if (libraryDir) {
    mkdirSync(libraryDir, { recursive: true });
    // Prefer keeping the user's --save basename when it already lives in the library.
    const preferredFileName =
      args.save && resolve(dirname(args.save)) === resolve(libraryDir)
        ? basename(args.save)
        : `${slug(json.target.model)}.json`;
    const {
      sync,
      jsonPath,
      slug: modelSlug,
    } = ingestReportIntoLibrary(libraryDir, json, { preferredFileName });
    const libraryCard = join(libraryDir, `${modelSlug}.html`);
    // Standalone --html still written when requested (may differ from library card).
    if (args.html) {
      const inLibrary = resolve(dirname(args.html)) === resolve(libraryDir);
      writeFileSync(
        args.html,
        renderHtml(json, {
          ...baselineContext,
          // Always offer a way back when this run is part of a library.
          libraryHref: inLibrary ? "index.html" : undefined,
          label: preferredFileName,
        }),
      );
      log(`${c.gray("html report →")} ${args.html}`);
      if (!inLibrary) {
        log(
          `${c.gray("  (library card →")} ${libraryCard}${c.gray("; open library →")} ${join(libraryDir, "index.html")}${c.gray(")")}`,
        );
      }
    } else {
      log(`${c.gray("html report →")} ${libraryCard}`);
    }
    if (!quiet) {
      logLibrarySync(c, sync, { ingested: `${modelSlug} · ${jsonPath}` });
    }
  } else if (args.html) {
    writeFileSync(args.html, renderHtml(json, baselineContext));
    log(`${c.gray("html report →")} ${args.html}`);
  }

  if (args.json) {
    console.log(JSON.stringify(json, null, 2));
  } else if (args.markdown) {
    console.log(renderMarkdown(report));
  } else {
    console.log();
    console.log(
      renderReport(report, { color: !args.noColor, benchOnly: args.benchOnly }),
    );
  }

  // ── 6. Baseline diff — this is what makes the suite a ratchet ────────────

  let regressed = false;

  if (args.baseline) {
    const { regressions, improvements } = baselineDiff!;
    regressed = regressions.length > 0;

    if (!quiet) {
      console.log();
      if (regressions.length === 0 && improvements.length === 0) {
        console.log(c.gray(`No change against ${args.baseline}.`));
      }
      for (const r of regressions) {
        console.log(`${c.red("REGRESSED")} ${r.id}: ${r.before} → ${r.after}`);
      }
      for (const i of improvements) {
        console.log(
          `${c.green("IMPROVED")}  ${i.id}: ${i.before} → ${i.after}`,
        );
      }
    }
  }

  // Non-zero on a MUST failure, a regression, or an exhausted budget, so this
  // works as a CI gate. Note the model's score never affects the exit code —
  // llmprobe gates on the engine, not on how clever the model is.
  const engineFailed =
    report.conformance.total > 0 && report.conformance.pct < 100;

  process.exit(regressed || budgetHit || engineFailed ? 1 : 0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(2);
});
