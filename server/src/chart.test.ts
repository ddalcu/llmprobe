// @ts-expect-error - browser ESM asset, no types
import { bars, lines } from "../public/chart.js";
import { describe, expect, it } from "vitest";

describe("bars", () => {
  it("renders nothing rather than an empty section", () => {
    expect(bars([])).toBe("");
  });

  it("clamps the fill and escapes labels", () => {
    const html = bars([{ label: "<b>core</b>", pct: 140 }]);
    expect(html).toContain("--pct:100%");
    expect(html).toContain("&lt;b&gt;core&lt;/b&gt;");
  });
});

describe("lines", () => {
  const coords = (svg: string) =>
    (svg.match(/points="([^"]+)"/)?.[1] ?? "").split(" ");

  it("skips series that cannot make a line", () => {
    expect(lines([])).toBe("");
    expect(lines([{ label: "a", points: [] }])).toBe("");
    expect(lines([{ label: "a", points: [[1, 2]] }])).toBe("");
  });

  it("never emits NaN when every point shares an x or a zero y", () => {
    const svg = lines([
      { label: "flat", points: [[20, 0], [20, 0], [20, 0]] },
    ]);
    expect(svg).not.toContain("NaN");
    expect(coords(svg)).toHaveLength(3);
  });

  it("spans the plot area from the first x to the last", () => {
    const svg = lines([
      { label: "decode", points: [[512, 10], [4096, 5]] },
    ]);
    const [first, last] = coords(svg);
    expect(Number(first!.split(",")[0])).toBeLessThan(
      Number(last!.split(",")[0]),
    );
    expect(Number(first!.split(",")[1])).toBeLessThan(
      Number(last!.split(",")[1]),
    );
  });

  it("labels every point inline and ticks both axes", () => {
    const svg = lines(
      [{ label: "decode", points: [[512, 86.4], [4096, 80.2], [16384, 69]] }],
      { yLabel: "tok/s" },
    );
    // x ticks at the points, in k
    expect(svg).toContain(">0.5k<");
    expect(svg).toContain(">4k<");
    expect(svg).toContain(">16k<");
    // inline values, one decimal at most
    expect(svg).toContain(">86.4<");
    expect(svg).toContain(">69<");
    // a y axis with round ticks and a grid line for each
    expect(svg).toContain(">80<");
    expect(svg).toContain('class="grid"');
    // hover text
    expect(svg).toContain("<title>");
  });
});
