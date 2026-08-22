#!/usr/bin/env node
import pkg from "../package.json" with { type: "json" };
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

import {
  ADAPTERS,
  buildConformanceTests,
  primarySurface,
} from "../src/conformance/index";
import { bearerAuth, type SurfaceAdapter } from "../src/core/adapter";
import {
  BudgetExceededError,
  TargetUnreachableError,
  EngineClient,
  type RunConfig,
  type RunDepth,
} from "../src/core/client";
import { createContext } from "../src/core/context";
import { detectEngine } from "../src/core/engine-id";
import { pickModels } from "../src/core/model-picker";
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
import { CREDITS, FEATURES, SURFACES } from "../src/core/registry";
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
import { slug } from "../src/core/report/card/shared";
import {
  HOME_LIBRARY_DIR,
  ingestReportIntoLibrary,
  isLibraryDir,
  LibraryEmptyError,
  syncLibrary,
} from "../src/core/report/card/library";
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
import { SAMPLING_PRESETS, parseRungs, runBenchmark } from "../src/bench/index";
import { runFidelity } from "../src/fidelity/index";
import { ALL_EVALS } from "../src/evals/index";

interface Args {
  target?: string;
  apiKey?: string;
  model?: string;
  depth: RunDepth;
  json: boolean;
  markdown: boolean;
  /** Performance benchmark; on by default, --no-bench turns it off. */
  bench: boolean;
  /** Run the benchmark and nothing else — no conformance, evals, agentic or fidelity. */
  benchOnly: boolean;
  /** Named --sampling preset for --bench; absent means greedy (temperature 0). */
  sampling?: string;
  /** --rungs: context-ladder sizes to run instead of the depth's ladder. */
  rungs?: number[];
  /** --runs: measured runs per scenario and rung (after the warmup). */
  runs?: number;
  timeoutSec: number;
  budget?: number;
  baseline?: string;
  save?: string;
  /** Export a standalone report card to this path. No library side effects. */
  html?: string;
  /** Skip recording this run in the library. */
  noSave: boolean;
  /** `--library` given with no directory: act on the home library. */
  libraryDefault: boolean;
  /** Directory for the model library (index + cards + compare); auto-synced. */
  library?: string;
  /** Saved reports to put side by side instead of probing an engine. */
  compare?: string[];
  /** Open the HTML report in a browser after --html. Opt-in. */
  open: boolean;
  noColor: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    depth: "default",
    json: false,
    markdown: false,
    bench: true,
    benchOnly: false,
    timeoutSec: 60,
    noSave: false,
    libraryDefault: false,
    open: false,
    noColor: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;

    /**
     * Consume this flag's value, refusing to eat the next flag.
     *
     * `--html --quick` used to bind "--quick" as a filename and silently drop
     * the depth, turning a quick probe into a full one — on a paid endpoint,
     * money spent on a run nobody asked for.
     */
    const value = (): string => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("-")) {
        console.error(`${arg} needs a value`);
        process.exit(1);
      }
      return argv[++i]!;
    };

    const numberValue = (): number => {
      const raw = value();
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        console.error(`${arg} needs a positive number, got "${raw}"`);
        process.exit(1);
      }
      return n;
    };

    switch (arg) {
      case "-k":
      case "--api-key":
        args.apiKey = value();
        break;
      case "-m":
      case "--model":
        args.model = value();
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
      case "--no-bench":
        args.bench = false;
        break;
      case "--bench-only":
        args.bench = true;
        args.benchOnly = true;
        break;
      case "--sampling": {
        const preset = value();
        if (!(preset in SAMPLING_PRESETS)) {
          console.error(
            `--sampling needs one of: ${Object.keys(SAMPLING_PRESETS).join(", ")}`,
          );
          process.exit(1);
        }
        args.sampling = preset;
        break;
      }
      case "--rungs":
        try {
          args.rungs = parseRungs(value());
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
        break;
      case "--runs": {
        const n = numberValue();
        if (!Number.isInteger(n)) {
          console.error(`--runs needs a whole number, got ${n}`);
          process.exit(1);
        }
        args.runs = n;
        break;
      }
      case "--timeout":
        args.timeoutSec = numberValue();
        break;
      case "--budget":
        args.budget = numberValue();
        break;
      case "--baseline":
        args.baseline = value();
        break;
      case "--save":
        args.save = value();
        break;
      case "--html":
        args.html = value();
        break;
      case "--library": {
        // Bare --library means the home library; with a path it picks another.
        const v = argv[i + 1];
        if (v === undefined || v.startsWith("-")) {
          args.libraryDefault = true;
        } else {
          args.library = value();
        }
        break;
      }
      case "--no-save":
        args.noSave = true;
        break;
      case "--open":
        args.open = true;
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
      case "-v":
      case "--version":
        args.version = true;
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

const HELP = `llmprobe v${pkg.version} — LLM engine conformance & capability suite

Usage: llmprobe <base-url> [options]

Probes every standard surface at an OpenAI-compatible endpoint, scores what it
implements, and separately grades the model's capability.

  Coverage     how much of the standard surface exists (Core / Extended / Frontier)
  Conformance  of what IS implemented, how correct is it (MUST assertions only)
  Capability   below floor / capable / strong (deterministic evals, calibrated for 12B+)
  Agentic      multi-step tool tasks in a simulated workspace (harder than the floor)

Every run is recorded in ~/.llmprobe — the model library, with a ranking table
and a report card per run. See --library, --open and --no-save.

Options:
  -k, --api-key <key>   API key (optional for local engines)
  -m, --model <name>    Model to test (default: interactive picker from
                        /v1/models on a TTY; first model if non-interactive.
                        Required when /v1/models is empty or unreachable).
                        The picker takes a comma list (e.g. 1,3,5) and runs
                        each pick in turn, one report card per model
      --quick           Surface probe + core smoke tests only
      --full            Everything, including the slow tests (long context, caching)
      --bench           Performance benchmark: decode tok/s, TTFT, prefill,
                        and an MTP/speculative-decoding probe (informational).
                        On by default; --no-bench skips it
      --bench-only      Run only the benchmark — no conformance, evals, agentic
                        or fidelity. Surface discovery still runs; it is free.
      --sampling <p>    Sampling preset for benchmark requests, to check the
                        engine off the greedy path. Not comparable to greedy
                        runs; the report says so. One of:
                          precise    t=0.2, top_p 0.9
                          balanced   t=0.7, top_p 0.95
                          creative   t=1.0, top_p 0.95
                        Default: greedy (t=0)
      --rungs <list>    Context-ladder sizes to run, e.g. 8k,16k or 32,64.
                        From 512, 4k, 8k, 16k, 32k, 64k. Replaces the
                        default (512-16k) or --full (512-64k) ladder
      --runs <n>        Measured runs per scenario and per rung, after the
                        warmup. Default: 3 (context rungs: 1, or 3 at --full)
      --json            Machine-readable output (also the baseline format)
      --markdown        README-ready report with badges
      --baseline <f>    Diff against a saved run and flag regressions
      --save <f>        Write the JSON report to a file
      --html <f>        Export a standalone report card to this path
      --library [dir]   Use a different library than ~/.llmprobe. With no
                        target URL, rebuilds the library without probing
      --no-save         Do not record this run in the library
      --open            Open the report card (or the library, with --library)
      --compare <f...>  Interactive compare workbench from saved --save reports
                        instead of probing. Pick models per column;
                        sticky freeze header while scrolling.
      --budget <n>      Hard ceiling on total tokens (paid endpoints)
      --timeout <sec>   Per-request timeout (default: 60; --bench requests are
                        never timed out — a cold prefill takes what it takes)
      --no-color        Disable ANSI colour
  -v, --version         Print the llmprobe version
  -h, --help            Show this help

Examples:
  llmprobe localhost:8080                      # llama.cpp
  llmprobe localhost:1234/v1                   # LM Studio
  llmprobe localhost:11434/v1                  # Ollama
  llmprobe https://openrouter.ai/api/v1 -k $OPENROUTER_API_KEY
  llmprobe localhost:8080 --save baselines/llama-cpp.json
  llmprobe localhost:8080 --baseline baselines/llama-cpp.json
  llmprobe localhost:8080 --open                   # probe, open the card
  llmprobe localhost:8080 --html runs/my-run.html  # also export a card here
  llmprobe localhost:8080 --library runs/lib       # record in a project library
  llmprobe --library --open                        # open ~/.llmprobe
  llmprobe --library runs/lib                      # rebuild, no probing
  llmprobe --compare a.json b.json c.json --html compare.html
`;

/** Open a local HTML file in the default browser (best-effort). */
function openInBrowser(filePath: string): void {
  const abs = resolve(filePath);
  const fileUrl = pathToFileURL(abs).href;
  // spawn, not execFile: detached + unref is what lets the CLI exit without
  // waiting on the browser, and execFile has no such option.
  const [cmd, cmdArgs] =
    process.platform === "darwin"
      ? // Prefer file:// URL so Finder/browser handoff is reliable.
        ["open", [fileUrl]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", fileUrl]]
        : ["xdg-open", [fileUrl]];
  try {
    const child = spawn(cmd as string, cmdArgs as string[], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // Non-fatal: CI / headless environments may lack a browser opener.
  }
}

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
  // Defaults into the library so `--compare a.json b.json` just works.
  const outPath = args.html ?? join(HOME_LIBRARY_DIR, "compare.html");

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

  const htmlDir = dirname(resolve(outPath));
  mkdirSync(htmlDir, { recursive: true });
  const libraryHref = isLibraryDir(htmlDir) ? "index.html" : null;
  writeFileSync(outPath, renderComparisonHtml(inputs, { libraryHref }));
  console.log(
    `${c.gray("comparison of")} ${inputs.length} ${c.gray("runs →")} ${outPath}`,
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

/** Everything the per-model probe needs that discovery already worked out. */
interface ProbeShared {
  args: Args;
  baseUrl: string;
  apiKey: string;
  present: Set<string>;
  credits: CreditEntry[];
  adapterById: Map<string, SurfaceAdapter>;
  evalSurface: string | null;
  serverHeader: string | null;
  /** First non-empty `owned_by` from /v1/models — second engine-id signal. */
  ownedBy: string | null;
  c: ReturnType<typeof paletteFor>;
  log: (line?: string) => void;
  quiet: boolean;
  /** Several models were picked, so per-run output files need distinct names. */
  multi: boolean;
}

interface ProbeOutcome {
  /** Set when the target stopped answering; every score is partial. */
  incomplete: string | null;
  regressed: boolean;
  budgetHit: boolean;
  engineFailed: boolean;
  /** Report card written for this run, if any. */
  card: string | null;
  libraryIndex: string | null;
}

/** runs/probe.html + "qwen3-8b" → runs/probe-qwen3-8b.html */
function perModelPath(path: string, model: string, multi: boolean): string {
  if (!multi) return path;
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  return join(dirname(path), `${stem}-${slug(model)}${ext}`);
}

/**
 * One model, end to end: conformance, capability, agentic, fidelity, benchmark,
 * then every requested output. Surface discovery is shared and already done —
 * probing four models on one endpoint maps it once, not four times.
 */
async function probeModel(
  model: string,
  startedAt: number,
  shared: ProbeShared,
): Promise<ProbeOutcome> {
  const {
    args,
    baseUrl,
    apiKey,
    present,
    credits,
    adapterById,
    evalSurface,
    serverHeader,
    ownedBy,
    c,
    log,
    quiet,
    multi,
  } = shared;

  const baseConfig: RunConfig = {
    baseUrl,
    apiKey,
    model,
    timeoutMs: args.timeoutSec * 1000,
    depth: args.depth,
    budgetTokens: args.budget,
    reasoningHeadroom: 0,
    ...(args.sampling
      ? { benchSampling: SAMPLING_PRESETS[args.sampling] }
      : {}),
    ...(args.rungs ? { benchRungs: args.rungs } : {}),
    ...(args.runs !== undefined ? { benchRuns: args.runs } : {}),
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
  /** Credits the tests themselves earned — the endpoint probes ran before this. */
  let testCredits: CreditEntry[] = [];
  let budgetHit = false;
  /** Set when the target stopped answering — everything after it is partial. */
  let incomplete: string | null = null;

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
            : result.outcome === "fail" || result.outcome === "unreachable"
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
        if (result.outcome === "unreachable") {
          log(`      ${c.red("→")} ${c.gray(result.reason ?? "no answer")}`);
        }
      },
    );

    conformanceResults = run.results;
    featureSupport = run.featureSupport;
    unprobed = run.unprobed;
    testCredits = run.credits;

    if (run.unreachable) {
      const { after, notRun, reason } = run.unreachable;
      incomplete = `target became unreachable after "${after}" — ${notRun} ${notRun === 1 ? "check" : "checks"} not run (${reason})`;
      log();
      log(`${c.red("✗")} target became unreachable after ${c.bold(after)}`);
      log(`  ${c.gray(reason)}`);
      log(
        `  ${c.gray(`${notRun} ${notRun === 1 ? "check" : "checks"} not run. Scores below are partial.`)}`,
      );
    }

    if (!incomplete && args.depth !== "quick") {
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
    } else if (err instanceof TargetUnreachableError) {
      incomplete = err.message;
      log(`\n${c.red("✗")} ${err.message}`);
      log(`  ${c.gray("run stopped. Scores below are partial.")}`);
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
    !incomplete &&
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
        } else if (err instanceof TargetUnreachableError) {
          incomplete = err.message;
          agentic = undefined;
          log(`${c.red("✗")} ${err.message}`);
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
    !incomplete &&
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
      } else if (err instanceof TargetUnreachableError) {
        incomplete = err.message;
        fidelity = undefined;
        log(`${c.red("✗")} ${err.message}`);
      } else {
        log(
          `${c.yellow("⚠")} fidelity failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // ── 4d. Benchmark (opt-in) — informational, never scored ────────────────

  let bench: RunReport["bench"];
  if (args.bench && !budgetHit && !incomplete && ctx.evalSurface) {
    log();
    log(`${c.gray(`benchmarking (warmup + median of ${args.runs ?? 3})...`)}`);
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
      } else if (err instanceof TargetUnreachableError) {
        // Half a ladder from a process that has already died is not a slow
        // engine, it is no engine. Publishing those numbers is the whole bug.
        incomplete = err.message;
        bench = undefined;
        log(`${c.red("✗")} ${err.message}`);
        log(
          `  ${c.gray("benchmark discarded — the target stopped answering.")}`,
        );
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
    // --bench-only never ran a conformance test, so nothing was learned about
    // any feature. Left empty, every one of them would print as "not detected"
    // — a wall of red for checks nobody asked to run.
    args.benchOnly ? new Set(FEATURES.map((f) => f.id)) : unprobed,
  );

  const report: RunReport = {
    target: { baseUrl, model, engine: detectEngine(serverHeader, ownedBy) },
    ...(incomplete ? { incomplete } : {}),
    coverage: scoreCoverage(entries, [...credits, ...testCredits]),
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

  // With several models in one command, one --save path would have every run
  // overwriting the last. Each gets the model's slug appended instead.
  const savePath = args.save
    ? perModelPath(args.save, model, multi)
    : undefined;
  const htmlPath = args.html
    ? perModelPath(args.html, model, multi)
    : undefined;

  if (savePath) {
    mkdirSync(dirname(resolve(savePath)), { recursive: true });
    writeFileSync(savePath, `${JSON.stringify(json, null, 2)}\n`);
    log(`${c.gray("json report →")} ${savePath}`);
  }

  // Every run is recorded, so a library exists without anyone opting in — you
  // cannot compare engines you forgot to save. --no-save skips it.
  const libraryDir = args.noSave ? null : (args.library ?? HOME_LIBRARY_DIR);

  let openedHtml: string | null = null;

  if (libraryDir) {
    const firstRun = !existsSync(libraryDir);
    mkdirSync(libraryDir, { recursive: true });
    // Keep the user's --save basename when it already lives in the library.
    // Otherwise let the library name the file: it keys on model + endpoint, and
    // a model-only name here silently overwrote the other engine's run.
    const preferredFileName =
      savePath && resolve(dirname(savePath)) === resolve(libraryDir)
        ? basename(savePath)
        : undefined;
    const {
      sync,
      jsonPath,
      slug: modelSlug,
    } = ingestReportIntoLibrary(libraryDir, json, { preferredFileName });
    openedHtml = join(libraryDir, `${modelSlug}.html`);

    if (firstRun) {
      log(
        `${c.gray("recording runs in")} ${libraryDir} ${c.gray("— --no-save to skip")}`,
      );
    }
    if (!quiet) {
      logLibrarySync(c, sync, { ingested: `${modelSlug} · ${jsonPath}` });
    }
  }

  // A standalone export: its own file, no ← Library link, nothing else touched.
  if (htmlPath) {
    mkdirSync(dirname(resolve(htmlPath)), { recursive: true });
    writeFileSync(htmlPath, renderHtml(json, baselineContext));
    log(`${c.gray("html report →")} ${htmlPath}`);
    openedHtml = htmlPath;
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

  if (args.baseline && incomplete) {
    // Diffing a truncated run against a baseline manufactures regressions for
    // every check that never ran.
    console.log();
    console.log(
      c.yellow(
        `Baseline diff skipped — the run did not finish (${incomplete}).`,
      ),
    );
  } else if (args.baseline) {
    const baseline = JSON.parse(
      readFileSync(args.baseline, "utf8"),
    ) as JsonReport;
    const { regressions, improvements } = diffBaseline(baseline, json);
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

  const engineFailed =
    report.conformance.total > 0 && report.conformance.pct < 100;

  return {
    incomplete,
    regressed,
    budgetHit,
    engineFailed,
    card: openedHtml,
    libraryIndex: libraryDir ? join(libraryDir, "index.html") : null,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.version) {
    console.log(pkg.version);
    process.exit(0);
  }

  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }

  if (args.compare) {
    runComparison(args);
    return;
  }

  // Rebuild library from existing saves without probing.
  if ((args.library || args.libraryDefault) && !args.target) {
    const c = paletteFor(!args.noColor);
    const dir = args.library ?? HOME_LIBRARY_DIR;
    try {
      const result = syncLibrary(dir);
      logLibrarySync(c, result);
      if (args.open) openInBrowser(result.indexPath);
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

  log(
    `${c.bold("llmprobe")} ${c.gray(`v${pkg.version}`)} ${c.gray("·")} probing ${root}`,
  );
  log();

  // ── 1. Surface discovery ────────────────────────────────────────────────
  // Empty-body POSTs: the server rejects them on validation long before any
  // inference runs, so mapping the whole surface costs nothing in tokens.

  const adapterById = new Map<string, SurfaceAdapter>(
    ADAPTERS.map((adapter) => [adapter.id, adapter]),
  );

  const headersFor = (surfaceId: string): Record<string, string> => {
    // count_tokens is Anthropic-shaped but has no chat adapter of its own.
    const adapter = adapterById.get(
      surfaceId === "count-tokens" ? "messages" : surfaceId,
    );
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

  // One or more: the interactive picker takes "1,3,5" and runs each in turn,
  // which is why this is a list.
  let models: string[] = args.model ? [args.model] : [];
  let serverHeader: string | null = null;
  let ownedBy: string | null = null;
  let modelIds: string[] = [];
  let modelsListError: string | null = null;
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: bearerAuth({ apiKey } as RunConfig),
      signal: AbortSignal.timeout(8000),
    });
    serverHeader = res.headers.get("server");
    if (!res.ok) {
      if (models.length === 0) {
        modelsListError = `GET ${baseUrl}/models → HTTP ${res.status}`;
      }
    } else {
      const data = (await res.json()) as {
        data?: Array<{ id?: string; owned_by?: string }>;
      };
      ownedBy = data?.data?.find((m) => m.owned_by)?.owned_by ?? null;
      if (models.length === 0) {
        modelIds = (data?.data ?? [])
          .map((m) => m.id)
          .filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          );
        if (modelIds.length === 0) {
          modelsListError = `GET ${baseUrl}/models returned no model ids`;
        }
      }
    }
  } catch (err) {
    modelsListError =
      err instanceof Error ? err.message : "failed to list /v1/models";
  }

  if (models.length === 0 && modelIds.length > 0) {
    const interactive =
      !quiet && process.stdin.isTTY === true && process.stdout.isTTY === true;
    if (modelIds.length === 1 || !interactive) {
      models = [modelIds[0]!];
      if (!interactive && modelIds.length > 1) {
        log(
          c.gray(
            `  (non-interactive — using first model: ${models[0]}; pass --model to pick another)`,
          ),
        );
      }
    } else {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      try {
        models = await pickModels(modelIds, {
          ask: (question) => rl.question(question),
          print: (line) => console.log(line),
        });
      } finally {
        rl.close();
      }
      log();
    }
  }

  if (models.length === 0) {
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

  const outcomes: ProbeOutcome[] = [];
  const shared: ProbeShared = {
    args,
    baseUrl,
    apiKey,
    present,
    credits,
    adapterById,
    evalSurface,
    serverHeader,
    ownedBy,
    c,
    log,
    quiet,
    multi: models.length > 1,
  };

  for (const [index, target] of models.entries()) {
    if (models.length > 1) {
      log();
      log(
        `${c.bold(`── model ${index + 1}/${models.length}`)} ${c.gray("·")} ${target}`,
      );
    }
    // The first run owns the discovery time it benefited from; the rest time
    // only themselves, since discovery ran once for all of them.
    outcomes.push(
      await probeModel(target, index === 0 ? startedAt : Date.now(), shared),
    );
  }

  // With several models the library index is the page worth landing on — it is
  // where they sit side by side. A single run opens its own card.
  if (args.open && !quiet) {
    const single = outcomes.length === 1 ? outcomes[0]!.card : null;
    const target = single ?? outcomes.find((o) => o.libraryIndex)?.libraryIndex;
    if (target) {
      openInBrowser(target);
      log(`${c.gray("opened →")} ${resolve(target)}`);
    }
  }

  // Non-zero on a MUST failure, a regression, or an exhausted budget, so this
  // works as a CI gate. Note the model's score never affects the exit code —
  // llmprobe gates on the engine, not on how clever the model is.
  //
  // A run that never finished is its own exit code: exit 1 means "the engine
  // failed a MUST", and a dead target has not earned that verdict.
  if (outcomes.some((o) => o.incomplete)) process.exit(2);

  process.exit(
    outcomes.some((o) => o.regressed || o.budgetHit || o.engineFailed) ? 1 : 0,
  );
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(2);
});
