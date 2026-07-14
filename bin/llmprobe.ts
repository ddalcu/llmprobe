#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

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
  type JsonReport,
} from "../src/core/report/json";
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
import { runBenchmark } from "../src/bench/index";
import { ALL_EVALS } from "../src/evals/index";

interface Args {
  target?: string;
  apiKey?: string;
  model?: string;
  depth: RunDepth;
  json: boolean;
  markdown: boolean;
  bench: boolean;
  timeoutSec: number;
  budget?: number;
  baseline?: string;
  save?: string;
  noColor: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    depth: "default",
    json: false,
    markdown: false,
    bench: false,
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

const HELP = `llmprobe — LLM engine conformance & capability suite

Usage: llmprobe <base-url> [options]

Probes every standard surface at an OpenAI-compatible endpoint, scores what it
implements, and separately checks whether the model is semi-capable.

  Coverage     how much of the standard surface exists (Core / Extended / Frontier)
  Conformance  of what IS implemented, how correct is it (MUST assertions only)
  Capability   is the model semi-capable (deterministic evals, calibrated for 12B+)

Options:
  -k, --api-key <key>   API key (optional for local engines)
  -m, --model <name>    Model to test (default: the first from /v1/models)
      --quick           Surface probe + core smoke tests only
      --full            Everything, including the slow tests (long context, caching)
      --bench           Add a performance benchmark: decode tok/s, TTFT, prefill,
                        and an MTP/speculative-decoding probe (informational)
      --json            Machine-readable output (also the baseline format)
      --markdown        README-ready report with badges
      --baseline <f>    Diff against a saved run and flag regressions
      --save <f>        Write the JSON report to a file
      --budget <n>      Hard ceiling on total tokens (paid endpoints)
      --timeout <sec>   Per-request timeout (default: 60)
      --no-color        Disable ANSI colour
  -h, --help            Show this help

Examples:
  llmprobe localhost:8080                      # llama.cpp
  llmprobe localhost:1234/v1                   # LM Studio
  llmprobe localhost:11434/v1                  # Ollama
  llmprobe https://openrouter.ai/api/v1 -k $OPENROUTER_API_KEY
  llmprobe localhost:8080 --save baselines/llama-cpp.json
  llmprobe localhost:8080 --baseline baselines/llama-cpp.json
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.target) {
    console.log(HELP);
    process.exit(args.target ? 0 : 1);
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
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: bearerAuth({ apiKey } as RunConfig),
      signal: AbortSignal.timeout(8000),
    });
    serverHeader = res.headers.get("server");
    if (!model) {
      const data = (await res.json()) as { data?: Array<{ id?: string }> };
      model = data?.data?.[0]?.id ?? "";
    }
  } catch {
    // Fall through to the model error below.
  }

  if (!model) {
    console.error(
      `\n${c.red("Error:")} could not determine a model — pass one with --model.`,
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

  try {
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
        log(`  ${icon} ${result.name}`);

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
    if (!(err instanceof BudgetExceededError)) throw err;
    budgetHit = true;
    log(`\n${c.yellow("⚠")} ${err.message} — stopping early.`);
  }

  // ── 4b. Benchmark (opt-in) — informational, never scored ────────────────

  let bench: RunReport["bench"];
  if (args.bench && !budgetHit && ctx.evalSurface) {
    log();
    log(`${c.gray("benchmarking (warmup + median of 3)...")}`);
    try {
      bench =
        (await runBenchmark(ctx, thinks, (label) =>
          log(`  ${c.gray(label)}`),
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
    bench,
    usage: { ...client.usage },
    durationMs: Date.now() - startedAt,
  };

  const json = buildJsonReport(report, {
    entries,
    conformance: conformanceResults,
    evals: evalResults,
  });

  if (args.save) writeFileSync(args.save, `${JSON.stringify(json, null, 2)}\n`);

  if (args.json) {
    console.log(JSON.stringify(json, null, 2));
  } else if (args.markdown) {
    console.log(renderMarkdown(report));
  } else {
    console.log();
    console.log(renderReport(report, { color: !args.noColor }));
  }

  // ── 6. Baseline diff — this is what makes the suite a ratchet ────────────

  let regressed = false;

  if (args.baseline) {
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
