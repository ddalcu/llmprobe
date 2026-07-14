import { describe, expect, test } from "bun:test";

import {
  bodySignature,
  candidateUrls,
  classifyStatus,
  normalizeRoot,
} from "./probe";

describe("classifyStatus", () => {
  // This split is the entire basis of Coverage vs Conformance. Getting it wrong
  // would make "you don't implement audio" indistinguishable from "your audio
  // endpoint is broken".
  test("404 and 405 mean the endpoint is not implemented", () => {
    expect(classifyStatus(404)).toBe("absent");
    expect(classifyStatus(405)).toBe("absent");
  });

  test("a validation error means the endpoint exists — it rejected our empty body", () => {
    expect(classifyStatus(400)).toBe("present");
    expect(classifyStatus(422)).toBe("present");
  });

  test("auth errors mean the endpoint exists", () => {
    expect(classifyStatus(401)).toBe("present");
    expect(classifyStatus(403)).toBe("present");
  });

  test("a 500 means the endpoint exists and is broken — a conformance problem, not a coverage one", () => {
    expect(classifyStatus(500)).toBe("present");
  });

  test("200 obviously means present", () => {
    expect(classifyStatus(200)).toBe("present");
  });
});

describe("normalizeRoot", () => {
  test("adds a scheme to a bare host:port", () => {
    expect(normalizeRoot("localhost:1234")).toBe("http://localhost:1234");
  });

  test("strips a trailing /v1 so we can re-derive both mountings", () => {
    expect(normalizeRoot("http://localhost:8080/v1")).toBe(
      "http://localhost:8080",
    );
  });

  test("strips trailing slashes", () => {
    expect(normalizeRoot("http://localhost:8080/v1/")).toBe(
      "http://localhost:8080",
    );
  });

  test("leaves https alone", () => {
    expect(normalizeRoot("https://api.openai.com/v1")).toBe(
      "https://api.openai.com",
    );
  });

  test("does not mangle a path that merely contains v1", () => {
    expect(normalizeRoot("http://host/openai/v1")).toBe("http://host/openai");
  });
});

describe("candidateUrls", () => {
  test("prefers the /v1 mounting, then falls back to bare", () => {
    expect(candidateUrls("http://host", "/chat/completions")).toEqual([
      { baseUrl: "http://host/v1", path: "/chat/completions" },
      { baseUrl: "http://host", path: "/chat/completions" },
    ]);
  });
});

describe("bodySignature", () => {
  test("strips the echoed path so two unknown-endpoint replies match", () => {
    // LM Studio's real reply shape.
    const a = bodySignature(
      '{"error":"Unexpected endpoint or method. (POST /v1/images/generations)"}',
      "/v1/images/generations",
    );
    const b = bodySignature(
      '{"error":"Unexpected endpoint or method. (POST /v1/audio/speech)"}',
      "/v1/audio/speech",
    );
    expect(a).toBe(b);
  });

  test("a real endpoint's error does not match the catch-all boilerplate", () => {
    const canary = bodySignature(
      '{"error":"Unexpected endpoint or method. (POST /__llmprobe_no_such_endpoint__)"}',
      "/__llmprobe_no_such_endpoint__",
    );
    const real = bodySignature(
      '{"error":{"message":"Missing required parameter: \'model\'."}}',
      "/v1/responses",
    );
    expect(real).not.toBe(canary);
  });
});
