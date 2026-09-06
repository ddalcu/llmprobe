import { effortNote, type ReasoningReport } from "../../../reasoning/types";
import { esc } from "./shared";

const STATUS_LABEL: Record<string, string> = {
  passed: "pass",
  failed: "wrong",
  stopped: "out of tokens",
  error: "error",
};

export function reasoningCard(r: ReasoningReport): string {
  const pct = r.total > 0 ? Math.round((100 * r.passed) / r.total) : 0;
  return `<article class="card neutral">
      <div class="card-kicker">Reasoning</div>
      <div class="card-value">${pct}%</div>
      <div class="card-sub">
        <span>${r.passed}/${r.total} correct</span>
        ${r.stopped ? `<span class="badge">${r.stopped} out of tokens</span>` : ""}
      </div>
      <div class="card-note">GPQA Diamond, SuperGPQA, AIME 2025, COMPSEC subsets. Informational — never scored.</div>
    </article>`;
}

export function reasoningSection(r: ReasoningReport): string {
  const rows = r.bySource
    .map(
      (s) => `<tr>
        <td>${esc(s.source)}</td>
        <td>${s.passed}/${s.total}</td>
        <td>${s.total ? Math.round((100 * s.passed) / s.total) : 0}%</td>
        <td>${s.stopped}</td>
        <td>${s.error}</td>
      </tr>`,
    )
    .join("\n");
  const cases = r.cases
    .map(
      (
        c,
      ) => `<tr class="${c.status === "passed" ? "good" : c.status === "stopped" ? "caution" : "bad"}">
        <td>${esc(c.source)}</td>
        <td>${esc(c.domain)}</td>
        <td>${esc(c.title)}</td>
        <td>${esc(STATUS_LABEL[c.status] ?? c.status)}</td>
        <td>${esc(c.got)}</td>
        <td>${esc(c.expected)}</td>
        <td>${c.outputTokens ?? "—"}</td>
      </tr>`,
    )
    .join("\n");
  return `    <section class="section" id="reasoning">
      <div class="section-head">
        <h2>Reasoning <span class="tag model">model</span></h2>
        <div class="score">${r.passed}/${r.total}</div>
      </div>
      <p class="lede">Hard-question accuracy, informational and never scored. The ${r.suite} suite, up to ${r.maxTokens} tokens per question at temperature ${r.temperature}${effortNote(r)}. "Out of tokens" means the answer line never came, which is a budget fact, not a wrong answer.</p>
      ${r.scopeNote ? `<p class="fine">⚠ ${esc(r.scopeNote)}</p>` : ""}
      <div class="conf-table-wrap">
        <table class="drill-table">
          <thead><tr><th>Source</th><th>Correct</th><th>Accuracy</th><th>Out of tokens</th><th>Errors</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <details style="margin-top:12px">
        <summary class="hint-click">Every question</summary>
        <div class="conf-table-wrap">
          <table class="drill-table">
            <thead><tr><th>Source</th><th>Domain</th><th>Question</th><th>Result</th><th>Got</th><th>Expected</th><th>Output tokens</th></tr></thead>
            <tbody>${cases}</tbody>
          </table>
        </div>
      </details>
    </section>`;
}
