/**
 * Pure JsonReport → intent-based report-card view-model.
 *
 * No DOM, no filesystem. Safe to port to TypeScript in S4.
 * Never invents scores; never blends cards into an overall grade.
 */

/** @typedef {"good" | "critical" | "caution" | "neutral"} Tone */
/** @typedef {"critical" | "caution" | "note"} FindingKind */
/** @typedef {"hero" | "body" | "collapsed"} Density */
/** @typedef {"user" | "engine" | "model-maker" | "overview"} ViewId */

export const VIEWS = /** @type {const} */ ([
  "user",
  "engine",
  "model-maker",
  "overview",
]);

export const DEFAULT_VIEW = /** @type {ViewId} */ ("user");

export const CATEGORY_LABELS = {
  "tool-selection": "Tool selection",
  "tool-restraint": "Tool restraint",
  "tool-args": "Tool argument fidelity",
  multiturn: "Multi-turn state",
  instructions: "Instruction following",
  "json-discipline": "JSON discipline",
  "long-context": "Long-context recall",
  reasoning: "Basic reasoning",
  knowledge: "Basic knowledge",
};

/** Matches product floor in src/core/outcome.ts */
export const CATEGORY_FLOOR_PCT = 50;

export const AGENTIC_FAILURE_GLOSS = {
  "no-tool-call": "Answered without using tools (priors / guess)",
  "wrong-answer": "Used tools but final state or answer was wrong",
  "step-limit": "Hit the step cap before finishing cleanly",
  "engine-error": "Engine/API error during the agent loop",
};

const VIEW_META = {
  user: {
    title: "User / Capability",
    question: "Is this setup usable for my agent and tool workflows?",
  },
  engine: {
    title: "Engine / Harness",
    question: "What is missing, broken, or regressed in the engine?",
  },
  "model-maker": {
    title: "Model maker",
    question:
      "Does this model clear the practical floor for tool use and multi-step agents?",
  },
  overview: {
    title: "Overview",
    question: "What did this run measure, fully and separately?",
  },
};

// ── small utils ──────────────────────────────────────────────────────────────

const tierOf = (report, tier) =>
  report.coverage?.byTier?.find((t) => t.tier === tier) ?? null;

const pctText = (v) =>
  v === null || v === undefined ? "not measured" : `${v}%`;

const phaseOf = (report, name) =>
  report.run?.phases?.[name] ?? {
    status: report.version === 2 && report.run ? "not-run" : "unknown",
    reason: report.run ? undefined : "scope not recorded",
  };

const phaseText = (report, name) => {
  const p = phaseOf(report, name);
  if (p.status === "measured") return "measured";
  if (p.status === "unknown") return "scope not recorded";
  return p.reason ? `${p.status} — ${p.reason}` : p.status;
};

const capabilityMeasured = (report) =>
  (report.capability?.categories?.length ?? 0) > 0;

const conformanceMeasured = (report) =>
  (report.conformance?.total ?? 0) > 0;

const mustFailures = (report) => {
  const results = report.conformance?.results ?? [];
  /** @type {Array<{ result: any, failure: any }>} */
  const out = [];
  for (const result of results) {
    for (const failure of result.failures ?? []) {
      if (failure.severity === "MUST") out.push({ result, failure });
    }
  }
  return out;
};

const outcomeCounts = (report) => {
  const counts = {
    pass: 0,
    fail: 0,
    unsupported: 0,
    inconclusive: 0,
    skipped: 0,
    other: 0,
  };
  for (const r of report.conformance?.results ?? []) {
    const o = r.outcome;
    if (o in counts) counts[/** @type {keyof typeof counts} */ (o)] += 1;
    else counts.other += 1;
  }
  // Prefer explicit inconclusive list when results omit outcomes (older saves)
  if (
    counts.inconclusive === 0 &&
    (report.conformance?.inconclusive?.length ?? 0) > 0
  ) {
    counts.inconclusive = report.conformance.inconclusive.length;
  }
  return counts;
};

const categoryLabel = (id) => CATEGORY_LABELS[id] ?? id;

// ── engine health (compact badge for User view) ──────────────────────────────

/**
 * Compact engine signal so User view can attribute “engine vs model”.
 * @param {any} report
 */
export function buildEngineHealth(report) {
  const core = tierOf(report, "core");
  const confPct = conformanceMeasured(report)
    ? report.conformance.pct
    : null;
  const must = mustFailures(report).length;
  const coreMissing = core?.missing?.length ?? 0;

  /** @type {Tone} */
  let tone = "neutral";
  if (core && core.pct < 100) tone = "critical";
  else if (must > 0 || (confPct !== null && confPct < 100)) tone = "caution";
  else if (core && confPct !== null && core.pct === 100 && confPct === 100)
    tone = "good";
  else if (core && core.pct === 100 && !conformanceMeasured(report))
    tone = "good";

  let summary;
  if (!core && !conformanceMeasured(report)) {
    summary = "Engine health not measured in this run.";
  } else if (tone === "good") {
    summary =
      "Engine looks solid on measured surface — model is the constraint if agents fail.";
  } else if (coreMissing > 0) {
    summary = `Engine incomplete (Core gaps: ${core.missing.join(", ")}). Model grades may under-read tools.`;
  } else if (must > 0) {
    summary = `Engine has ${must} MUST violation${must === 1 ? "" : "s"} — fix server correctness before blaming the model.`;
  } else if (confPct !== null && confPct < 100) {
    summary = `Conformance ${confPct}% — inspect MUST failures before trusting tool paths.`;
  } else {
    summary = "Engine partially measured; see Engine view for detail.";
  }

  return {
    corePct: core?.pct ?? null,
    coreSupported: core ? `${core.supported}/${core.total}` : null,
    conformancePct: confPct,
    conformanceRatio: conformanceMeasured(report)
      ? `${report.conformance.passed}/${report.conformance.total}`
      : null,
    mustViolations: must,
    tone,
    summary,
    label: "Engine health",
    value:
      core || confPct !== null
        ? [
            core ? `Core ${core.pct}%` : null,
            confPct !== null ? `Conf ${confPct}%` : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : "not measured",
  };
}

// ── findings (filtered per view) ─────────────────────────────────────────────

/**
 * @param {any} report
 * @returns {Array<{ kind: FindingKind, label: string, detail: string, tags: string[] }>}
 */
export function buildAllFindings(report) {
  /** @type {Array<{ kind: FindingKind, label: string, detail: string, tags: string[] }>} */
  const findings = [];

  for (const { result, failure } of mustFailures(report)) {
    findings.push({
      kind: "critical",
      label: failure.label ?? failure.id,
      detail: `${result.name ?? result.id}${failure.message ? ` — ${failure.message}` : ""}`,
      tags: ["engine", "conformance", "must"],
    });
  }

  for (const tier of report.coverage?.byTier ?? []) {
    if (tier.missing?.length) {
      findings.push({
        kind: tier.tier === "core" ? "critical" : "caution",
        label: `${tier.tier[0].toUpperCase()}${tier.tier.slice(1)} coverage gaps`,
        detail: tier.missing.join(", "),
        tags: ["engine", "coverage", tier.tier],
      });
    }
    if (tier.unprobed?.length) {
      findings.push({
        kind: "note",
        label: `${tier.tier[0].toUpperCase()}${tier.tier.slice(1)} not probed`,
        detail: tier.unprobed.join(", "),
        tags: ["engine", "coverage", "unprobed", tier.tier],
      });
    }
  }

  const counts = outcomeCounts(report);
  if (counts.inconclusive > 0) {
    const listed = (report.conformance?.inconclusive ?? [])
      .map(
        (r) =>
          `${r.name ?? r.id}${r.reason ? `: ${r.reason}` : ""}`,
      )
      .filter(Boolean);
    findings.push({
      kind: "caution",
      label: `${counts.inconclusive} conformance check${counts.inconclusive === 1 ? "" : "s"} inconclusive`,
      detail:
        listed.length > 0
          ? listed.join("; ")
          : "Model did not exercise the path — not counted as pass or fail",
      tags: ["engine", "conformance", "inconclusive"],
    });
  }

  const warnings = report.conformance?.warnings ?? [];
  if (warnings.length > 0) {
    findings.push({
      kind: "caution",
      label: `${warnings.length} conformance warning${warnings.length === 1 ? "" : "s"}`,
      detail: warnings
        .map((w) => w.label ?? w.id)
        .slice(0, 8)
        .join(", "),
      tags: ["engine", "conformance", "warning"],
    });
  }

  const weak = report.capability?.weakCategories ?? [];
  if (weak.length > 0) {
    findings.push({
      kind: "caution",
      label: "Model categories below floor",
      detail: weak.map(categoryLabel).join(", "),
      tags: ["model", "capability", "floor"],
    });
  }

  const unmeasured = report.capability?.unmeasured ?? [];
  if (unmeasured.length > 0) {
    findings.push({
      kind: "note",
      label: "Model categories not measured",
      detail: unmeasured.map(categoryLabel).join(", "),
      tags: ["model", "capability", "unmeasured"],
    });
  }

  if (report.agentic) {
    for (const task of report.agentic.tasks.filter((t) => !t.passed)) {
      const gloss =
        task.failure && AGENTIC_FAILURE_GLOSS[task.failure]
          ? AGENTIC_FAILURE_GLOSS[task.failure]
          : null;
      findings.push({
        kind: task.failure === "engine-error" ? "critical" : "caution",
        label: `Agent task failed: ${task.name}`,
        detail: [
          task.failure ? `[${task.failure}]` : null,
          gloss,
          task.detail ?? null,
        ]
          .filter(Boolean)
          .join(" "),
        tags: [
          "model",
          "agentic",
          task.failure ?? "failed",
          task.failure === "engine-error" ? "engine" : "model",
        ],
      });
    }
  }

  if (report.fidelity?.firstDivergence) {
    const d = report.fidelity.firstDivergence;
    findings.push({
      kind: "caution",
      label: "Temperature-zero runs diverged",
      detail: `${d.itemId} at character ${d.charIndex}`,
      tags: ["engine", "fidelity"],
    });
  }

  return findings;
}

/**
 * @param {Array<{ kind: FindingKind, label: string, detail: string, tags: string[] }>} findings
 * @param {ViewId} view
 * @param {number} [limit]
 */
export function filterFindings(findings, view, limit = 16) {
  const score = (f) => {
    const kindRank =
      f.kind === "critical" ? 0 : f.kind === "caution" ? 1 : 2;
    let affinity = 5;
    if (view === "engine") {
      if (f.tags.includes("engine")) affinity = 0;
      else if (f.tags.includes("model")) affinity = 9;
    } else if (view === "user" || view === "model-maker") {
      if (f.tags.includes("agentic") || f.tags.includes("capability"))
        affinity = 0;
      else if (f.tags.includes("must") || f.tags.includes("core"))
        affinity = 1; // still show engine blockers that poison model reads
      else if (f.tags.includes("engine")) affinity = 3;
    } else {
      // overview: critical first, then everything
      affinity = 0;
    }
    return kindRank * 10 + affinity;
  };

  return [...findings].sort((a, b) => score(a) - score(b)).slice(0, limit);
}

// ── conclusions ──────────────────────────────────────────────────────────────

/**
 * @param {any} report
 * @param {ReturnType<typeof buildEngineHealth>} health
 */
function userConclusion(report, health) {
  if (!capabilityMeasured(report)) {
    return `Model capability was not measured (${phaseText(report, "capability")}). ${health.summary}`;
  }
  const cap = report.capability;
  const agentic = report.agentic
    ? `Agentic ${report.agentic.passed}/${report.agentic.total} tasks.`
    : `Agentic was ${phaseText(report, "agentic")}.`;
  const weak =
    (cap.weakCategories?.length ?? 0) > 0
      ? ` Below floor: ${cap.weakCategories.map(categoryLabel).join(", ")}.`
      : " No measured category fell below the floor.";
  return `${cap.verdict} at ${cap.pct}% across ${cap.categories.length} categories. ${agentic}${weak} ${health.summary}`;
}

function engineConclusion(report) {
  const must = mustFailures(report).length;
  const coreMissing = tierOf(report, "core")?.missing?.length ?? 0;
  const extendedMissing = tierOf(report, "extended")?.missing?.length ?? 0;
  if (must === 0 && coreMissing === 0) {
    return `No exercised MUST violations or Core gaps.${extendedMissing > 0 ? ` Extended still missing: ${tierOf(report, "extended").missing.join(", ")}.` : " Inspect Extended/Frontier for remaining surface work."}`;
  }
  const parts = [];
  if (must > 0)
    parts.push(
      `${must} exercised MUST violation${must === 1 ? "" : "s"}`,
    );
  if (coreMissing > 0)
    parts.push(
      `${coreMissing} Core gap${coreMissing === 1 ? "" : "s"}`,
    );
  return `Repair targets: ${parts.join(" and ")}. Findings name the assertions and missing features.`;
}

function modelMakerConclusion(report) {
  if (!capabilityMeasured(report)) {
    return `Capability was not measured (${phaseText(report, "capability")}). Cannot certify the model floor.`;
  }
  const cap = report.capability;
  const agentic = report.agentic
    ? `Agentic bar: ${report.agentic.passed}/${report.agentic.total}.`
    : `Agentic was ${phaseText(report, "agentic")}.`;
  const engine = report.target?.engine
    ? ` Scored on engine “${report.target.engine}” — engine score is independent.`
    : " Engine score is independent of this grade.";
  return `${cap.verdict} (${cap.pct}%). ${agentic}${engine}`;
}

function overviewConclusion(report) {
  const bits = [];
  const core = tierOf(report, "core");
  if (core) bits.push(`Core coverage ${core.pct}%`);
  if (conformanceMeasured(report))
    bits.push(`Conformance ${report.conformance.pct}%`);
  if (capabilityMeasured(report))
    bits.push(
      `Capability ${report.capability.pct}% · ${report.capability.verdict}`,
    );
  if (report.agentic)
    bits.push(`Agentic ${report.agentic.passed}/${report.agentic.total}`);
  if (bits.length === 0) return "No scored phases present in this save.";
  return `${bits.join(" · ")}. Cards stay independent — never averaged.`;
}

// ── section builders ─────────────────────────────────────────────────────────

function coverageSection(report, density) {
  const tiers = (report.coverage?.byTier ?? []).map((t) => ({
    tier: t.tier,
    pct: t.pct,
    ratio: `${t.supported}/${t.total}`,
    missing: t.missing ?? [],
    unprobed: t.unprobed ?? [],
  }));
  const credits = (report.coverage?.credits ?? []).map((c) => ({
    id: c.id,
    label: c.label,
  }));
  return {
    id: "coverage",
    title: "Surface coverage",
    note: "Per tier; missing standards listed on purpose",
    density,
    domain: "engine",
    data: { tiers, credits },
  };
}

function conformanceSection(report, density) {
  const surfaces = report.conformance?.bySurface ?? [];
  const failures = mustFailures(report).map(({ result, failure }) => ({
    test: result.name ?? result.id,
    surface: result.surface,
    assertion: failure.label ?? failure.id,
    message: failure.message ?? "",
  }));
  const counts = outcomeCounts(report);
  return {
    id: "conformance",
    title: "Engine conformance",
    note: "MUST assertions on implemented surfaces only",
    density,
    domain: "engine",
    data: {
      pct: conformanceMeasured(report) ? report.conformance.pct : null,
      passed: report.conformance?.passed ?? 0,
      total: report.conformance?.total ?? 0,
      surfaces,
      failures,
      outcomes: counts,
      warnings: report.conformance?.warnings ?? [],
      nits: report.conformance?.nits ?? [],
      inconclusive: report.conformance?.inconclusive ?? [],
    },
  };
}

function capabilitySection(report, density) {
  const categories = (report.capability?.categories ?? []).map((c) => ({
    category: c.category,
    label: categoryLabel(c.category),
    pct: c.pct,
    passed: c.passed,
    total: c.total,
    belowFloor: c.pct < CATEGORY_FLOOR_PCT,
  }));
  return {
    id: "capability",
    title: "Model capability",
    note: capabilityMeasured(report)
      ? `${report.capability.pct}% · ${report.capability.verdict}`
      : phaseText(report, "capability"),
    density,
    domain: "model",
    data: {
      measured: capabilityMeasured(report),
      pct: capabilityMeasured(report) ? report.capability.pct : null,
      verdict: report.capability?.verdict ?? null,
      categories,
      weakCategories: (report.capability?.weakCategories ?? []).map(
        categoryLabel,
      ),
      unmeasured: (report.capability?.unmeasured ?? []).map(categoryLabel),
      floorPct: CATEGORY_FLOOR_PCT,
      evals: report.capability?.evals ?? [],
    },
  };
}

function agenticSection(report, density) {
  const tasks = (report.agentic?.tasks ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    passed: t.passed,
    steps: t.steps,
    failure: t.failure ?? null,
    failureGloss: t.failure
      ? (AGENTIC_FAILURE_GLOSS[t.failure] ?? t.failure)
      : null,
    detail: t.detail ?? null,
  }));
  /** @type {Record<string, number>} */
  const failureCounts = {};
  for (const t of tasks) {
    if (!t.passed && t.failure) {
      failureCounts[t.failure] = (failureCounts[t.failure] ?? 0) + 1;
    }
  }
  return {
    id: "agentic",
    title: "Agentic work",
    note: report.agentic
      ? `${report.agentic.passed}/${report.agentic.total} tasks`
      : phaseText(report, "agentic"),
    density,
    domain: "model",
    data: {
      measured: Boolean(report.agentic),
      passed: report.agentic?.passed ?? null,
      total: report.agentic?.total ?? null,
      pct: report.agentic?.pct ?? null,
      tasks,
      failureCounts,
      failureGloss: AGENTIC_FAILURE_GLOSS,
    },
  };
}

function fidelitySection(report, density) {
  return {
    id: "fidelity",
    title: "Engine fidelity",
    note: report.fidelity
      ? `${report.fidelity.pct}% · same-model comparisons only`
      : phaseText(report, "fidelity"),
    density,
    domain: "engine",
    data: {
      measured: Boolean(report.fidelity),
      pct: report.fidelity?.pct ?? null,
      slices: report.fidelity?.slices ?? [],
      firstDivergence: report.fidelity?.firstDivergence ?? null,
      unmeasured: report.fidelity?.unmeasured ?? [],
    },
  };
}

function performanceSection(report, density) {
  const bench = report.bench;
  return {
    id: "performance",
    title: "Performance",
    note: bench
      ? "Informational · hardware-dependent · never affects scores or exit code"
      : phaseText(report, "performance"),
    density,
    domain: "deploy",
    data: {
      measured: Boolean(bench),
      decodeTokPerSec: bench?.decodeTokPerSec ?? null,
      ttftMs: bench?.ttftMs ?? null,
      prefillTokPerSec: bench?.prefillTokPerSec ?? null,
      contextScaling: bench?.contextScaling ?? null,
      speculative: bench?.speculative ?? null,
      machine: bench?.machine ?? null,
      loadDrift: bench?.loadDrift ?? null,
      prefixCache: bench?.prefixCache ?? null,
      batching: bench?.batching ?? null,
    },
  };
}

function engineHealthSection(health, density) {
  return {
    id: "engine-health",
    title: "Engine health",
    note: "Compact — full detail in Engine view",
    density,
    domain: "engine",
    data: health,
  };
}

function reproducibilitySection(report, density) {
  return {
    id: "reproducibility",
    title: "How to read this grade",
    note: "Deterministic, no LLM-as-judge",
    density,
    domain: "model",
    data: {
      temperature: 0,
      engine: report.target?.engine ?? null,
      model: report.target?.model ?? null,
      baseUrl: report.target?.baseUrl ?? null,
      disclaimer:
        "Capability and Agentic grade the model under temperature 0 with deterministic checks. Coverage and Conformance grade the engine independently — a weak engine cannot be rescued by a strong model, and vice versa.",
    },
  };
}

// ── signals per view ─────────────────────────────────────────────────────────

/**
 * @param {any} report
 * @param {ReturnType<typeof buildEngineHealth>} health
 */
function userSignals(report, health) {
  /** @type {Array<{ label: string, value: string, detail?: string, tone?: Tone }>} */
  const signals = [
    {
      label: "Capability",
      value: capabilityMeasured(report)
        ? `${report.capability.pct}% · ${report.capability.verdict}`
        : "not measured",
      detail: capabilityMeasured(report)
        ? `${report.capability.categories.length} categories`
        : phaseText(report, "capability"),
      tone: !capabilityMeasured(report)
        ? "neutral"
        : report.capability.verdict === "below-floor"
          ? "critical"
          : report.capability.verdict === "strong"
            ? "good"
            : "good",
    },
    {
      label: "Agentic",
      value: report.agentic
        ? `${report.agentic.passed}/${report.agentic.total}`
        : "not measured",
      detail: report.agentic
        ? `${report.agentic.pct}% of tasks`
        : phaseText(report, "agentic"),
      tone: !report.agentic
        ? "neutral"
        : report.agentic.passed === report.agentic.total
          ? "good"
          : report.agentic.passed === 0
            ? "critical"
            : "caution",
    },
    {
      label: health.label,
      value: health.value,
      detail: health.summary,
      tone: health.tone,
    },
  ];
  return signals;
}

function engineSignals(report) {
  const core = tierOf(report, "core");
  const extended = tierOf(report, "extended");
  const frontier = tierOf(report, "frontier");
  const must = mustFailures(report).length;
  const counts = outcomeCounts(report);
  return [
    {
      label: "Core coverage",
      value: core ? `${core.pct}%` : "not measured",
      detail: core
        ? `${core.supported}/${core.total}${core.missing?.length ? ` · missing ${core.missing.join(", ")}` : ""}`
        : phaseText(report, "coverage"),
      tone: !core ? "neutral" : core.pct === 100 ? "good" : "critical",
    },
    {
      label: "Conformance",
      value: conformanceMeasured(report)
        ? `${report.conformance.pct}%`
        : "not measured",
      detail: conformanceMeasured(report)
        ? `${report.conformance.passed}/${report.conformance.total} MUST`
        : phaseText(report, "conformance"),
      tone: !conformanceMeasured(report)
        ? "neutral"
        : report.conformance.pct === 100
          ? "good"
          : "critical",
    },
    {
      label: "MUST violations",
      value: String(must),
      detail: "exercised assertions",
      tone: must > 0 ? "critical" : "good",
    },
    {
      label: "Inconclusive",
      value: String(counts.inconclusive),
      detail: "not pass, not fail",
      tone: counts.inconclusive > 0 ? "caution" : "neutral",
    },
    {
      label: "Extended",
      value: extended ? `${extended.pct}%` : "—",
      detail: extended?.missing?.length
        ? `missing ${extended.missing.join(", ")}`
        : extended
          ? `${extended.supported}/${extended.total}`
          : undefined,
      tone: "neutral",
    },
    {
      label: "Frontier",
      value: frontier ? `${frontier.pct}%` : "—",
      detail: frontier
        ? `${frontier.supported}/${frontier.total}`
        : undefined,
      tone: "neutral",
    },
  ];
}

function modelMakerSignals(report) {
  return [
    {
      label: "Capability",
      value: capabilityMeasured(report)
        ? `${report.capability.pct}% · ${report.capability.verdict}`
        : "not measured",
      detail: capabilityMeasured(report)
        ? `${report.capability.categories.length} categories`
        : phaseText(report, "capability"),
      tone: !capabilityMeasured(report)
        ? "neutral"
        : report.capability.verdict === "below-floor"
          ? "critical"
          : "good",
    },
    {
      label: "Agentic",
      value: report.agentic
        ? `${report.agentic.passed}/${report.agentic.total}`
        : "not measured",
      detail: report.agentic ? "multi-step workspace tasks" : undefined,
      tone: !report.agentic
        ? "neutral"
        : report.agentic.passed === report.agentic.total
          ? "good"
          : "caution",
    },
    {
      label: "Below floor",
      value: String(report.capability?.weakCategories?.length ?? 0),
      detail:
        (report.capability?.weakCategories?.length ?? 0) > 0
          ? report.capability.weakCategories.map(categoryLabel).join(", ")
          : "none",
      tone:
        (report.capability?.weakCategories?.length ?? 0) > 0
          ? "caution"
          : "good",
    },
    {
      label: "Unmeasured",
      value: String(report.capability?.unmeasured?.length ?? 0),
      detail:
        (report.capability?.unmeasured?.length ?? 0) > 0
          ? report.capability.unmeasured.map(categoryLabel).join(", ")
          : "none required missing",
      tone:
        (report.capability?.unmeasured?.length ?? 0) > 0
          ? "caution"
          : "neutral",
    },
  ];
}

function overviewSignals(report, health) {
  return [
    {
      label: "Coverage (Core)",
      value: tierOf(report, "core")
        ? `${tierOf(report, "core").pct}%`
        : "not measured",
      tone: tierOf(report, "core")?.pct === 100 ? "good" : "caution",
    },
    {
      label: "Conformance",
      value: conformanceMeasured(report)
        ? `${report.conformance.pct}%`
        : "not measured",
      tone:
        conformanceMeasured(report) && report.conformance.pct === 100
          ? "good"
          : conformanceMeasured(report)
            ? "critical"
            : "neutral",
    },
    {
      label: "Capability",
      value: capabilityMeasured(report)
        ? `${report.capability.pct}% · ${report.capability.verdict}`
        : "not measured",
      tone: capabilityMeasured(report)
        ? report.capability.verdict === "below-floor"
          ? "critical"
          : "good"
        : "neutral",
    },
    {
      label: "Agentic",
      value: report.agentic
        ? `${report.agentic.passed}/${report.agentic.total}`
        : "not measured",
      tone: "neutral",
    },
    {
      label: "Engine health",
      value: health.value,
      tone: health.tone,
    },
  ];
}

// ── public: single report card ───────────────────────────────────────────────

/**
 * @param {any} report
 */
export function buildIdentity(report) {
  const t = report.target ?? {};
  const machine = report.bench?.machine
    ? [
        report.bench.machine.cpu,
        report.bench.machine.memGB != null
          ? `${report.bench.machine.memGB} GB`
          : null,
        [report.bench.machine.platform, report.bench.machine.arch]
          .filter(Boolean)
          .join(" "),
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  const meta = [];
  if (report.run?.depth) meta.push({ key: "depth", value: report.run.depth });
  if (report.run?.mode) meta.push({ key: "mode", value: report.run.mode });
  if (report.run?.startedAt)
    meta.push({ key: "started", value: report.run.startedAt });
  if (machine) meta.push({ key: "machine", value: machine });
  if (report.run?.budget?.limitTokens) {
    meta.push({
      key: "budget",
      value: `${report.run.budget.limitTokens.toLocaleString()} tokens${report.run.budget.exhausted ? " · exhausted" : ""}`,
    });
  }
  if (report.durationMs != null) {
    meta.push({
      key: "duration",
      value: `${Math.round(report.durationMs / 1000)}s`,
    });
  }

  return {
    model: t.model ?? "unknown model",
    engine: t.engine ?? null,
    baseUrl: t.baseUrl ?? null,
    subtitle: [t.engine, t.baseUrl].filter(Boolean).join(" · "),
    meta,
  };
}

/**
 * Build the full multi-view report card model for one JsonReport.
 * @param {any} report
 */
export function buildReportCard(report) {
  const identity = buildIdentity(report);
  const health = buildEngineHealth(report);
  const allFindings = buildAllFindings(report);

  /** @type {Record<ViewId, object>} */
  const views = {
    user: {
      id: "user",
      ...VIEW_META.user,
      conclusion: userConclusion(report, health),
      signals: userSignals(report, health),
      findings: filterFindings(allFindings, "user"),
      sections: [
        engineHealthSection(health, "hero"),
        capabilitySection(report, "body"),
        agenticSection(report, "body"),
        performanceSection(
          report,
          report.bench ? "body" : "collapsed",
        ),
        coverageSection(report, "collapsed"),
        conformanceSection(report, "collapsed"),
        fidelitySection(report, "collapsed"),
      ],
    },
    engine: {
      id: "engine",
      ...VIEW_META.engine,
      conclusion: engineConclusion(report),
      signals: engineSignals(report),
      findings: filterFindings(allFindings, "engine"),
      sections: [
        coverageSection(report, "body"),
        conformanceSection(report, "body"),
        fidelitySection(report, report.fidelity ? "body" : "collapsed"),
        capabilitySection(report, "collapsed"),
        agenticSection(report, "collapsed"),
        performanceSection(report, "collapsed"),
      ],
    },
    "model-maker": {
      id: "model-maker",
      ...VIEW_META["model-maker"],
      conclusion: modelMakerConclusion(report),
      signals: modelMakerSignals(report),
      findings: filterFindings(allFindings, "model-maker"),
      sections: [
        capabilitySection(report, "body"),
        agenticSection(report, "body"),
        reproducibilitySection(report, "body"),
        engineHealthSection(health, "collapsed"),
        coverageSection(report, "collapsed"),
        conformanceSection(report, "collapsed"),
        fidelitySection(report, "collapsed"),
        performanceSection(report, "collapsed"),
      ],
    },
    overview: {
      id: "overview",
      ...VIEW_META.overview,
      conclusion: overviewConclusion(report),
      signals: overviewSignals(report, health),
      findings: filterFindings(allFindings, "overview", 24),
      sections: [
        coverageSection(report, "body"),
        conformanceSection(report, "body"),
        capabilitySection(report, "body"),
        agenticSection(report, "body"),
        fidelitySection(report, report.fidelity ? "body" : "collapsed"),
        performanceSection(
          report,
          report.bench ? "body" : "collapsed",
        ),
      ],
    },
  };

  return {
    version: 1,
    defaultView: DEFAULT_VIEW,
    identity,
    engineHealth: health,
    views,
    // raw pointers for generators that still need full report fields
    principles: {
      neverBlend:
        "Coverage, Conformance, Capability, and Agentic are independent cards. Never average them.",
      benchInformational:
        "Performance never affects scores or exit codes.",
      outcomeHonesty:
        "fail ≠ unsupported ≠ inconclusive ≠ not measured ≠ unprobed.",
    },
  };
}

// ── compare: axis + history narrative ────────────────────────────────────────

/**
 * @param {Array<{ label: string, report: any }>} inputs
 */
export function detectCompareAxis(inputs) {
  const models = new Set(
    inputs.map((i) => i.report.target?.model ?? "").filter(Boolean),
  );
  const engines = new Set(
    inputs.map(
      (i) =>
        i.report.target?.engine ?? i.report.target?.baseUrl ?? "",
    ).filter(Boolean),
  );
  if (models.size === 1 && engines.size > 1)
    return {
      axis: "engines",
      summary: "Same model, different engines",
    };
  if (engines.size === 1 && models.size > 1)
    return {
      axis: "models",
      summary: "Same engine, different models",
    };
  if (models.size === 1 && engines.size === 1)
    return {
      axis: "versions",
      summary: "Same model and engine — treat as before/after or depth change",
    };
  return { axis: "mixed", summary: "Mixed models and engines" };
}

/**
 * @param {Array<{ label: string, report: any }>} inputs
 */
export function machinesComparable(inputs) {
  const keys = inputs.map((i) => {
    const m = i.report.bench?.machine;
    if (!m) return null;
    return [m.cpu, m.memGB, m.platform, m.arch].join("|");
  });
  const present = keys.filter((k) => k != null);
  if (present.length < 2) return { comparable: false, reason: "insufficient machine metadata" };
  const allSame = present.every((k) => k === present[0]);
  return allSame
    ? { comparable: true, reason: null }
    : { comparable: false, reason: "different hardware" };
}

/**
 * Deterministic “What changed” lines. Only diffs measured pairs.
 * @param {Array<{ label: string, report: any }>} inputs
 */
export function buildHistoryNarrative(inputs) {
  if (inputs.length < 2) {
    return { axis: null, lead: "Need at least two runs to narrate change.", lines: [] };
  }

  const ordered = [...inputs].sort((a, b) => {
    const ta = a.report.run?.startedAt ?? "";
    const tb = b.report.run?.startedAt ?? "";
    if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
    return 0; // stable: keep input order when no timestamps
  });

  const axis = detectCompareAxis(ordered);
  /** @type {string[]} */
  const lines = [];

  const first = ordered[0];
  const last = ordered[ordered.length - 1];

  const deltaPct = (a, b, label) => {
    if (a == null || b == null) return;
    if (a === b) {
      lines.push(`${label} stayed ${a}% (${first.label} → ${last.label}).`);
      return;
    }
    const d = Math.round((b - a) * 10) / 10;
    const sign = d > 0 ? "+" : "";
    lines.push(
      `${label} ${a}% → ${b}% (${sign}${d}pp) · ${first.label} → ${last.label}.`,
    );
  };

  // Coverage tiers
  for (const tier of ["core", "extended", "frontier"]) {
    const a = tierOf(first.report, tier)?.pct ?? null;
    const b = tierOf(last.report, tier)?.pct ?? null;
    if (a != null && b != null && a !== b) {
      deltaPct(a, b, `Coverage ${tier}`);
    }
  }

  // Conformance
  if (
    conformanceMeasured(first.report) &&
    conformanceMeasured(last.report)
  ) {
    deltaPct(
      first.report.conformance.pct,
      last.report.conformance.pct,
      "Conformance",
    );
  }

  // Capability
  if (
    capabilityMeasured(first.report) &&
    capabilityMeasured(last.report)
  ) {
    const va = first.report.capability.verdict;
    const vb = last.report.capability.verdict;
    const pa = first.report.capability.pct;
    const pb = last.report.capability.pct;
    if (va === vb && pa === pb) {
      lines.push(`Capability stayed ${va} at ${pa}%.`);
    } else if (va === vb) {
      deltaPct(pa, pb, `Capability (${va})`);
    } else {
      lines.push(
        `Capability ${va} ${pa}% → ${vb} ${pb}% · ${first.label} → ${last.label}.`,
      );
    }

    // Categories that crossed the floor
    const mapA = new Map(
      (first.report.capability.categories ?? []).map((c) => [
        c.category,
        c.pct,
      ]),
    );
    for (const c of last.report.capability.categories ?? []) {
      const prev = mapA.get(c.category);
      if (prev == null) continue;
      const wasBelow = prev < CATEGORY_FLOOR_PCT;
      const nowBelow = c.pct < CATEGORY_FLOOR_PCT;
      if (wasBelow && !nowBelow) {
        lines.push(
          `${categoryLabel(c.category)} recovered above floor (${prev}% → ${c.pct}%).`,
        );
      } else if (!wasBelow && nowBelow) {
        lines.push(
          `${categoryLabel(c.category)} fell below floor (${prev}% → ${c.pct}%).`,
        );
      }
    }
  }

  // Agentic
  if (first.report.agentic && last.report.agentic) {
    const a = first.report.agentic;
    const b = last.report.agentic;
    if (a.passed !== b.passed || a.total !== b.total) {
      lines.push(
        `Agentic ${a.passed}/${a.total} → ${b.passed}/${b.total} · ${first.label} → ${last.label}.`,
      );
    }
    const byId = new Map((a.tasks ?? []).map((t) => [t.id, t]));
    for (const t of b.tasks ?? []) {
      const prev = byId.get(t.id);
      if (!prev) continue;
      if (prev.passed && !t.passed) {
        lines.push(
          `Task “${t.name}” regressed${t.failure ? ` (${t.failure})` : ""}.`,
        );
      } else if (!prev.passed && t.passed) {
        lines.push(
          `Task “${t.name}” recovered${prev.failure ? ` from ${prev.failure}` : ""}.`,
        );
      } else if (
        !prev.passed &&
        !t.passed &&
        prev.failure &&
        t.failure &&
        prev.failure !== t.failure
      ) {
        lines.push(
          `Task “${t.name}” failure ${prev.failure} → ${t.failure}.`,
        );
      }
    }
  }

  // MUST count
  const mustA = mustFailures(first.report).length;
  const mustB = mustFailures(last.report).length;
  if (mustA !== mustB) {
    lines.push(
      `MUST violations ${mustA} → ${mustB} · ${first.label} → ${last.label}.`,
    );
  }

  if (lines.length === 0) {
    lines.push(
      "No measured score deltas between the first and last run in this set.",
    );
  }

  const machines = machinesComparable(ordered);
  return {
    axis: axis.axis,
    lead: axis.summary,
    orderedLabels: ordered.map((i) => i.label),
    lines,
    machines,
  };
}

/**
 * Which scorecard metric ids belong to which compare intent tab.
 * Values are stable ids the compare renderer can map to rows.
 */
export const COMPARE_METRIC_GROUPS = {
  user: [
    "capability",
    "agentic",
    "engine-health-core",
    "engine-health-conformance",
    "decode",
    "ttft",
    "prefill",
  ],
  engine: [
    "coverage-core",
    "coverage-extended",
    "coverage-frontier",
    "conformance",
    "must-violations",
    "fidelity",
  ],
  "model-maker": [
    "capability",
    "agentic",
    "capability-categories",
    "weak-categories",
  ],
};

/**
 * @param {Array<{ label: string, report: any }>} inputs
 */
export function buildCompareModel(inputs) {
  return {
    version: 1,
    defaultTab: "user",
    axis: detectCompareAxis(inputs),
    history: buildHistoryNarrative(inputs),
    machines: machinesComparable(inputs),
    metricGroups: COMPARE_METRIC_GROUPS,
    runs: inputs.map((i) => ({
      label: i.label,
      identity: buildIdentity(i.report),
      engineHealth: buildEngineHealth(i.report),
      card: buildReportCard(i.report),
    })),
  };
}
