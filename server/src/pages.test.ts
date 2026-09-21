import { describe, expect, it } from "vitest";
import { libraryRuns } from "./pages";

const report = (startedAt: string) => ({
  version: 2,
  target: {
    model: "org/qwen",
    engine: "mlx-serve",
    baseUrl: "http://h:8080/v1",
  },
  run: { startedAt },
  coverage: { byTier: [] },
});

describe("libraryRuns", () => {
  it("gives each stored run a stable slug and a card link by key, skipping non-reports", () => {
    const rows = [
      {
        key: "a|1",
        data: report("2026-09-16T10:00:00Z"),
        createdAt: new Date(),
      },
      {
        key: "a|2",
        data: report("2026-09-16T11:00:00Z"),
        createdAt: new Date(),
      },
      { key: "junk", data: { hello: 1 }, createdAt: new Date() },
    ];
    const runs = libraryRuns(rows);
    expect(runs.map((r) => r.href)).toEqual([
      "card.html?key=a%7C1",
      "card.html?key=a%7C2",
    ]);
    expect(runs[0]!.slug).not.toBe(runs[1]!.slug);
    expect(
      libraryRuns(rows.slice().reverse())
        .map((r) => r.slug)
        .sort(),
    ).toEqual(runs.map((r) => r.slug).sort());
  });
});
