import { buildCodeContext } from "./corpus";

export function agentSessionPrefix(seed: string, bytes: number): string {
  return (
    `[agent-session prefix ${JSON.stringify(seed)}]\n` +
    "You are maintaining a TypeScript service. Each user turn contains a new backlog item " +
    "and scripted read_file/search/test-output bundles. These are prerecorded fixtures, " +
    "not results of executing your code. No tools are available. Reply with the requested " +
    "code or review directly, without requesting tools. Earlier tasks may be incomplete " +
    "because generation was capped; work on the current item.\n\nReference project:\n" +
    buildCodeContext(bytes)
  );
}

const TASKS = [
  {
    name: "validation",
    ask: "Write a new validateJob(input: unknown) function with runtime checks for every field and typed errors. Output the new function, not the existing Job or Queue declarations.",
    cap: 256,
  },
  {
    name: "retry",
    ask: "Write a new scheduleRetry function with capped exponential backoff, jitter, cancellation and injectable clocks. Add at least 12 detailed tests. Output new implementation and tests, not a copy of the queue source.",
    cap: 1024,
  },
  {
    name: "review",
    ask: "List three concrete risks in this queue: starvation, mutation hazards and boundary conditions. For each give a failing example and proposed fix. Reply in prose; do not reproduce the source code.",
    cap: 256,
  },
  {
    name: "tests",
    ask: "Write a new Vitest test module importing this Queue. Include at least 20 test cases covering empty queues, duplicate IDs, priority ties, time boundaries and cancellation. Output fixtures and assertions in full, not the Queue implementation.",
    cap: 1024,
  },
];

function source(id: number): string {
  return `// src/queue-${id}.ts
export interface Job${id} {
  id: string;
  priority: number;
  attempts: number;
  nextRunAt: number;
  cancelled: boolean;
  payload: Readonly<Record<string, unknown>>;
}

export class Queue${id} {
  private jobs = new Map<string, Job${id}>();

  put(job: Job${id}): void {
    this.jobs.set(job.id, job);
  }

  take(now: number): Job${id} | undefined {
    const eligible = [...this.jobs.values()]
      .filter(job => !job.cancelled && job.nextRunAt <= now)
      .sort((left, right) => right.priority - left.priority);
    const next = eligible[0];
    if (next) this.jobs.delete(next.id);
    return next;
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.cancelled = true;
    return true;
  }
}

`;
}

/** Fixed task recipe, with fresh modules so a backlog can grow for many turns. */
export function agentSessionTask(turn: number) {
  const task = TASKS[(turn - 1) % TASKS.length]!;
  const bundleTokens = turn % 2 ? 256 : 2048;
  const pieces: string[] = [];
  let bytes = 0;
  for (let i = 0; bytes < bundleTokens * 4; i += 1) {
    const piece = source(turn * 1000 + i);
    pieces.push(piece);
    bytes += piece.length;
  }
  const id = turn * 1000;
  return {
    name: task.name,
    bundleTokens,
    maxTokens: task.cap,
    text:
      `[agent-session turn ${turn}]\nBacklog item: ${task.name} for Queue${id}.\n` +
      `Scripted read_file bundle (related queue modules):\n\`\`\`typescript\n${pieces.join("")}\`\`\`\n` +
      `Scripted search result: src/queue-${id}.ts: Queue${id}.take sorts eligible jobs by priority.\n` +
      "Prerecorded test condition: equal-priority jobs must retain insertion order; retries must not run before nextRunAt. " +
      `These conditions have not been evaluated against your previous response.\n\nCurrent task for Queue${id}: ${task.ask}`,
  };
}
