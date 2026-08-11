import { describe, expect, test } from "vitest";

import {
  matchModelChoice,
  matchModelChoices,
  pickModels,
} from "./model-picker";

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

describe("matchModelChoices", () => {
  const models = ["alpha-7b", "beta-12b", "gamma-70b", "delta-1b"];

  test("a comma list selects every listed model, in the order given", () => {
    expect(matchModelChoices("1,3", models)).toEqual(["alpha-7b", "gamma-70b"]);
    expect(matchModelChoices("3,1", models)).toEqual(["gamma-70b", "alpha-7b"]);
  });

  test("spaces around the commas are tolerated", () => {
    expect(matchModelChoices(" 1 , 2 ,4 ", models)).toEqual([
      "alpha-7b",
      "beta-12b",
      "delta-1b",
    ]);
  });

  test("model ids can be mixed with indices", () => {
    expect(matchModelChoices("1,gamma-70b", models)).toEqual([
      "alpha-7b",
      "gamma-70b",
    ]);
  });

  test("a repeat is collapsed — one run per model", () => {
    expect(matchModelChoices("2,2,1", models)).toEqual([
      "beta-12b",
      "alpha-7b",
    ]);
  });

  test("one bad entry rejects the whole line rather than silently dropping it", () => {
    expect(matchModelChoices("1,99", models)).toBeNull();
    expect(matchModelChoices("1,nope", models)).toBeNull();
  });

  test("a single choice still works, including the empty default", () => {
    expect(matchModelChoices("2", models)).toEqual(["beta-12b"]);
    expect(matchModelChoices("", models)).toEqual(["alpha-7b"]);
  });

  test("a list of nothing but separators is rejected", () => {
    expect(matchModelChoices(",", models)).toBeNull();
    expect(matchModelChoices(" , , ", models)).toBeNull();
  });
});

describe("pickModels", () => {
  test("lists every model and returns each pick", async () => {
    const printed: string[] = [];
    const picked = await pickModels(["a", "b", "c"], {
      ask: async () => "1,3",
      print: (line) => printed.push(line),
    });

    expect(picked).toEqual(["a", "c"]);
    expect(printed.join("\n")).toContain("1. a");
    expect(printed.join("\n")).toContain("3. c");
    expect(printed.join("\n")).toContain("comma");
  });

  test("enter on an empty line takes the default (first) model", async () => {
    const picked = await pickModels(["a", "b"], {
      ask: async () => "",
      print: () => {},
    });

    expect(picked).toEqual(["a"]);
  });

  test("re-prompts when one entry in the list is invalid", async () => {
    const answers = ["1,42", "2,3"];
    const picked = await pickModels(["a", "b", "c"], {
      ask: async () => answers.shift() ?? "",
      print: () => {},
    });

    expect(picked).toEqual(["b", "c"]);
    expect(answers).toHaveLength(0);
  });
});
