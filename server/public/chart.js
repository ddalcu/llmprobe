// Two chart shapes, hand-rolled SVG. A library would be more code, not less.
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

/** Horizontal bars, 0-100. items: [{label, pct, note}] */
export function bars(items) {
  if (!items.length) return "";
  return `<div class="bars">${items
    .map(
      (
        it,
      ) => `<div class="bar" style="--pct:${Math.max(0, Math.min(100, it.pct))}%">
        <span>${esc(it.label)}</span><b>${it.pct}%</b>${it.note ? `<i>${esc(it.note)}</i>` : ""}
      </div>`,
    )
    .join("")}</div>`;
}

const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const kfmt = (x) =>
  x >= 2000
    ? `${Math.round(x / 1024)}k`
    : x >= 500
      ? `${fmt(Math.round((x / 1024) * 10) / 10)}k`
      : String(x);

/** Round tick step so the axis has 4-6 labels. */
function tickStep(max) {
  const raw = max / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag;
}

/**
 * Line chart over shared x values, x on a log2 scale since the rungs double.
 * series: [{label, points:[[x,y]]}]
 */
export function lines(series, { xLabel = "", yLabel = "", title = "" } = {}) {
  const live = series.filter((s) => s.points.length > 1);
  if (!live.length) return "";
  const xs = [...new Set(live.flatMap((s) => s.points.map((p) => p[0])))].sort(
    (a, b) => a - b,
  );
  const ys = live.flatMap((s) => s.points.map((p) => p[1]));
  const lx = (x) => Math.log2(Math.max(x, 1));
  const [x0, x1] = [lx(xs[0]), lx(xs[xs.length - 1])];
  const step = tickStep(Math.max(...ys, 1));
  const y1 = Math.ceil((Math.max(...ys, 1) * 1.15) / step) * step;
  const W = 420,
    H = 240,
    L = 44,
    R = 16,
    T = title ? 28 : 16,
    B = 40;
  const px = (x) => L + ((lx(x) - x0) / (x1 - x0 || 1)) * (W - L - R);
  const py = (y) => H - B - (y / y1) * (H - T - B);
  const colors = ["var(--bar)", "#e8833a", "#7bc87c"];

  const yticks = [];
  for (let v = 0; v <= y1; v += step) yticks.push(v);

  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img">
    ${title ? `<text x="${W / 2}" y="14" font-size="11" text-anchor="middle" fill="currentColor">${esc(title)}</text>` : ""}
    ${yticks
      .map(
        (v) => `<line class="grid" x1="${L}" y1="${py(v)}" x2="${W - R}" y2="${py(v)}"/>
      <text x="${L - 6}" y="${py(v) + 3}" font-size="9" text-anchor="end" fill="currentColor" opacity="0.6">${fmt(v)}</text>`,
      )
      .join("")}
    ${xs
      .map(
        (x) =>
          `<text x="${px(x)}" y="${H - B + 14}" font-size="9" text-anchor="middle" fill="currentColor" opacity="0.6">${kfmt(x)}</text>`,
      )
      .join("")}
    <line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="var(--line)"/>
    <line x1="${L}" y1="${T}" x2="${L}" y2="${H - B}" stroke="var(--line)"/>
    <text x="${(L + W - R) / 2}" y="${H - 4}" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.6">${esc(xLabel)}</text>
    <text transform="translate(10 ${(T + H - B) / 2}) rotate(-90)" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.6">${esc(yLabel)}</text>
    ${live
      .map((s, i) => {
        const c = colors[i % colors.length];
        return `<polyline fill="none" stroke="${c}" stroke-width="2"
          points="${s.points.map(([x, y]) => `${px(x)},${py(y)}`).join(" ")}"/>
        ${s.points
          .map(([x, y], j) => {
            const anchor =
              j === 0 ? "start" : j === s.points.length - 1 ? "end" : "middle";
            // second series sits above the first, so its labels go up, the first's down
            const dy = i === 0 && live.length > 1 ? 13 : -7;
            return `<g class="pt"><circle cx="${px(x)}" cy="${py(y)}" r="3.5" fill="${c}"/>
            <text x="${px(x)}" y="${py(y) + dy}" font-size="9" text-anchor="${anchor}" fill="${c}">${fmt(y)}</text>
            <title>${esc(s.label)} @ ${kfmt(x)}: ${fmt(y)}</title></g>`;
          })
          .join("")}`;
      })
      .join("")}
  </svg>
  <figcaption class="legend">${live.map((s, i) => `<span style="--c:${colors[i % colors.length]}">${esc(s.label)}</span>`).join("")}</figcaption></figure>`;
}
