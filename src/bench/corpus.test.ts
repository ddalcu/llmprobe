import { describe, expect, test } from "vitest";

import {
  PLANTED_CONSTANT,
  PLANTED_VALUE,
  buildCodeContext,
  buildCodeContextWithConstant,
  usedPlantedConstant,
} from "./corpus";

describe("buildCodeContext", () => {
  test("hits the byte target exactly, so the ladder can size a rung", () => {
    for (const bytes of [512, 4096, 65_536]) {
      expect(buildCodeContext(bytes)).toHaveLength(bytes);
    }
    expect(buildCodeContext(0)).toBe("");
  });

  test("is deterministic — the same rung is the same prompt every run", () => {
    expect(buildCodeContext(8192)).toBe(buildCodeContext(8192));
  });

  test("does not repeat itself, which is what broke the old filler", () => {
    // The previous filler was one sentence stamped out to size, so summarising
    // it was near-free to predict and the rung baseline came back faster than
    // no context at all. Distinct identifiers are the fix.
    const source = buildCodeContext(16_384);
    const identifiers = source.match(/export function (\w+)/g) ?? [];
    expect(identifiers.length).toBeGreaterThan(6);
    expect(new Set(identifiers).size).toBe(identifiers.length);

    // And it reads as source, not prose.
    expect(source).toMatch(/^\/\/ src\//);
    expect(source).toContain("import");
    expect(source).toContain("interface");
  });
});

describe("buildCodeContextWithConstant", () => {
  test("buries the constant in the middle, not at either edge", () => {
    const source = buildCodeContextWithConstant(8192);
    const at = source.indexOf(PLANTED_CONSTANT);
    expect(at).toBeGreaterThan(source.length * 0.25);
    expect(at).toBeLessThan(source.length * 0.75);
  });

  test("plants it on a module boundary, never inside another file", () => {
    // A bare newline split lands inside a JSDoc block often enough that the
    // constant ends up commented out, and then the task cannot use it.
    for (const bytes of [1800, 8192, 65_536]) {
      const source = buildCodeContextWithConstant(bytes);
      const before = source.slice(0, source.indexOf("// src/config/"));
      expect(before.endsWith("\n\n")).toBe(true);
      // Nothing left open above it: equal numbers of block-comment delimiters.
      expect((before.match(/\/\*\*/g) ?? []).length).toBe(
        (before.match(/\*\//g) ?? []).length,
      );
      expect(source).toMatch(
        new RegExp(`\\nexport const ${PLANTED_CONSTANT} = ${PLANTED_VALUE};`),
      );
    }
  });

  test("the generated prose is grammatical, since the model reads it", () => {
    expect(buildCodeContext(65_536)).not.toMatch(/\ba (?=[aeiou])/);
  });
});

describe("usedPlantedConstant", () => {
  test("accepts the name or the literal value", () => {
    expect(usedPlantedConstant("if (elapsed > RETRY_BUDGET_MS) throw e;")).toBe(
      true,
    );
    expect(usedPlantedConstant("const budget = 7413;")).toBe(true);
  });

  test("rejects an answer that never went and looked", () => {
    expect(usedPlantedConstant("const budget = 30_000;")).toBe(false);
    expect(usedPlantedConstant("")).toBe(false);
  });
});
