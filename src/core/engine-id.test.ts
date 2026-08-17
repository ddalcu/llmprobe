import { describe, expect, test } from "vitest";

import { detectEngine } from "./engine-id";

describe("detectEngine", () => {
  test("identifies engines from the Server header", () => {
    expect(detectEngine("llama.cpp")).toBe("llama.cpp");
    expect(detectEngine("mlx-serve/0.4.1")).toBe("mlx-serve");
    expect(detectEngine("Ollama")).toBe("Ollama");
    expect(detectEngine("uvicorn is fronting vLLM/0.6")).toBe("vLLM");
  });

  test("mlx-serve is NOT called Ollama just because it ships the compat shim", () => {
    // The exact bug the header exposed: mlx-serve serves /api/chat for Ollama
    // clients, but it is mlx-serve, not Ollama. Identity comes from the Server
    // header, never from which endpoints happen to exist.
    expect(detectEngine("mlx-serve")).toBe("mlx-serve");
  });

  test("a generic framework banner names the stack, not the engine, so we stay quiet", () => {
    expect(detectEngine("uvicorn")).toBeUndefined();
    expect(detectEngine("Werkzeug/2.0.1 Python/3.11")).toBeUndefined();
    expect(detectEngine("nginx")).toBeUndefined();
  });

  test("no header → no guess", () => {
    expect(detectEngine(null)).toBeUndefined();
    expect(detectEngine("")).toBeUndefined();
  });

  test("a named-but-unknown engine server is shown rather than dropped", () => {
    expect(detectEngine("KoboldCpp/1.5")).toBe("KoboldCpp");
  });

  test("owned_by identifies engines hiding behind a generic framework banner", () => {
    // MTPLX and oMLX both front with uvicorn and both default to port 8000 —
    // the Server header and the port are useless. But each stamps its own name
    // in /v1/models owned_by.
    expect(detectEngine("uvicorn", "mtplx")).toBe("MTPLX");
    expect(detectEngine(null, "omlx")).toBe("oMLX");
    expect(detectEngine(null, "mlx-serve")).toBe("mlx-serve");
  });

  test("the Server header wins over owned_by", () => {
    expect(detectEngine("llama.cpp", "omlx")).toBe("llama.cpp");
  });

  test("an unrecognized owned_by is not treated as an engine name", () => {
    // Ollama says "library", OpenAI says "openai", many say "organization".
    expect(detectEngine(null, "library")).toBeUndefined();
    expect(detectEngine("uvicorn", "organization")).toBeUndefined();
  });
});
