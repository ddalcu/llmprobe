import { describe, expect, test } from "vitest";

import { checkSSEFraming, parseFrameJson, parseSSEFrames } from "./sse";

const ids = (raw: string, expectDone = true) =>
  checkSSEFraming(raw, { expectDone }).map((i) => i.id);

describe("parseSSEFrames", () => {
  test("splits on blank lines and strips the field prefixes", () => {
    const frames = parseSSEFrames('data: {"a":1}\n\ndata: {"b":2}\n\n');
    expect(frames).toHaveLength(2);
    expect(frames[0]!.data).toBe('{"a":1}');
    expect(frames[1]!.data).toBe('{"b":2}');
  });

  test("keeps the event name when the engine sends one (Anthropic style)", () => {
    const frames = parseSSEFrames(
      'event: message_start\ndata: {"type":"message_start"}\n\n',
    );
    expect(frames[0]!.event).toBe("message_start");
  });

  test("joins multi-line data payloads with newlines, per spec", () => {
    const frames = parseSSEFrames("data: line one\ndata: line two\n\n");
    expect(frames[0]!.data).toBe("line one\nline two");
  });

  test("ignores comment/heartbeat lines", () => {
    const frames = parseSSEFrames(': keep-alive\n\ndata: {"a":1}\n\n');
    expect(frames).toHaveLength(1);
  });

  test("tolerates CRLF line endings", () => {
    const frames = parseSSEFrames('data: {"a":1}\r\n\r\ndata: [DONE]\r\n\r\n');
    expect(frames).toHaveLength(2);
    expect(frames[1]!.data).toBe("[DONE]");
  });
});

describe("checkSSEFraming", () => {
  test("a well-formed OpenAI stream has no issues", () => {
    expect(ids('data: {"a":1}\n\ndata: {"b":2}\n\ndata: [DONE]\n\n')).toEqual(
      [],
    );
  });

  test("catches a missing [DONE] sentinel", () => {
    expect(ids('data: {"a":1}\n\n')).toContain("sse-missing-done");
  });

  test("catches frames sent after [DONE] — the sentinel must be terminal", () => {
    const raw = 'data: {"a":1}\n\ndata: [DONE]\n\ndata: {"b":2}\n\n';
    expect(ids(raw)).toContain("sse-frames-after-done");
  });

  test("catches an unterminated final frame, which a client never dispatches", () => {
    expect(ids('data: {"a":1}\n\ndata: [DONE]')).toContain(
      "sse-unterminated-final-frame",
    );
  });

  test("catches an event with no data payload", () => {
    const raw = "event: ping\n\ndata: [DONE]\n\n";
    expect(ids(raw)).toContain("sse-frame-without-data");
  });

  test("does not demand [DONE] from Anthropic-shaped streams", () => {
    const raw =
      'event: message_start\ndata: {"type":"message_start"}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n';
    expect(ids(raw, false)).toEqual([]);
  });

  test("an empty body is a framing failure, not a silent pass", () => {
    expect(ids("")).toEqual(["sse-empty"]);
  });
});

describe("parseFrameJson", () => {
  test("parses payloads and skips the [DONE] sentinel", () => {
    const frames = parseSSEFrames('data: {"a":1}\n\ndata: [DONE]\n\n');
    const { payloads, errors } = parseFrameJson(frames);
    expect(payloads).toEqual([{ a: 1 }]);
    expect(errors).toEqual([]);
  });

  test("reports malformed JSON rather than throwing", () => {
    const frames = parseSSEFrames("data: {not json}\n\n");
    const { payloads, errors } = parseFrameJson(frames);
    expect(payloads).toEqual([]);
    expect(errors[0]).toContain("not valid JSON");
  });
});
