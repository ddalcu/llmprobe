import { afterEach, expect, test } from "vitest";

import { ADAPTERS, primarySurface } from "../conformance/index";
import type { SurfaceAdapter } from "../core/adapter";
import { EngineClient, type RunConfig } from "../core/client";
import { createContext } from "../core/context";
import { normalizeRoot, probeEndpoint } from "../core/probe";
import { SURFACES } from "../core/registry";
import {
  type MockDefects,
  type MockEngine,
  startMockEngine,
} from "../fixtures/mock-engine";
import { runFidelity } from "./index";

/**
 * End-to-end: drive the real fidelity probe against the mock, one planted
 * defect at a time, and demand the card react. The pure scorer is covered in
 * score.test.ts; this proves the wiring — request shape, logprob parsing,
 * greedy self-consistency — actually detects what it claims to.
 */

let engine: MockEngine | null = null;

afterEach(() => {
  engine?.stop();
  engine = null;
});

async function fidelityOverMock(defects: MockDefects = {}) {
  engine = await startMockEngine(defects);
  const root = normalizeRoot(engine.url);

  const adapters = new Map<string, SurfaceAdapter>(
    ADAPTERS.map((a) => [a.id, a]),
  );
  const present = new Set<string>();
  let baseUrl = `${root}/v1`;

  for (const surface of SURFACES) {
    const probe = await probeEndpoint({
      root,
      method: surface.method,
      path: surface.path,
      headers: {},
      timeoutMs: 5000,
    });
    if (probe.present) {
      present.add(surface.id);
      baseUrl = probe.effectiveBaseUrl ?? baseUrl;
    }
  }

  const config: RunConfig = {
    baseUrl,
    apiKey: "",
    model: "mock-model-12b",
    timeoutMs: 15_000,
    depth: "default",
    reasoningHeadroom: 0,
  };

  const ctx = createContext({
    config,
    client: new EngineClient(config),
    adapters,
    present,
    evalSurface: primarySurface(present),
  });

  return runFidelity(ctx, false);
}

test("a sound engine measures all four slices and stays deterministic", async () => {
  const fid = await fidelityOverMock();
  expect(fid).not.toBeNull();
  expect(fid!.slices).toHaveLength(4);

  const by = Object.fromEntries(fid!.slices.map((s) => [s.id, s]));
  expect(by.confidence!.measured).toBe(true);
  expect(by.consistency!.measured).toBe(true);
  expect(by.determinism!.measured).toBe(true);

  // The mock puts near-all mass on the answer token (p≈0.95), so Confidence
  // clears the floor, and it is deterministic, so greedy runs never split.
  expect(by.confidence!.score).toBeGreaterThan(0.9);
  expect(by.determinism!.score).toBe(1);
  expect(fid!.firstDivergence).toBeNull();
  expect(fid!.unmeasured).toEqual([]);
  expect(fid!.pct).toBeGreaterThan(0);
});

test("no logprobs drops Confidence + Consistency out, never scores them zero", async () => {
  const fid = await fidelityOverMock({ silentlyIgnoreLogprobs: true });
  const by = Object.fromEntries(fid!.slices.map((s) => [s.id, s]));

  expect(by.confidence!.measured).toBe(false);
  expect(by.consistency!.measured).toBe(false);
  expect(fid!.unmeasured).toContain("Confidence");
  expect(fid!.unmeasured).toContain("Logprob consistency");

  // Determinism still measured, so a still-deterministic engine keeps a real
  // score rather than being punished to zero for the missing slices.
  expect(by.determinism!.measured).toBe(true);
  expect(by.determinism!.score).toBe(1);
});

test("a non-deterministic kernel is caught, with where it diverged", async () => {
  const fid = await fidelityOverMock({ nondeterministicGreedy: true });
  const determinism = fid!.slices.find((s) => s.id === "determinism")!;

  expect(determinism.score).toBeLessThan(1);
  expect(fid!.firstDivergence).not.toBeNull();
  expect(fid!.firstDivergence!.charIndex).toBeGreaterThanOrEqual(0);
});

test("a flattened distribution costs Confidence", async () => {
  const fid = await fidelityOverMock({ flatLogprobs: true });
  const confidence = fid!.slices.find((s) => s.id === "confidence")!;

  // p≈0.25 against the 0.9 floor ⇒ a materially degraded Confidence slice.
  expect(confidence.measured).toBe(true);
  expect(confidence.score).toBeLessThan(0.5);
});
