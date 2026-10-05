import { createHash } from "node:crypto";

import type { ResponseFormat, ToolDef } from "../core/adapter";
import { fail, type Graded, pass, stripThinking } from "../evals/grading";
import type { CallRecord } from "./coding";
import type { AgenticTaskDef } from "./index";

/**
 * The mock world behind the tool-use scenarios, ported from tool-eval-bench
 * (https://github.com/SeraphimSerapis/tool-eval-bench, MIT): its twelve
 * universal tools, the 52-tool crowded namespace, its system prompt and fixed
 * reference date, and the text checks its graders share.
 */

/** Every relative date in the scenarios resolves against this Friday. */
export const REFERENCE_DATE = "2026-03-20";

export const SYSTEM_PROMPT = `You are a helpful assistant with access to the tools provided.

Rules:
- Use a tool ONLY when it is necessary to fulfill the user's request.
- If you can answer directly from your own knowledge, do so without calling a tool.
- If a tool call fails, explain the failure and suggest an alternative approach.
- Never invent information that a tool should provide.

Benchmark context: today is ${REFERENCE_DATE} (Friday). Use this date for any relative time request.`;

const STRING = { type: "string" };

export const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): ToolDef => ({
  name,
  description,
  parameters: {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  },
});

// prettier-ignore
const LANGUAGES = [
  "english", "en", "en-us", "en-gb", "en-ca", "en-au",
  "spanish", "es", "es-es", "es-419", "espanol", "español", "castilian", "spa",
  "japanese", "ja", "ja-jp", "日本語", "jpn",
  "german", "de", "deutsch",
];

export const UNIVERSAL_TOOLS: ToolDef[] = [
  tool(
    "web_search",
    "Search the web for current information",
    { query: STRING, max_results: { type: "integer", default: 5 } },
    ["query"],
  ),
  tool(
    "get_weather",
    "Get current weather for a specific location",
    {
      location: STRING,
      units: {
        type: "string",
        enum: ["celsius", "fahrenheit"],
        default: "celsius",
      },
    },
    ["location"],
  ),
  tool(
    "calculator",
    "Perform mathematical calculations",
    { expression: STRING },
    ["expression"],
  ),
  tool(
    "send_email",
    "Send an email to a recipient",
    {
      to: STRING,
      subject: STRING,
      body: STRING,
      cc: { type: "string", description: "CC recipient email address" },
      bcc: { type: "string", description: "BCC recipient email address" },
      attachments: { type: "array", items: STRING, default: [] },
    },
    ["to", "subject", "body"],
  ),
  tool(
    "search_files",
    "Search for files by name or content",
    {
      query: STRING,
      file_type: {
        type: "string",
        enum: ["pdf", "docx", "xlsx", "any"],
        default: "any",
      },
    },
    ["query"],
  ),
  tool(
    "read_file",
    "Read the contents of a specific file",
    { file_id: STRING },
    ["file_id"],
  ),
  tool(
    "create_calendar_event",
    "Create a new calendar event",
    {
      title: STRING,
      date: { type: "string", description: "Format: YYYY-MM-DD" },
      time: { type: "string", description: "Format: HH:MM" },
      timezone: {
        type: "string",
        description:
          "IANA timezone (e.g. Europe/Berlin, America/New_York). Defaults to UTC.",
        default: "UTC",
      },
      duration_minutes: { type: "integer", default: 60 },
      attendees: { type: "array", items: STRING, default: [] },
    },
    ["title", "date", "time"],
  ),
  tool("get_contacts", "Look up contacts by name or group", { query: STRING }, [
    "query",
  ]),
  tool(
    "translate_text",
    "Translate text from one language to another",
    {
      text: STRING,
      source_language: { type: "string", enum: LANGUAGES },
      // tool-eval-bench never translates into a regional English variant.
      target_language: {
        type: "string",
        enum: LANGUAGES.filter((l) => !/^en-/.test(l)),
      },
    },
    ["text", "source_language", "target_language"],
  ),
  tool(
    "get_stock_price",
    "Get the current stock price for a ticker symbol",
    { ticker: STRING },
    ["ticker"],
  ),
  tool(
    "set_reminder",
    "Set a reminder for a future time",
    {
      message: STRING,
      datetime: { type: "string", description: "Format: ISO 8601" },
    },
    ["message", "datetime"],
  ),
  tool(
    "run_code",
    "Execute a code snippet and return the output",
    {
      language: { type: "string", enum: ["python", "javascript"] },
      code: STRING,
    },
    ["language", "code"],
  ),
];

const ENVIRONMENTS = { type: "string", enum: ["staging", "production"] };
const PRIORITIES = {
  type: "string",
  enum: ["low", "medium", "high", "critical"],
};
const OBJECTS = { type: "array", items: { type: "object" } };

// prettier-ignore
/** The universal twelve plus forty domain tools, CRM to content: 52 in all. */
export const LARGE_TOOLS: ToolDef[] = [
  ...UNIVERSAL_TOOLS,
  tool("get_customer_profile", "Retrieve a customer's profile by name or customer ID", { customer_id: { type: "string", description: "Customer ID or full name" }, include_history: { type: "boolean", default: false } }, ["customer_id"]),
  tool("update_customer", "Update a customer's profile fields", { customer_id: STRING, fields: { type: "object", description: "Key-value pairs to update" } }, ["customer_id", "fields"]),
  tool("create_ticket", "Create a support ticket for a customer issue", { customer_id: STRING, subject: STRING, description: STRING, priority: PRIORITIES }, ["customer_id", "subject", "description"]),
  tool("resolve_ticket", "Resolve an existing support ticket", { ticket_id: STRING, resolution_notes: STRING }, ["ticket_id", "resolution_notes"]),
  tool("get_order_status", "Get the current status of a customer order", { order_id: { type: "string", description: "Order ID or customer name" }, include_tracking: { type: "boolean", default: true } }, ["order_id"]),
  tool("get_shipping_status", "Get shipping and tracking details for a shipment", { tracking_number: STRING, carrier: { type: "string", enum: ["fedex", "ups", "usps", "dhl"] } }, ["tracking_number"]),
  tool("create_return", "Initiate a return/refund for an order", { order_id: STRING, reason: STRING, refund_method: { type: "string", enum: ["original", "store_credit"] } }, ["order_id", "reason"]),
  tool("list_tickets", "List open support tickets, optionally filtered by customer or priority", { customer_id: { type: "string", description: "Filter by customer ID" }, priority: PRIORITIES, status: { type: "string", enum: ["open", "in_progress", "resolved"] } }, []),
  tool("get_invoice", "Retrieve an invoice by invoice ID", { invoice_id: STRING }, ["invoice_id"]),
  tool("create_invoice", "Create a new invoice for a customer", { customer_id: STRING, items: OBJECTS, due_date: { type: "string", description: "Format: YYYY-MM-DD" } }, ["customer_id", "items"]),
  tool("process_payment", "Process a payment against an invoice", { invoice_id: STRING, amount: { type: "number" }, method: { type: "string", enum: ["credit_card", "bank_transfer", "crypto"] } }, ["invoice_id", "amount"]),
  tool("get_account_balance", "Get the current account balance for a customer or account", { account_id: STRING }, ["account_id"]),
  tool("transfer_funds", "Transfer funds between accounts", { from_account: STRING, to_account: STRING, amount: { type: "number" }, currency: { type: "string", default: "USD" } }, ["from_account", "to_account", "amount"]),
  tool("generate_financial_report", "Generate a financial report for a given period", { report_type: { type: "string", enum: ["income", "balance_sheet", "cash_flow"] }, start_date: STRING, end_date: STRING }, ["report_type", "start_date", "end_date"]),
  tool("deploy_service", "Deploy a service to production or staging environment", { service_name: STRING, version: STRING, environment: ENVIRONMENTS }, ["service_name", "version", "environment"]),
  tool("rollback_deploy", "Rollback a deployment to the previous version", { service_name: STRING, environment: ENVIRONMENTS }, ["service_name", "environment"]),
  tool("get_service_health", "Check the health and status of a running service", { service_name: STRING, environment: ENVIRONMENTS }, ["service_name"]),
  tool("list_containers", "List running containers for a service", { service_name: STRING, status_filter: { type: "string", enum: ["running", "stopped", "all"] } }, ["service_name"]),
  tool("scale_service", "Scale a service up or down by adjusting replica count", { service_name: STRING, replicas: { type: "integer" }, environment: ENVIRONMENTS }, ["service_name", "replicas"]),
  tool("get_logs", "Retrieve logs for a service or container", { service_name: STRING, lines: { type: "integer", default: 100 }, level: { type: "string", enum: ["debug", "info", "warn", "error"] } }, ["service_name"]),
  tool("restart_service", "Restart a running service", { service_name: STRING, environment: ENVIRONMENTS, graceful: { type: "boolean", default: true } }, ["service_name"]),
  tool("get_employee", "Look up employee details by name or employee ID", { employee_id: STRING }, ["employee_id"]),
  tool("submit_timesheet", "Submit a weekly timesheet for an employee", { employee_id: STRING, week_start: { type: "string", description: "Format: YYYY-MM-DD" }, hours: { type: "number" } }, ["employee_id", "week_start", "hours"]),
  tool("request_leave", "Submit a leave/vacation request", { employee_id: STRING, start_date: STRING, end_date: STRING, type: { type: "string", enum: ["vacation", "sick", "personal"] } }, ["employee_id", "start_date", "end_date"]),
  tool("get_payslip", "Get a payslip for an employee for a specific month", { employee_id: STRING, month: { type: "string", description: "Format: YYYY-MM" } }, ["employee_id", "month"]),
  tool("get_org_chart", "Retrieve the organizational chart for a department", { department: STRING, include_contractors: { type: "boolean", default: false } }, ["department"]),
  tool("query_database", "Execute a read-only SQL query against the analytics database", { query: STRING, database: { type: "string", enum: ["analytics", "reporting", "warehouse"] } }, ["query"]),
  tool("export_csv", "Export query results to a CSV file", { query: STRING, filename: STRING }, ["query", "filename"]),
  tool("create_dashboard", "Create a new analytics dashboard", { title: STRING, widgets: OBJECTS }, ["title"]),
  tool("run_analytics", "Run a predefined analytics pipeline", { pipeline_name: STRING, parameters: { type: "object" } }, ["pipeline_name"]),
  tool("get_metrics", "Get system or business metrics for a time range", { metric_name: STRING, start_time: STRING, end_time: STRING, granularity: { type: "string", enum: ["minute", "hour", "day", "week"] } }, ["metric_name"]),
  tool("send_slack_message", "Send a message to a Slack channel or user", { channel: STRING, message: STRING, thread_ts: { type: "string", description: "Thread timestamp for replies" } }, ["channel", "message"]),
  tool("create_channel", "Create a new Slack channel", { name: STRING, purpose: STRING, is_private: { type: "boolean", default: false } }, ["name"]),
  tool("schedule_meeting", "Schedule a meeting with participants via calendar integration", { title: STRING, participants: { type: "array", items: STRING }, datetime: STRING, duration_minutes: { type: "integer", default: 30 } }, ["title", "participants", "datetime"]),
  tool("get_meeting_notes", "Retrieve notes from a past meeting", { meeting_id: STRING }, ["meeting_id"]),
  tool("post_announcement", "Post a company-wide announcement", { title: STRING, body: STRING, audience: { type: "string", enum: ["all", "engineering", "management"] } }, ["title", "body"]),
  tool("publish_page", "Publish a wiki or documentation page", { title: STRING, content: STRING, space: STRING }, ["title", "content"]),
  tool("draft_blog_post", "Create a draft blog post", { title: STRING, body: STRING, tags: { type: "array", items: STRING } }, ["title", "body"]),
  tool("upload_asset", "Upload a file or media asset to the asset library", { file_path: STRING, category: { type: "string", enum: ["images", "documents", "videos"] } }, ["file_path"]),
  tool("get_content_calendar", "Retrieve the content publication calendar for a given week", { week_start: { type: "string", description: "Format: YYYY-MM-DD" } }, ["week_start"]),
];

/** Calls that change something outside the conversation; the rest only read. */
export const WRITE_TOOLS = [
  "send_email",
  "create_calendar_event",
  "set_reminder",
  "run_code",
] as const;
export type WriteTool = (typeof WRITE_TOOLS)[number];

/**
 * Arithmetic only: + - * / %, unary signs, parentheses. The calculator mock
 * evaluates exactly what Python's `ast` subset in tool-eval-bench accepts, so
 * a thousands separator or `^` is an invalid expression here too.
 */
export function calculate(expression: string): number | null {
  const tokens = expression.match(/\d*\.?\d+(?:e[+-]?\d+)?|[-+*/%()]|\S/gi);
  if (!tokens) return null;
  let i = 0;
  const expr = (): number => {
    let value = term();
    while (tokens[i] === "+" || tokens[i] === "-")
      value = tokens[i++] === "+" ? value + term() : value - term();
    return value;
  };
  const term = (): number => {
    let value = factor();
    while (tokens[i] === "*" || tokens[i] === "/" || tokens[i] === "%") {
      const op = tokens[i++];
      const rhs = factor();
      value = op === "*" ? value * rhs : op === "/" ? value / rhs : value % rhs;
    }
    return value;
  };
  const factor = (): number => {
    const token = tokens[i++];
    if (token === "-") return -factor();
    if (token === "+") return factor();
    if (token === "(") {
      const value = expr();
      if (tokens[i++] !== ")") throw new Error("unbalanced");
      return value;
    }
    if (token !== undefined && /^\d*\.?\d+(?:e[+-]?\d+)?$/i.test(token))
      return Number(token);
    throw new Error("unexpected token");
  };
  try {
    const value = expr();
    return i === tokens.length && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * What a tool the scenario does not script returns: the calculator still
 * calculates and a search still returns something; anything else is
 * irrelevant to the task, which the model has to cope with.
 */
export function fallback(
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (name === "calculator") {
    const result = calculate(str(args.expression));
    return result === null ? { error: "Invalid expression." } : { result };
  }
  if (name === "web_search")
    return { results: [{ snippet: `Search results for ${str(args.query)}` }] };
  if (name === "run_code")
    return { error: "Code execution is disabled in benchmark mocks." };
  return { error: `Tool ${name} is not relevant for this scenario.` };
}

// ── Realistic payloads ────────────────────────────────────────────────────
// tool-eval-bench wraps every mock result in the metadata a real API returns
// (ids, timestamps, pagination, nested objects), so the model has to pick the
// field it needs out of a noisy payload. Deterministic, and the scenario's own
// fields always win.

const seedOf = (payload: object, salt: string) =>
  parseInt(
    createHash("md5")
      .update(`${salt}:${JSON.stringify(payload)}`)
      .digest("hex")
      .slice(0, 8),
    16,
  );
const seeded = (prefix: string, seed: number) =>
  `${prefix}${seed.toString(16).padStart(8, "0")}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

const PADDING: Record<string, (p: Record<string, any>) => object> = {
  get_weather: (p) => {
    const seed = seedOf(p, "weather");
    const temperature = Number(p.temperature ?? 0);
    return {
      ...p,
      wind_speed_kmh: 14.2 + (seed % 20) / 10,
      wind_direction: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][seed % 8],
      uv_index: Math.max(1, seed % 6),
      visibility_km: 9.8,
      pressure_hpa: 1008 + (seed % 20),
      feels_like: temperature - 2,
      dew_point: temperature - 5,
      forecast_summary:
        "Conditions expected to remain similar for the next 6 hours.",
      last_updated: "2026-03-20T12:00:00Z",
      data_source: "National Weather Service",
      station_id: seeded("WXSTN-", seed),
      request_id: seeded("req_wx_", seed),
    };
  },
  web_search: (p) => {
    const seed = seedOf(p, "search");
    return {
      results: (p.results ?? []).map((r: object, i: number) => ({
        ...r,
        url: `https://example.com/result/${i + 1}`,
        rank: i + 1,
        relevance_score: round2(0.95 - i * 0.05),
        published_date: "2026-03-18",
        source_domain: "example.com",
        language: "en",
      })),
      total_results: 1200 + (seed % 200),
      page: 1,
      per_page: 5,
      query_time_ms: 30 + (seed % 40),
      source_engine: "web-index-v3",
      cached: false,
      safe_search: true,
      related_queries: ["similar topic", "related question"],
      request_id: seeded("req_ws_", seed),
    };
  },
  search_files: (p) => ({
    results: (p.results ?? []).map((r: Record<string, any>) => ({
      ...r,
      size_bytes: 28_416,
      modified_at: "2026-03-15T09:22:11Z",
      created_at: "2026-02-10T14:00:00Z",
      owner: "system",
      path: `/documents/${r.name ?? "unknown"}`,
      permissions: "read",
      content_type: "application/octet-stream",
    })),
    total_matches: (p.results ?? []).length,
    search_time_ms: 18,
    index_version: "idx-2026.03",
    request_id: "req_fs_3d4a8e2b",
  }),
  read_file: (p) => {
    const content = typeof p.content === "string" ? p.content : "";
    return {
      ...p,
      encoding: "utf-8",
      mime_type: "text/plain",
      size_bytes: Buffer.byteLength(content),
      last_modified: "2026-03-15T09:22:11Z",
      version: 3,
      permissions: { read: true, write: false },
      line_count: content.split("\n").length,
      request_id: "req_rf_1b5c7d3e",
    };
  },
  send_email: (p) => ({
    ...p,
    timestamp: "2026-03-20T12:05:33Z",
    thread_id: "thread_e9a1f4c2",
    headers: {
      "X-Mailer": "mailer/1.0",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Priority": "3",
    },
    delivery_status: "accepted",
    queue_position: 0,
    estimated_delivery: "2026-03-20T12:05:35Z",
    request_id: "req_em_5f2a9c1d",
  }),
  create_calendar_event: (p) => ({
    ...p,
    calendar_id: "cal_primary",
    created_at: "2026-03-20T12:00:00Z",
    updated_at: "2026-03-20T12:00:00Z",
    organizer: { email: "user@company.com", display_name: "Current User" },
    reminders: { use_default: true, overrides: [] },
    conference_link: null,
    visibility: "default",
    color_id: "7",
    recurrence: null,
    request_id: "req_ce_4a1d8b3f",
  }),
  get_contacts: (p) => ({
    results: (p.results ?? []).map((r: Record<string, any>, i: number) => ({
      id: `contact_${1000 + i}`,
      department: "Engineering",
      phone: "+1-555-0100",
      last_contacted: "2026-03-18T15:30:00Z",
      notes: "",
      source: "directory",
      // A declared role is the contact's title; don't contradict it.
      ...(r.role || r.title ? {} : { title: "Team Member" }),
      ...r,
    })),
    total_contacts: (p.results ?? []).length,
    directory_version: "2026.03",
    request_id: "req_ct_6e3b2a1c",
  }),
  get_stock_price: (p) => {
    const price = Number(p.price ?? 0);
    return {
      ...p,
      timestamp: "2026-03-20T16:00:00Z",
      exchange: "NASDAQ",
      volume: 52_314_800,
      market_cap: "2.89T",
      pe_ratio: 28.4,
      day_high: round2(price * 1.012),
      day_low: round2(price * 0.988),
      week_52_high: round2(price * 1.25),
      week_52_low: round2(price * 0.72),
      // Consistent with a declared change, so the payload does not contradict itself.
      previous_close: round2(
        price - (p.change !== undefined ? Number(p.change) : 1.23),
      ),
      after_hours: null,
      request_id: "req_sp_8c1d4e2a",
    };
  },
  translate_text: (p) => {
    const text = typeof p.translated === "string" ? p.translated : "";
    return {
      ...p,
      source_detected: "en",
      confidence: 0.98,
      alternatives: [],
      word_count: text.split(/\s+/).filter(Boolean).length,
      character_count: [...text].length,
      api_version: "v3.1",
      model: "nmt-2026",
      request_id: "req_tr_2b7a5d1e",
    };
  },
  run_code: (p) => ({
    ...p,
    execution_time_ms: 12,
    memory_used_kb: 2048,
    sandbox_id: "sandbox_f3a1c9d2",
    runtime_version: "3.11.8",
    cpu_time_ms: 8,
    wall_time_ms: 14,
    request_id: "req_rc_9d3f1a2c",
  }),
  set_reminder: (p) => ({
    ...p,
    created_at: "2026-03-20T12:00:00Z",
    notification_channels: ["push", "email"],
    repeat: null,
    priority: "normal",
    request_id: "req_rm_4c2a1d3b",
  }),
};

/** A mock result as a real API would return it; errors get error metadata. */
export function pad(name: string, payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload))
    return payload;
  const p = payload as Record<string, any>;
  if ("error" in p) {
    const seed = seedOf(p, "error");
    // A scenario's own code (ROOM_TAKEN) is what the model reads to decide on
    // a retry, so it is kept.
    const code = String(p.error_code ?? "ERR_TOOL_UNAVAILABLE");
    return {
      ...p,
      error_code: code,
      timestamp: "2026-03-20T12:00:00Z",
      trace_id: seeded("trace_", seed),
      documentation_url: `https://docs.example.com/errors/${code}`,
      request_id: seeded("req_err_", seed),
    };
  }
  return PADDING[name]?.(p) ?? p;
}

// ── Scenarios as agentic tasks ────────────────────────────────────────────

export interface Scenario {
  id: string;
  name: string;
  prompt: string;
  /** Scripted user turns, one each time the model stops. */
  followUps?: string[];
  /** Defaults to the twelve universal tools. */
  tools?: ToolDef[];
  responseFormat?: ResponseFormat;
  /** Model requests allowed; defaults to 8. */
  maxSteps?: number;
  /** Write tools the task asks for, and how many calls each; the rest allow none. */
  writes?: Partial<Record<WriteTool, number>>;
  /**
   * The scenario's API; undefined falls through to the generic mock. `state`
   * starts empty each run, for APIs whose answers depend on earlier writes.
   */
  mock?(
    name: string,
    args: Record<string, unknown>,
    calls: CallRecord[],
    state: Record<string, any>,
  ): unknown;
  grade(run: Run): Graded;
}

export function toTask(s: Scenario): AgenticTaskDef {
  const tools = s.tools ?? UNIVERSAL_TOOLS;
  // One state per run: the runner hands every call of a run the same array.
  const states = new WeakMap<CallRecord[], Record<string, any>>();
  const stateOf = (calls: CallRecord[]) => {
    if (!states.has(calls)) states.set(calls, {});
    return states.get(calls)!;
  };
  return {
    id: s.id,
    name: s.name,
    prompt: s.prompt,
    files: {},
    tools,
    system: SYSTEM_PROMPT,
    responseFormat: s.responseFormat,
    maxSteps: s.maxSteps ?? 8,
    handle: (name, args, calls) =>
      JSON.stringify(
        pad(
          name,
          tools.some((t) => t.name === name)
            ? (s.mock?.(name, args, calls, stateOf(calls)) ??
                fallback(name, args))
            : { error: `Unknown tool ${name}.` },
        ),
      ),
    followUp: s.followUps && ((_files, round) => s.followUps![round] ?? null),
    grade: (_files, answer, trajectory) => {
      const t = trajectory!; // the runner always passes it
      const run: Run = {
        calls: t.calls,
        answers: t.answers,
        answer,
        transcript: t.texts.join("\n"),
      };
      const graded = s.grade(run);
      if (!graded.passed) return graded;
      const extra = WRITE_TOOLS.filter(
        (w) => named(run, w).length > (s.writes?.[w] ?? 0),
      );
      return extra.length
        ? fail(
            `also called ${extra.join(", ")}, which the task did not ask for`,
          )
        : graded;
    },
  };
}

// ── What the graders see ──────────────────────────────────────────────────

export interface Run {
  calls: CallRecord[];
  /** The model's reply each time it stopped calling tools, one per user turn. */
  answers: string[];
  /** The last of `answers`; "" when the step cap cut the run short. */
  answer: string;
  /** Everything the model said, tool-calling turns included. */
  transcript: string;
}

/** A tool argument as text; numbers count, anything else is "". */
export const str = (value: unknown): string =>
  typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : "";

/** Case-insensitive substring test on an argument or answer. */
export const has = (value: unknown, needle: string): boolean =>
  str(value).toLowerCase().includes(needle.toLowerCase());

export const arg = (call: CallRecord, key: string): string =>
  str(call.args?.[key]);

export const named = (
  run: Run,
  name: string,
  match: (call: CallRecord) => boolean = () => true,
): CallRecord[] => run.calls.filter((c) => c.name === name && match(c));

/** Calls to any tool not named. */
export const otherThan = (run: Run, ...names: string[]): CallRecord[] =>
  run.calls.filter((c) => !names.includes(c.name));

/**
 * Did `call` come after `earlier`'s result? Calls in one batch share a step,
 * and a call batched beside the one it depends on could not have seen it.
 */
export const after = (call: CallRecord, earlier: CallRecord): boolean =>
  call.step > earlier.step;

/** Was the address returned by a lookup before this call used it? */
export const observed = (run: Run, call: CallRecord, address: string) =>
  run.calls.some(
    (c) => c.step < call.step && c.output.toLowerCase().includes(address),
  );

/** The call's result as the model saw it, parsed; {} when it is not JSON. */
export function payload(call: CallRecord): Record<string, any> {
  try {
    const value = JSON.parse(call.output);
    return typeof value === "object" && value !== null ? value : {};
  } catch {
    return {};
  }
}

/** The call came back without an error. */
export const succeeded = (call: CallRecord) => !("error" in payload(call));

/**
 * The text says this, not "did not" or "couldn't" say it: a match counts
 * unless its clause negates it in the few words before.
 */
export function affirms(text: string, phrase: string | RegExp): boolean {
  const low = text.toLowerCase().replace(/’/g, "'");
  const pattern =
    typeof phrase === "string"
      ? new RegExp(
          `\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
          "g",
        )
      : new RegExp(phrase.source, `${phrase.flags.replace("g", "")}g`);
  return [...low.matchAll(pattern)].some((m) => {
    const clause = low
      .slice(0, m.index)
      .split(/[.!?;\n]/)
      .pop()!;
    return !/(?:\b(?:not|never|no|nothing|without|cannot|unable to)\b|n't)(?:\s+\S+){0,4}\s*$/.test(
      clause,
    );
  });
}

/**
 * tool-eval-bench's milestone grading, made binary: any minefield fails the
 * run with its name; otherwise every milestone must be reached.
 */
export function checklist(
  milestones: Array<[reached: boolean, name: string]>,
  minefields: Array<[triggered: boolean, name: string]> = [],
): Graded {
  const stepped = minefields.filter(([hit]) => hit).map(([, name]) => name);
  if (stepped.length) return fail(stepped.join("; "));
  const missing = milestones.filter(([hit]) => !hit).map(([, name]) => name);
  return missing.length ? fail(`never ${missing.join("; never ")}`) : pass();
}

/** Every recipient of an email, across to, cc and bcc. */
export const recipients = (call: CallRecord): string[] =>
  ["to", "cc", "bcc"].flatMap((key) => {
    const value = call.args?.[key];
    const list = Array.isArray(value) ? value.map(str) : [str(value)];
    return list
      .flatMap((v) => v.split(/[,;]/))
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
  });

/**
 * The number appears in the text as a number: thousands separators ignored,
 * and "187" is in "$187.42" but not in "1870".
 */
export const saysNumber = (text: string, value: string): boolean =>
  new RegExp(`(?<![\\d.])${value.replace(/[.]/g, "\\.")}(?!\\d)`).test(
    text.replace(/(\d),(?=\d{3})/g, "$1"),
  );

/** "14:00", "2pm", "2:00 PM" → "14:00"; null when it is not a clock time. */
export function clock(value: string): string | null {
  const m = value
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(?:([ap])\.?m\.?)?$/);
  if (!m || (!m[2] && !m[3])) return null;
  const hour = m[3]
    ? (Number(m[1]) % 12) + (m[3] === "p" ? 12 : 0)
    : Number(m[1]);
  return hour > 23 ? null : `${String(hour).padStart(2, "0")}:${m[2] ?? "00"}`;
}

/** An ISO date-time on this date at this clock time, whatever the offset. */
export const at = (value: string, date: string, time: string): boolean => {
  const m = value.trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2})/);
  return m?.[1] === date && clock(m[2]!) === time;
};

/** The whole reply parses as JSON — no fences, no prose around it. */
export function json(text: string): unknown {
  try {
    return JSON.parse(stripThinking(text).trim());
  } catch {
    return undefined;
  }
}

/**
 * The first way a value breaks a JSON schema, or null when it fits. Covers
 * what the structured-output scenarios use: types, enums, required keys,
 * additionalProperties: false, arrays of a type.
 */
export function schemaError(
  value: unknown,
  schema: Record<string, any>,
  path = "$",
): string | null {
  if (schema.enum && !schema.enum.includes(value))
    return `${path} is ${JSON.stringify(value)}, not one of ${schema.enum.join(", ")}`;
  const type = Array.isArray(value)
    ? "array"
    : value === null
      ? "null"
      : typeof value;
  const fits =
    schema.type === "integer" ? Number.isInteger(value) : schema.type === type;
  if (schema.type && !fits) return `${path} must be a ${schema.type}`;
  if (type === "array" && schema.items) {
    for (const [i, item] of (value as unknown[]).entries()) {
      const error = schemaError(item, schema.items, `${path}[${i}]`);
      if (error) return error;
    }
  }
  if (type === "object" && schema.properties) {
    const object = value as Record<string, unknown>;
    for (const key of schema.required ?? [])
      if (!(key in object)) return `${path} is missing "${key}"`;
    for (const [key, item] of Object.entries(object)) {
      const sub = schema.properties[key];
      if (!sub) {
        if (schema.additionalProperties === false)
          return `${path} has an extra field "${key}"`;
        continue;
      }
      const error = schemaError(item, sub, `${path}.${key}`);
      if (error) return error;
    }
  }
  return null;
}

// ── Reading intent out of free text ───────────────────────────────────────
// Phrase lists from tool-eval-bench's helpers, which were tuned across model
// families (Qwen, Gemma, Mistral, Phi, Command-R).

// prettier-ignore
const REFUSALS = [
  "cannot", "can't", "can not", "couldn't", "could not", "not able", "unable to",
  "won't", "will not", "do not have", "don't have", "lack the", "unfortunately",
  "i'm sorry", "i am sorry", "i apologize", "i'm afraid", "i am afraid",
  "regrettably", "not possible", "no way to", "not supported", "not available",
  "no tool", "no capability", "no such tool", "no function", "beyond my",
  "outside my", "out of scope", "beyond the scope", "outside the scope",
  "not something i", "isn't something i", "isn't part of", "is not part of",
  "isn't within", "is not within", "no appropriate tool", "no suitable tool",
  "doesn't exist", "does not exist", "isn't available", "not in my toolset",
  "not in the available", "no matching tool", "i must decline",
  "i need to decline", "not equipped", "falls outside", "goes beyond",
  "not within my capabilities", "exceeds my", "not designed to",
  "i don't support", "i do not support", "no mechanism", "no means to",
  "i must refrain", "i should not", "instead, i can", "however, i can",
  "what i can do", "alternatively", "haven't got", "didn't have",
];

export const refuses = (text: string): boolean => {
  const low = stripThinking(text)
    .toLowerCase()
    .replace(/[*_`’]/g, (c) => (c === "’" ? "'" : ""));
  return REFUSALS.some((phrase) => low.includes(phrase));
};

// prettier-ignore
const CLARIFICATIONS = [
  "which", "clarify", "could you", "can you tell me", "what is the",
  "who should", "where should", "did you mean", "do you mean",
  "please provide", "please specify", "please confirm", "please let me know",
  "need more information", "more details", "would you mind",
  "help me understand", "would you like me to", "would you prefer",
  "i'd need to know", "i would need to know", "is that correct", "am i right",
  "just to confirm", "to make sure", "before i proceed", "before proceeding",
  "ambiguous", "multiple options", "not sure which", "unclear which",
  "several possibilities", "can you elaborate", "what do you mean",
  "be more specific", "specify which", "to clarify", "for clarity",
  "i want to make sure", "i need to confirm", "a few options",
  "a couple of options", "what kind of",
];

export const asksClarification = (text: string): boolean => {
  const low = stripThinking(text).toLowerCase().replace(/’/g, "'");
  return (
    /\b(?:what\s+(?:time|date|day)|when\s+(?:is|are|should|would|could|can|do|does|will))\b/.test(
      low,
    ) || CLARIFICATIONS.some((phrase) => low.includes(phrase))
  );
};
