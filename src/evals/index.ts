import type { ChatRequest, ToolDef } from "../core/adapter";
import { buildHaystackWithNeedle, tryParseJson } from "../core/assert";
import type { EvalDef, RunContext } from "../core/context";
import { BOOKING_TOOL, TIME_TOOL, WEATHER_TOOL } from "../conformance/fixtures";
import {
  expectNumber,
  expectWord,
  fail,
  type Graded,
  normalize,
  parseStrictJson,
  pass,
  saysWord,
  stripThinking,
} from "./grading";

/**
 * Model capability — a floor check, not an intelligence benchmark.
 *
 * Calibrated so a 12B-class model (Gemma-12B, Qwen-9B+) clears the bar. We are
 * asking "is this model semi-capable enough to build on": does it pick the right
 * tool, does it *refrain* from picking one when it shouldn't, does it emit JSON
 * that parses, does it remember what you told it two turns ago.
 *
 * On sampling: the tool and JSON evals run at k=3 **with temperature 0.7**, not
 * 0. That is deliberate. At temperature 0 a deterministic engine returns three
 * identical samples and k=3 measures nothing but token spend. Real applications
 * sample, and a model that picks the right tool two times in three is a
 * materially different proposition from one that does it every time — that
 * reliability figure is the most useful single fact about a local model, and it
 * only exists if we let the model sample. Everything else runs k=1 at
 * temperature 0, where reproducibility matters more than reliability.
 */

const SAMPLING_TEMP = 0.7;
const DETERMINISTIC_TEMP = 0;

const TOOL_MENU: ToolDef[] = [
  WEATHER_TOOL,
  TIME_TOOL,
  BOOKING_TOOL,
  {
    name: "send_email",
    description: "Send an email to a recipient.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["to", "subject", "body"],
      additionalProperties: false,
    },
  },
];

async function ask(ctx: RunContext, request: ChatRequest) {
  const surface = ctx.evalSurface;
  if (!surface) throw new Error("no chat-shaped surface available for evals");
  const res = await ctx.send(surface, request);

  // Grade the answer, never the scratchpad. A reasoning model may consider and
  // discard the right answer mid-thought; scoring that text would be nonsense.
  return { ...res.reply, text: stripThinking(res.reply.text) };
}

// ── 1. Tool selection ───────────────────────────────────────────────────────

const toolSelection: EvalDef[] = [
  {
    id: "eval-tool-select-weather",
    name: "picks the weather tool from a menu of decoys",
    category: "tool-selection",
    k: 3,
    requiresFeature: "tools",
    async run(ctx) {
      const reply = await ask(ctx, {
        turns: [
          { type: "user", text: "What's the weather like in Paris right now?" },
        ],
        tools: TOOL_MENU,
        temperature: SAMPLING_TEMP,
        maxTokens: 128,
      });

      const call = reply.toolCalls[0];
      if (!call) return fail("called no tool at all");
      if (call.name !== WEATHER_TOOL.name) {
        return fail(`called "${call.name}" instead of get_weather`);
      }

      const args = tryParseJson(call.argsJson);
      if (!args.ok) return fail("tool arguments were not valid JSON");

      const city = String((args.value as Record<string, unknown>)?.city ?? "");
      return saysWord(city, "paris")
        ? pass()
        : fail(`passed city="${city}" instead of Paris`);
    },
  },
  {
    id: "eval-tool-select-time",
    name: "distinguishes the time tool from the weather tool",
    category: "tool-selection",
    k: 3,
    requiresFeature: "tools",
    async run(ctx) {
      const reply = await ask(ctx, {
        turns: [{ type: "user", text: "What time is it in Tokyo?" }],
        tools: TOOL_MENU,
        temperature: SAMPLING_TEMP,
        maxTokens: 128,
      });

      const call = reply.toolCalls[0];
      if (!call) return fail("called no tool at all");
      return call.name === TIME_TOOL.name
        ? pass()
        : fail(`called "${call.name}" instead of get_time`);
    },
  },
];

// ── 2. Tool restraint ───────────────────────────────────────────────────────

const toolRestraint: EvalDef[] = [
  {
    id: "eval-tool-restraint-chitchat",
    name: "does not reach for a tool during small talk",
    category: "tool-restraint",
    k: 3,
    requiresFeature: "tools",
    async run(ctx) {
      // The failure small models make constantly: tools are in scope, so they
      // call one, whatever was actually asked.
      const reply = await ask(ctx, {
        turns: [{ type: "user", text: "Hello! How are you doing today?" }],
        tools: TOOL_MENU,
        temperature: SAMPLING_TEMP,
        maxTokens: 64,
      });

      return reply.toolCalls.length === 0
        ? pass()
        : fail(
            `called "${reply.toolCalls[0]!.name}" in response to small talk`,
          );
    },
  },
  {
    id: "eval-tool-restraint-knowledge",
    name: "answers from knowledge instead of calling an irrelevant tool",
    category: "tool-restraint",
    k: 3,
    requiresFeature: "tools",
    async run(ctx) {
      const reply = await ask(ctx, {
        turns: [{ type: "user", text: "What is the capital of France?" }],
        tools: TOOL_MENU,
        temperature: SAMPLING_TEMP,
        maxTokens: 64,
      });

      if (reply.toolCalls.length > 0) {
        return fail(
          `called "${reply.toolCalls[0]!.name}" for a question it already knows the answer to`,
        );
      }
      return expectWord(reply.text, "paris", "capital of France");
    },
  },
];

// ── 3. Tool argument fidelity ───────────────────────────────────────────────

const toolArgs: EvalDef[] = [
  {
    id: "eval-tool-args-typed",
    name: "fills typed arguments with the right types",
    category: "tool-args",
    k: 3,
    requiresFeature: "tools",
    async run(ctx) {
      const reply = await ask(ctx, {
        turns: [
          {
            type: "user",
            text: "Book me a table at Chez Nous for 4 people, outdoors please.",
          },
        ],
        tools: [BOOKING_TOOL],
        temperature: SAMPLING_TEMP,
        maxTokens: 128,
      });

      const call = reply.toolCalls[0];
      if (!call) return fail("called no tool");

      const parsed = tryParseJson(call.argsJson);
      if (!parsed.ok) return fail("arguments were not valid JSON");

      const args = parsed.value as Record<string, unknown>;
      if (args.party_size !== 4)
        return fail(
          `party_size was ${JSON.stringify(args.party_size)}, expected 4`,
        );
      if (args.outdoor !== true)
        return fail(
          `outdoor was ${JSON.stringify(args.outdoor)}, expected true`,
        );
      return pass();
    },
  },
  {
    id: "eval-tool-args-enum",
    name: "respects an enum constraint in the tool schema",
    category: "tool-args",
    k: 3,
    requiresFeature: "tools",
    async run(ctx) {
      const reply = await ask(ctx, {
        turns: [
          {
            type: "user",
            text: "What's the weather in Miami? Give it to me in fahrenheit.",
          },
        ],
        tools: [WEATHER_TOOL],
        temperature: SAMPLING_TEMP,
        maxTokens: 128,
      });

      const call = reply.toolCalls[0];
      if (!call) return fail("called no tool");

      const parsed = tryParseJson(call.argsJson);
      if (!parsed.ok) return fail("arguments were not valid JSON");

      const unit = (parsed.value as Record<string, unknown>)?.unit;
      return unit === "fahrenheit"
        ? pass()
        : fail(
            `unit was ${JSON.stringify(unit)}, expected the enum value "fahrenheit"`,
          );
    },
  },
];

// ── 4. Multi-turn state ─────────────────────────────────────────────────────

const multiturn: EvalDef[] = [
  {
    id: "eval-multiturn-recall",
    name: "recalls a fact from an earlier turn",
    category: "multiturn",
    async run(ctx) {
      const reply = await ask(ctx, {
        turns: [
          {
            type: "user",
            text: "My name is Ada and I have a dog called Byron.",
          },
          { type: "assistant-text", text: "Nice to meet you, Ada!" },
          {
            type: "user",
            text: "What is my dog's name? Reply with just the name.",
          },
        ],
        temperature: DETERMINISTIC_TEMP,
        maxTokens: 16,
      });

      return expectWord(reply.text, "byron", "dog's name");
    },
  },
  {
    id: "eval-multiturn-tool-result",
    name: "uses a tool result instead of inventing an answer",
    category: "multiturn",
    requiresFeature: "tools",
    async run(ctx) {
      // A model that ignores the tool result and hallucinates weather is worse
      // than useless in an agent loop — it looks like it's working.
      const reply = await ask(ctx, {
        turns: [
          { type: "user", text: "What's the weather in Paris?" },
          {
            type: "assistant-tool-call",
            call: {
              id: "call_1",
              name: WEATHER_TOOL.name,
              argsJson: '{"city":"Paris"}',
            },
          },
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: WEATHER_TOOL.name,
            output: '{"temp_c": 18, "conditions": "rain"}',
          },
        ],
        tools: [WEATHER_TOOL],
        temperature: DETERMINISTIC_TEMP,
        maxTokens: 96,
      });

      const usesTemp = /\b18\b/.test(reply.text);
      const usesConditions = /rain/i.test(reply.text);
      return usesTemp || usesConditions
        ? pass()
        : fail(
            `ignored the tool result (18°C, rain): "${reply.text.slice(0, 80)}"`,
          );
    },
  },
  {
    id: "eval-multiturn-system",
    name: "keeps honoring the system prompt after several turns",
    category: "multiturn",
    async run(ctx) {
      const reply = await ask(ctx, {
        turns: [
          { type: "user", text: "Hello." },
          { type: "assistant-text", text: "Hello! BANANA" },
          { type: "user", text: "What is 2 + 2?" },
        ],
        system: "You must end every single reply with the word BANANA.",
        temperature: DETERMINISTIC_TEMP,
        maxTokens: 32,
      });

      return /banana\s*[.!]?\s*$/i.test(reply.text.trim())
        ? pass()
        : fail(`dropped the system constraint: "${reply.text.slice(0, 80)}"`);
    },
  },
];

// ── 5. Instruction following ────────────────────────────────────────────────

const instructions: EvalDef[] = [
  {
    id: "eval-instructions-exact",
    name: "reproduces an exact requested string",
    category: "instructions",
    async run(ctx) {
      const reply = await ask(ctx, {
        turns: [
          {
            type: "user",
            text: "Reply with exactly this word and nothing else: ACKNOWLEDGED",
          },
        ],
        temperature: DETERMINISTIC_TEMP,
        maxTokens: 16,
      });

      return normalize(reply.text) === "acknowledged"
        ? pass()
        : fail(
            `expected exactly "ACKNOWLEDGED", got "${reply.text.slice(0, 60)}"`,
          );
    },
  },
  {
    id: "eval-instructions-negative",
    name: "honors a negative constraint",
    category: "instructions",
    async run(ctx) {
      const reply = await ask(ctx, {
        turns: [
          { type: "user", text: "List three fruits. Do not mention bananas." },
        ],
        temperature: DETERMINISTIC_TEMP,
        maxTokens: 64,
      });

      return saysWord(reply.text, "banana") || saysWord(reply.text, "bananas")
        ? fail("mentioned bananas after being told not to")
        : pass();
    },
  },
  {
    id: "eval-instructions-length",
    name: "obeys a one-word length constraint",
    category: "instructions",
    async run(ctx) {
      const reply = await ask(ctx, {
        turns: [
          {
            type: "user",
            text: "What is the capital of Japan? Answer in exactly one word.",
          },
        ],
        temperature: DETERMINISTIC_TEMP,
        maxTokens: 16,
      });

      const words = normalize(reply.text).split(" ").filter(Boolean);
      if (!saysWord(reply.text, "tokyo")) {
        return fail(`wrong answer: "${reply.text.slice(0, 60)}"`);
      }
      return words.length === 1
        ? pass()
        : fail(
            `asked for one word, got ${words.length}: "${reply.text.slice(0, 60)}"`,
          );
    },
  },
];

// ── 6. JSON discipline ──────────────────────────────────────────────────────

const jsonDiscipline: EvalDef[] = [
  {
    id: "eval-json-no-fences",
    name: "emits raw JSON without markdown fences when told to",
    category: "json-discipline",
    k: 3,
    async run(ctx) {
      // Graded WITHOUT stripping fences: wrapping the JSON in ```json when
      // explicitly told not to is exactly the failure being measured.
      const reply = await ask(ctx, {
        turns: [
          {
            type: "user",
            text: 'Return ONLY a raw JSON object with keys "name" (string) and "age" (number). No markdown, no code fences, no explanation.',
          },
        ],
        temperature: SAMPLING_TEMP,
        maxTokens: 128,
      });

      const parsed = parseStrictJson(reply.text);
      if (!parsed.ok) return fail(parsed.reason ?? "did not return raw JSON");

      const value = parsed.value as Record<string, unknown>;
      if (typeof value?.name !== "string")
        return fail("`name` was not a string");
      if (typeof value?.age !== "number") return fail("`age` was not a number");
      return pass();
    },
  },
  {
    id: "eval-json-nested",
    name: "produces a nested JSON structure on request",
    category: "json-discipline",
    k: 3,
    async run(ctx) {
      const reply = await ask(ctx, {
        turns: [
          {
            type: "user",
            text: 'Return ONLY raw JSON: {"user": {"name": string, "pets": [string, string]}}. No fences, no prose.',
          },
        ],
        temperature: SAMPLING_TEMP,
        maxTokens: 192,
      });

      const parsed = parseStrictJson(reply.text);
      if (!parsed.ok) return fail(parsed.reason ?? "did not return raw JSON");

      const user = (parsed.value as Record<string, any>)?.user;
      if (typeof user?.name !== "string") return fail("missing user.name");
      if (!Array.isArray(user?.pets) || user.pets.length !== 2) {
        return fail(
          `user.pets was ${JSON.stringify(user?.pets)}, expected two strings`,
        );
      }
      return pass();
    },
  },
];

// ── 7. Long-context recall ──────────────────────────────────────────────────

const longContext: EvalDef[] = [
  {
    id: "eval-long-context-needle",
    name: "finds a needle buried in 16KB of filler",
    category: "long-context",
    slow: true,
    async run(ctx) {
      const haystack = buildHaystackWithNeedle({
        fillerBytes: 16_384,
        needle: "The launch code is `quasar-471`.",
        position: "middle",
      });

      const reply = await ask(ctx, {
        turns: [
          {
            type: "user",
            text: `${haystack}\n\nWhat is the launch code? Reply with just the code.`,
          },
        ],
        temperature: DETERMINISTIC_TEMP,
        maxTokens: 32,
      });

      return /quasar-471/i.test(reply.text)
        ? pass()
        : fail(`missed the needle: "${reply.text.slice(0, 80)}"`);
    },
  },
];

// ── 8. Basic reasoning ──────────────────────────────────────────────────────

const reasoning: EvalDef[] = [
  {
    id: "eval-reasoning-arithmetic",
    name: "multiplies two two-digit numbers",
    category: "reasoning",
    async run(ctx) {
      const reply = await ask(ctx, {
        turns: [
          {
            type: "user",
            text: "What is 17 * 24? Reply with just the number.",
          },
        ],
        temperature: DETERMINISTIC_TEMP,
        maxTokens: 32,
      });
      return expectNumber(reply.text, 408, "17 * 24");
    },
  },
  {
    id: "eval-reasoning-transitive",
    name: "follows a transitive chain",
    category: "reasoning",
    async run(ctx) {
      const reply = await ask(ctx, {
        turns: [
          {
            type: "user",
            text: "Alice is taller than Bob. Bob is taller than Carol. Who is shortest? Reply with just the name.",
          },
        ],
        temperature: DETERMINISTIC_TEMP,
        maxTokens: 16,
      });
      return expectWord(reply.text, "carol", "shortest person");
    },
  },
  {
    id: "eval-reasoning-counting",
    name: "counts letters in a word",
    category: "reasoning",
    async run(ctx) {
      const reply = await ask(ctx, {
        turns: [
          {
            type: "user",
            text: 'How many times does the letter "r" appear in "strawberry"? Reply with just the number.',
          },
        ],
        temperature: DETERMINISTIC_TEMP,
        maxTokens: 16,
      });
      return expectNumber(reply.text, 3, 'r\'s in "strawberry"');
    },
  },
];

// ── 9. Basic knowledge (deliberately thin) ──────────────────────────────────

const knowledge: EvalDef[] = [
  {
    id: "eval-knowledge-capital",
    name: "knows a non-obvious capital city",
    category: "knowledge",
    async run(ctx) {
      const reply = await ask(ctx, {
        turns: [
          {
            type: "user",
            text: "What is the capital of Australia? Reply with just the city.",
          },
        ],
        temperature: DETERMINISTIC_TEMP,
        maxTokens: 16,
      });
      return expectWord(reply.text, "canberra", "capital of Australia");
    },
  },
  {
    id: "eval-knowledge-symbol",
    name: "knows a chemical symbol",
    category: "knowledge",
    async run(ctx) {
      const reply = await ask(ctx, {
        turns: [
          {
            type: "user",
            text: "What is the chemical symbol for gold? Reply with just the symbol.",
          },
        ],
        temperature: DETERMINISTIC_TEMP,
        maxTokens: 16,
      });
      return /\bau\b/i.test(reply.text)
        ? pass()
        : fail(`expected "Au", got "${reply.text.slice(0, 40)}"`);
    },
  },
  {
    id: "eval-knowledge-author",
    name: "attributes a well-known novel",
    category: "knowledge",
    async run(ctx) {
      const reply = await ask(ctx, {
        turns: [
          {
            type: "user",
            text: "Who wrote Pride and Prejudice? Reply with the surname only.",
          },
        ],
        temperature: DETERMINISTIC_TEMP,
        maxTokens: 16,
      });
      return expectWord(reply.text, "austen", "author of Pride and Prejudice");
    },
  },
];

export const ALL_EVALS: EvalDef[] = [
  ...toolSelection,
  ...toolRestraint,
  ...toolArgs,
  ...multiturn,
  ...instructions,
  ...jsonDiscipline,
  ...longContext,
  ...reasoning,
  ...knowledge,
];

export type { Graded };
