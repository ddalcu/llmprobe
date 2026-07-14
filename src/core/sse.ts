/**
 * SSE framing — parsed from the raw body text rather than streamed.
 *
 * Reading the whole body first is deliberate: the framing itself is one of the
 * things we assert (blank-line separation, a terminal `[DONE]`, nothing after
 * it), and you cannot check "was the stream framed correctly" from a parser
 * that has already normalised the frames away. Keeping it pure also means the
 * framing rules are unit-testable offline, with no engine running.
 */

export interface SSEFrame {
  index: number;
  /** The `event:` field, when the engine sends one (Anthropic always does). */
  event?: string;
  /** The `data:` payload. Multiple `data:` lines join with newlines, per spec. */
  data: string;
  raw: string;
}

export interface FramingIssue {
  id: string;
  message: string;
}

const FRAME_SEPARATOR = /\r?\n\r?\n/;

export function parseSSEFrames(raw: string): SSEFrame[] {
  const frames: SSEFrame[] = [];

  for (const block of raw.split(FRAME_SEPARATOR)) {
    if (block.trim() === "") continue;

    let event: string | undefined;
    const dataLines: string[] = [];

    for (const line of block.split(/\r?\n/)) {
      // Comment/heartbeat lines. Legal, ignored.
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }

    if (dataLines.length === 0 && event === undefined) continue;

    frames.push({
      index: frames.length,
      event,
      data: dataLines.join("\n"),
      raw: block,
    });
  }

  return frames;
}

/**
 * Framing violations, as ids the caller maps to MUST/SHOULD. Returning ids
 * rather than pre-judged severities keeps the severity policy in one place
 * (the conformance tests) instead of scattered through the parser.
 *
 * `expectDone` is false for Anthropic Messages, which terminates with a
 * `message_stop` event rather than OpenAI's `data: [DONE]` sentinel.
 */
export function checkSSEFraming(
  raw: string,
  options: { expectDone: boolean },
): FramingIssue[] {
  const issues: FramingIssue[] = [];

  if (raw.trim() === "") {
    return [{ id: "sse-empty", message: "stream body was empty" }];
  }

  const frames = parseSSEFrames(raw);
  if (frames.length === 0) {
    return [
      { id: "sse-no-frames", message: "no `data:` frames found in the stream" },
    ];
  }

  // Every frame must carry a data payload — an `event:` with no `data:` gives
  // a client nothing to act on.
  for (const frame of frames) {
    if (frame.data === "") {
      issues.push({
        id: "sse-frame-without-data",
        message: `frame ${frame.index}${frame.event ? ` (event: ${frame.event})` : ""} has no \`data:\` payload`,
      });
    }
  }

  // Per spec a frame is only dispatched on a blank line. An unterminated final
  // frame leaves a conforming client holding an event it never fires.
  if (!/\r?\n\r?\n\s*$/.test(raw)) {
    issues.push({
      id: "sse-unterminated-final-frame",
      message:
        "stream does not end with a blank line — the final frame is never dispatched by a spec-compliant client",
    });
  }

  if (options.expectDone) {
    const doneAt = frames.findIndex((f) => f.data.trim() === "[DONE]");

    if (doneAt === -1) {
      issues.push({
        id: "sse-missing-done",
        message: "stream never sent the terminal `data: [DONE]` sentinel",
      });
    } else if (doneAt !== frames.length - 1) {
      const after = frames.length - 1 - doneAt;
      issues.push({
        id: "sse-frames-after-done",
        message: `${after} frame(s) sent after \`data: [DONE]\` — [DONE] must be terminal`,
      });
    }
  }

  return issues;
}

/** Data frames, minus the `[DONE]` sentinel — i.e. the ones carrying payloads. */
export function payloadFrames(frames: SSEFrame[]): SSEFrame[] {
  return frames.filter((f) => f.data.trim() !== "[DONE]" && f.data !== "");
}

/** Parse each payload frame's JSON, collecting errors rather than throwing. */
export function parseFrameJson(frames: SSEFrame[]): {
  payloads: unknown[];
  errors: string[];
} {
  const payloads: unknown[] = [];
  const errors: string[] = [];

  for (const frame of payloadFrames(frames)) {
    try {
      payloads.push(JSON.parse(frame.data));
    } catch (err) {
      errors.push(
        `frame ${frame.index}: data is not valid JSON (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }

  return { payloads, errors };
}
