import { describe, expect, test } from "vitest";

import type { RunConfig } from "../../core/client";
import { chatAdapter } from "./adapter";

const config: RunConfig = {
  baseUrl: "http://x/v1",
  apiKey: "",
  model: "m",
  timeoutMs: 1,
  depth: "default",
  reasoningHeadroom: 0,
};
const request = { turns: [{ type: "user" as const, text: "hi" }] };

describe("chat buildBody with reasoning off", () => {
  test("sends only the spec disable by default", () => {
    const body = chatAdapter.buildBody(
      { ...request, reasoningEffort: "none" },
      config,
    );
    expect(body.reasoning_effort).toBe("none");
    expect(body.chat_template_kwargs).toBeUndefined();
  });

  test("adds the vendor toggle only when the run resolved to it", () => {
    const body = chatAdapter.buildBody(
      { ...request, reasoningEffort: "none" },
      { ...config, thinkingOff: "vendor" },
    );
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    const medium = chatAdapter.buildBody(
      { ...request, reasoningEffort: "medium" },
      { ...config, thinkingOff: "vendor" },
    );
    expect(medium.chat_template_kwargs).toBeUndefined();
  });
});
