import { appendFileSync, closeSync, mkdirSync, openSync } from "node:fs";
import { createHash } from "node:crypto";
import { LANGUAGE_RUBRIC } from "./rubric";
import { dirname } from "node:path";
import { LANGUAGE_CASES, type LanguageCase } from "./cases";

export interface LanguageOptions {
  root: string;
  model: string;
  save: string;
  apiKey?: string;
  concurrency?: number;
  maxTokens?: number;
  timeoutMs?: number;
  cases?: LanguageCase[];
  log?: (line: string) => void;
}
/** A separate review artifact: language quality cannot be graded by exact matching. */
export async function runLanguage(options: LanguageOptions) {
  const { root, model, save } = options;
  const concurrency = options.concurrency ?? 4;
  const maxTokens = options.maxTokens ?? 500;
  if (
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    !Number.isSafeInteger(maxTokens) ||
    maxTokens < 1
  )
    throw new Error("Concurrency and maxTokens must be positive integers");
  const cases = options.cases ?? LANGUAGE_CASES;
  mkdirSync(dirname(save), { recursive: true });
  const fd = openSync(save, "wx"); // Refuse to overwrite an earlier response log.
  closeSync(fd);
  const startedAt = new Date().toISOString();
  const settings = {
    model,
    concurrency,
    maxTokens,
    temperature: 0,
    top_p: 1,
    reasoning_effort: "none",
    enable_thinking: false,
    enable_mtp: false,
    enable_pld: false,
    top_k: 0,
    seed: 20261002,
    timeoutMs: options.timeoutMs ?? 600000,
  };
  appendFileSync(
    save,
    JSON.stringify({
      type: "manifest",
      schema: "llmprobe-language-v1",
      startedAt,
      root,
      settings,
      cases,
      casesSha256: createHash("sha256")
        .update(JSON.stringify(cases))
        .digest("hex"),
      rubric: LANGUAGE_RUBRIC,
    }) + "\n",
  );
  let next = 0,
    completed = 0,
    errors = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, cases.length) }, async () => {
      while (next < cases.length) {
        const tc = cases[next++]!;
        const request = {
          model,
          messages: [{ role: "user", content: tc.prompt }],
          max_tokens: maxTokens,
          temperature: 0,
          top_p: 1,
          seed: 20261002,
          reasoning_effort: "none",
          enable_thinking: false,
          enable_mtp: false,
          enable_pld: false,
          top_k: 0,
          stream: false,
        };
        const start = Date.now();
        let result: Record<string, unknown>;
        try {
          const response = await fetch(
            `${root.replace(/\/$/, "")}/v1/chat/completions`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(options.apiKey
                  ? { Authorization: `Bearer ${options.apiKey}` }
                  : {}),
              },
              body: JSON.stringify(request),
              signal: AbortSignal.timeout(options.timeoutMs ?? 600000),
            },
          );
          const raw = await response.text();
          if (!response.ok) throw new Error(`HTTP ${response.status}: ${raw}`);
          const body = JSON.parse(raw);
          if (
            typeof body?.choices?.[0]?.message?.content !== "string" ||
            !body.choices[0].message.content.trim()
          )
            throw new Error(`Missing nonempty answer: ${raw}`);
          result = { status: "ok", response: body };
        } catch (error) {
          errors++;
          result = { status: "error", error: String(error) };
        }
        appendFileSync(
          save,
          JSON.stringify({
            type: "response",
            ...tc,
            request,
            ...result,
            durationMs: Date.now() - start,
          }) + "\n",
        );
        completed++;
        options.log?.(
          `[${completed}/${cases.length}] ${tc.id} ${result.status} ${((Date.now() - start) / 1000).toFixed(1)}s`,
        );
      }
    }),
  );
  const summary = {
    type: "summary",
    completed,
    errors,
    finishedAt: new Date().toISOString(),
    save,
  };
  appendFileSync(save, JSON.stringify(summary) + "\n");
  return summary;
}
