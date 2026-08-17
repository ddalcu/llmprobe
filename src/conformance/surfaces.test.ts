import { describe, expect, test } from "vitest";

import { Asserter, Inconclusive } from "../core/assert";
import type { ChatReply } from "../core/adapter";
import type { RunContext } from "../core/context";
import {
  ASSISTANT_PREFILL,
  chatOnlyTests,
  messagesOnlyTests,
} from "./surfaces";

const stopEcho = messagesOnlyTests.find(
  (t) => t.id === "messages-stop-sequence-echo",
)!;
const messagesPrefill = messagesOnlyTests.find(
  (t) => t.id === "messages-assistant-prefill",
)!;
const chatPrefill = chatOnlyTests.find(
  (t) => t.id === "chat-assistant-prefill",
)!;
const systemBlocks = messagesOnlyTests.find(
  (t) => t.id === "messages-system-blocks",
)!;
const cacheControl = messagesOnlyTests.find(
  (t) => t.id === "messages-cache-control",
)!;
const templateKwargs = chatOnlyTests.find(
  (t) => t.id === "chat-template-kwargs",
)!;
const samplingExtensions = chatOnlyTests.find(
  (t) => t.id === "chat-sampling-extensions",
)!;

/** A context whose only job is to hand the test one canned reply. */
function ctxReplying(reply: Partial<ChatReply>, raw: unknown = {}): RunContext {
  return {
    config: { model: "m" },
    send: async () => ({
      status: 200,
      reply: { text: "", finishReason: null, ...reply } as ChatReply,
      headers: new Headers(),
      raw,
      text: "",
      durationMs: 1,
    }),
  } as unknown as RunContext;
}

/** A context that answers a sequence of sends — the prefill probe makes up to three. */
function ctxReplyingEach(
  replies: Array<{
    status?: number;
    text?: string;
    reasoning?: string;
    cacheWrite?: number;
    cacheRead?: number;
  }>,
): RunContext {
  let next = 0;
  return {
    config: { model: "m" },
    send: async () => {
      const canned = replies[Math.min(next++, replies.length - 1)];
      return {
        status: canned.status ?? 200,
        reply: {
          text: canned.text ?? "",
          finishReason: null,
          reasoningText: canned.reasoning ?? null,
          usage: {
            inputTokens: null,
            outputTokens: null,
            cachedInputTokens: canned.cacheRead ?? null,
            reasoningTokens: null,
            cacheCreationInputTokens: canned.cacheWrite ?? null,
          },
        } as ChatReply,
        headers: new Headers(),
        raw: {},
        text: "",
        durationMs: 1,
      };
    },
  } as unknown as RunContext;
}

describe("messages: stop_sequence echo", () => {
  test("a model that talks about alpha but never reaches beta is inconclusive", async () => {
    // Llama-3.2-3B and Mistral-7B do exactly this: "Alpha is a Greek letter
    // often used to denote..." until max_tokens. The stop sequence was never
    // emitted, so the engine's stop handling was never exercised — scoring it
    // as a MUST failure blames the engine for the model rambling.
    const a = new Asserter();
    await expect(
      stopEcho.run(
        ctxReplying({
          text: "Alpha is a Greek letter often used to denote the first item in",
          finishReason: "max_tokens",
        }),
        a,
      ),
    ).rejects.toBeInstanceOf(Inconclusive);
  });

  test("an engine that ignores the stop sequence still fails", async () => {
    const a = new Asserter();
    await stopEcho.run(
      ctxReplying({ text: "alpha beta gamma", finishReason: "end_turn" }),
      a,
    );

    expect(a.failedMust).toBe(true);
  });

  test("a cut that reports the wrong stop_reason is still caught", async () => {
    // The text stops exactly where the stop sequence was, so the engine did
    // the cut and mislabelled it — the guard must not swallow this one.
    const a = new Asserter();
    await stopEcho.run(
      ctxReplying({ text: "alpha", finishReason: "end_turn" }, {}),
      a,
    );

    expect(a.failedMust).toBe(true);
  });

  test("a clean cut passes", async () => {
    const a = new Asserter();
    await stopEcho.run(
      ctxReplying(
        { text: "alpha ", finishReason: "stop_sequence" },
        { stop_sequence: "beta" },
      ),
      a,
    );

    expect(a.failedMust).toBe(false);
    expect(a.results.every((r) => r.passed)).toBe(true);
  });
});

describe("messages: assistant prefill", () => {
  test("a reply that continues the prefill passes", async () => {
    const a = new Asserter();
    await messagesPrefill.run(ctxReplying({ text: "is." }), a);

    expect(a.failedMust).toBe(false);
    expect(a.results.every((r) => r.passed)).toBe(true);
  });

  test("a reply that answers from the top failed to prefill", async () => {
    const a = new Asserter();
    await messagesPrefill.run(ctxReplying({ text: "Paris" }), a);

    expect(a.failedMust).toBe(true);
  });

  test("echoing the prefill back fails — the caller gets it twice", async () => {
    const a = new Asserter();
    await messagesPrefill.run(
      ctxReplying({ text: `${ASSISTANT_PREFILL}is.` }),
      a,
    );

    expect(a.failedMust).toBe(true);
  });

  test("a reply that neither continues nor restarts is inconclusive", async () => {
    const a = new Asserter();
    await expect(
      messagesPrefill.run(
        ctxReplying({ text: "I'm happy to help with geography questions!" }),
        a,
      ),
    ).rejects.toBeInstanceOf(Inconclusive);
  });
});

describe("chat: assistant prefill dialect", () => {
  test("continuing with no flag is credited as the implicit dialect", async () => {
    const a = new Asserter();
    const verdict = await chatPrefill.run(
      ctxReplyingEach([{ text: "is." }]),
      a,
    );

    expect(verdict?.credit?.label).toMatch(/trailing assistant message/);
    expect(verdict?.credit?.label).not.toMatch(/continue_final_message/);
    expect(a.failedMust).toBe(false);
  });

  test("continuing only under the flag is credited as the vLLM dialect", async () => {
    const a = new Asserter();
    const verdict = await chatPrefill.run(
      ctxReplyingEach([{ text: "Paris" }, { text: "is." }, { status: 400 }]),
      a,
    );

    expect(verdict?.credit?.label).toMatch(/continue_final_message/);
    expect(a.results.every((r) => r.passed)).toBe(true);
  });

  test("accepting the mutually exclusive flag pair warns, never fails", async () => {
    const a = new Asserter();
    await chatPrefill.run(
      ctxReplyingEach([{ text: "Paris" }, { text: "is." }, { text: "is." }]),
      a,
    );

    expect(a.failedMust).toBe(false);
    expect(a.results.some((r) => r.severity === "SHOULD" && !r.passed)).toBe(
      true,
    );
  });

  test("an engine that never prefills is credited with nothing at all", async () => {
    const a = new Asserter();
    const verdict = await chatPrefill.run(
      ctxReplyingEach([{ text: "Paris" }, { text: "Paris" }]),
      a,
    );

    expect(verdict?.credit?.label).toMatch(/starts a new turn/);
    expect(a.failedMust).toBe(false);
  });
});

describe("messages: system as text blocks", () => {
  test("a model that ignores the string-form system prompt is inconclusive", async () => {
    const a = new Asserter();
    await expect(
      systemBlocks.run(ctxReplyingEach([{ text: "Paris" }]), a),
    ).rejects.toBeInstanceOf(Inconclusive);
  });

  test("a rejection caused by metadata is charged to metadata, not to system blocks", async () => {
    const a = new Asserter();
    // baseline follows; blocks+metadata 400; retry without metadata follows.
    await systemBlocks.run(
      ctxReplyingEach([
        { text: "quartz" },
        { status: 400 },
        { text: "quartz" },
      ]),
      a,
    );

    expect(a.failedMust).toBe(false);
    const metadata = a.results.find(
      (r) => r.id === "messages-metadata-accepted",
    );
    expect(metadata?.passed).toBe(false);
    expect(metadata?.severity).toBe("SHOULD");
  });

  test("accepting the block form but dropping it fails the honored MUST", async () => {
    const a = new Asserter();
    await systemBlocks.run(
      ctxReplyingEach([{ text: "quartz" }, { text: "Paris" }]),
      a,
    );

    expect(a.failedMust).toBe(true);
    expect(
      a.results.find((r) => r.id === "messages-system-blocks-honored")?.passed,
    ).toBe(false);
  });

  test("the happy path passes everything including metadata", async () => {
    const a = new Asserter();
    await systemBlocks.run(
      ctxReplyingEach([{ text: "quartz" }, { text: "quartz" }]),
      a,
    );

    expect(a.results.length).toBeGreaterThan(0);
    expect(a.results.every((r) => r.passed)).toBe(true);
  });
});

describe("messages: cache_control breakpoints", () => {
  test("an engine reporting neither cache counter is unsupported, not failed", async () => {
    const a = new Asserter();
    const verdict = await cacheControl.run(
      ctxReplyingEach([{ text: "hi" }, { text: "hi" }]),
      a,
    );

    expect(verdict?.featureSupported).toBe(false);
    expect(a.results.filter((r) => r.id.includes("cache-write"))).toHaveLength(
      0,
    );
  });

  test("a write then a read passes both SHOULDs", async () => {
    const a = new Asserter();
    await cacheControl.run(
      ctxReplyingEach([
        { text: "hi", cacheWrite: 1400 },
        { text: "hi", cacheRead: 1400 },
      ]),
      a,
    );

    expect(a.results.every((r) => r.passed)).toBe(true);
    expect(a.results.every((r) => r.severity === "SHOULD")).toBe(true);
  });
});

describe("chat: chat_template_kwargs credit", () => {
  test("no reasoning channel on the baseline means no credit and no second request", async () => {
    const a = new Asserter();
    const verdict = await templateKwargs.run(
      ctxReplyingEach([{ text: "51" }]),
      a,
    );

    expect(verdict ?? undefined).toBeUndefined();
  });

  test("thinking that disappears under the flag is credited as honored", async () => {
    const a = new Asserter();
    const verdict = await templateKwargs.run(
      ctxReplyingEach([{ text: "51", reasoning: "17*3..." }, { text: "51" }]),
      a,
    );

    expect(verdict?.credit?.label).toMatch(/honored/);
    expect(a.results).toHaveLength(0);
  });

  test("thinking that survives the flag is credited as accepted and ignored", async () => {
    const a = new Asserter();
    const verdict = await templateKwargs.run(
      ctxReplyingEach([
        { text: "51", reasoning: "17*3..." },
        { text: "51", reasoning: "17*3..." },
      ]),
      a,
    );

    expect(verdict?.credit?.label).toMatch(/ignored/);
  });

  test("a 400 under the flag is credited as rejected", async () => {
    const a = new Asserter();
    const verdict = await templateKwargs.run(
      ctxReplyingEach([{ text: "51", reasoning: "17*3..." }, { status: 400 }]),
      a,
    );

    expect(verdict?.credit?.label).toMatch(/rejected/);
  });
});

describe("chat: sampling extensions credit", () => {
  test("two agreeing greedy runs read as top_k honored, the rest as accepted only", async () => {
    const a = new Asserter();
    const verdict = await samplingExtensions.run(
      ctxReplyingEach([{ text: "Velvet Static" }, { text: "Velvet Static" }]),
      a,
    );

    expect(verdict?.credit?.label).toMatch(/top_k honored/);
    expect(verdict?.credit?.label).toMatch(/accepted/);
  });

  test("diverging runs read as accepted and ignored", async () => {
    const a = new Asserter();
    const verdict = await samplingExtensions.run(
      ctxReplyingEach([{ text: "Velvet Static" }, { text: "Iron Meadow" }]),
      a,
    );

    expect(verdict?.credit?.label).toMatch(/ignored/);
  });

  test("a rejection is credited as rejected, never failed", async () => {
    const a = new Asserter();
    const verdict = await samplingExtensions.run(
      ctxReplyingEach([{ status: 400 }]),
      a,
    );

    expect(verdict?.credit?.label).toMatch(/rejected/);
    expect(a.results).toHaveLength(0);
  });
});
