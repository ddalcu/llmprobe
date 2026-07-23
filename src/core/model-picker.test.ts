import { describe, expect, test } from "vitest";

import { matchModelChoice, pickModel } from "./model-picker";

describe("matchModelChoice", () => {
  const models = ["alpha-7b", "beta-12b", "gamma-70b"];

  test("empty input defaults to the first model", () => {
    expect(matchModelChoice("", models)).toBe("alpha-7b");
    expect(matchModelChoice("   ", models)).toBe("alpha-7b");
  });

  test("a 1-based index selects that model", () => {
    expect(matchModelChoice("1", models)).toBe("alpha-7b");
    expect(matchModelChoice("3", models)).toBe("gamma-70b");
  });

  test("an exact model id is accepted directly", () => {
    expect(matchModelChoice("beta-12b", models)).toBe("beta-12b");
  });

  test("out-of-range or unknown input is rejected", () => {
    expect(matchModelChoice("0", models)).toBeNull();
    expect(matchModelChoice("4", models)).toBeNull();
    expect(matchModelChoice("-1", models)).toBeNull();
    expect(matchModelChoice("1.5", models)).toBeNull();
    expect(matchModelChoice("delta-1b", models)).toBeNull();
  });

  test("an empty model list yields null", () => {
    expect(matchModelChoice("", [])).toBeNull();
    expect(matchModelChoice("1", [])).toBeNull();
  });
});

describe("pickModel", () => {
  test("lists every model and returns the chosen one", async () => {
    const printed: string[] = [];
    const model = await pickModel(["alpha-7b", "beta-12b"], {
      ask: async () => "2",
      print: (line) => printed.push(line),
    });

    expect(model).toBe("beta-12b");
    expect(printed.join("\n")).toContain("1. alpha-7b");
    expect(printed.join("\n")).toContain("2. beta-12b");
  });

  test("re-prompts on invalid input instead of giving up", async () => {
    const answers = ["99", "nope", "1"];
    const model = await pickModel(["alpha-7b", "beta-12b"], {
      ask: async () => answers.shift() ?? "",
      print: () => {},
    });

    expect(model).toBe("alpha-7b");
    expect(answers).toHaveLength(0);
  });

  test("enter on an empty line takes the default (first) model", async () => {
    const model = await pickModel(["alpha-7b", "beta-12b"], {
      ask: async () => "",
      print: () => {},
    });

    expect(model).toBe("alpha-7b");
  });
});
