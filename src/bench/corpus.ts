/**
 * A synthetic TypeScript codebase, used as the context the ladder measures over.
 *
 * The ladder used to fill its prompts with one sentence repeated to size, and
 * that quietly broke the measurement: summarising a few thousand copies of
 * "The quick brown fox" is *highly* predictable output, so the rung baseline
 * was already collecting a speculation boost. Runs came back with more context
 * decoding faster than none — 53.8 tok/s at the 512 rung against 44.1 with no
 * context at all — which is not a thing that happens to a real engine.
 *
 * So the filler is source code: varied identifiers, imports, types, comments,
 * the attention pattern of an actual agent's context window rather than of one
 * sentence stamped out N times. Deterministic, so a rung is reproducible and
 * the byte-to-token fit stays stable across runs.
 */

const DOMAINS = [
  "order",
  "invoice",
  "shipment",
  "ledger",
  "session",
  "device",
  "channel",
  "tariff",
  "manifest",
  "quota",
];

const VERBS = [
  "resolve",
  "normalise",
  "validate",
  "reconcile",
  "expand",
  "prune",
  "merge",
  "index",
];

const capitalise = (s: string): string => s[0]!.toUpperCase() + s.slice(1);

const article = (word: string): string => (/^[aeiou]/i.test(word) ? "an" : "a");

/**
 * Four shapes in rotation. One template repeated would drift back towards the
 * degenerate filler this replaced — what matters is that the model cannot
 * predict the next module from the last one.
 */
function module(i: number): string {
  const domain = DOMAINS[i % DOMAINS.length]!;
  const verb = VERBS[Math.floor(i / DOMAINS.length) % VERBS.length]!;
  const Name = capitalise(domain);
  const fn = `${verb}${Name}`;

  switch (i % 4) {
    case 0:
      return `// src/${domain}/${verb}.ts
import { Clock } from "../runtime/clock";
import type { ${Name}Record } from "./types";

/** ${capitalise(verb)} ${article(domain)} ${domain} against the ledger, dropping expired entries. */
export function ${fn}(input: ${Name}Record, clock: Clock): ${Name}Record | null {
  const cutoff = clock.now() - input.windowMs;
  if (input.updatedAt < cutoff) return null;
  return { ...input, ${verb}dAt: clock.now(), revision: input.revision + 1 };
}

`;
    case 1:
      return `// src/${domain}/types.ts
export interface ${Name}Record {
  id: string;
  revision: number;
  updatedAt: number;
  windowMs: number;
  tags: readonly string[];
}

export const EMPTY_${domain.toUpperCase()}: ${Name}Record = {
  id: "",
  revision: 0,
  updatedAt: 0,
  windowMs: ${1000 + i * 7},
  tags: [],
};

`;
    case 2:
      return `// src/${domain}/${verb}-batch.ts
import { ${fn} } from "./${verb}";
import type { ${Name}Record } from "./types";

/**
 * Batch form of \`${fn}\`. Returns only the records that survived, so callers
 * can compare lengths rather than scanning for nulls.
 */
export async function ${fn}Batch(
  records: readonly ${Name}Record[],
  concurrency = ${2 + (i % 6)},
): Promise<${Name}Record[]> {
  const out: ${Name}Record[] = [];
  for (let i = 0; i < records.length; i += concurrency) {
    const slice = records.slice(i, i + concurrency);
    out.push(...slice.filter((r) => r.revision >= 0));
  }
  return out;
}

`;
    default:
      return `// src/${domain}/${verb}.test.ts
import { describe, expect, test } from "vitest";
import { ${fn} } from "./${verb}";

describe("${fn}", () => {
  test("drops a record older than its window", () => {
    const clock = { now: () => ${10_000 + i * 13} };
    const stale = { id: "${domain}-${i}", revision: 1, updatedAt: 0, windowMs: 5, tags: [] };
    expect(${fn}(stale, clock)).toBeNull();
  });
});

`;
  }
}

/** Deterministic TypeScript source of approximately `bytes` bytes. */
export function buildCodeContext(bytes: number): string {
  if (bytes <= 0) return "";
  const out: string[] = [];
  let length = 0;
  for (let i = 0; length < bytes; i += 1) {
    const piece = module(i);
    out.push(piece);
    length += piece.length;
  }
  return out.join("").slice(0, bytes);
}

/**
 * The constant the rung's task has to go and find. Planted as a real-looking
 * config module rather than as a prose notice, so reaching it is the same work
 * an agent does: locate a value in the codebase and use it in what it writes.
 */
export const PLANTED_CONSTANT = "RETRY_BUDGET_MS";
export const PLANTED_VALUE = 7413;

const PLANTED_MODULE = `// src/config/retry-budget.ts
/** Total wall clock a retry loop may spend before giving up. */
export const ${PLANTED_CONSTANT} = ${PLANTED_VALUE};

`;

/** `bytes` of source with the config module buried in the middle of it. */
export function buildCodeContextWithConstant(bytes: number): string {
  const filler = buildCodeContext(bytes);
  const half = Math.floor(filler.length / 2);
  // Split on a *module* boundary — the blank line between files. A bare
  // newline lands inside a JSDoc block often enough that the constant ends up
  // commented out, which is not something the model can then use.
  const gap = filler.indexOf("\n\n", half);
  const cut = gap === -1 ? filler.length : gap + 2;
  return `${filler.slice(0, cut)}${PLANTED_MODULE}${filler.slice(cut)}`;
}

/** Did the answer actually use the value it had to go and find? */
export function usedPlantedConstant(text: string): boolean {
  return (
    text.includes(PLANTED_CONSTANT) || text.includes(String(PLANTED_VALUE))
  );
}
