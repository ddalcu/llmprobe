/** Browser script for interactive compare workbench. */
export const COMPARE_SCRIPT = `
(function () {
  const catalog = window.__COMPARE__;
  const CAT_LABELS = window.__CAT_LABELS__ || {};
  const SERIES = window.__SERIES__ || ["#1f6feb", "#0d7a45", "#c98a00", "#9b59b6", "#e05a3c"];
  if (!catalog || !catalog.length) return;

  const MAX = 4;
  const PARAMS = ["a", "b", "c", "d"];
  const LETTERS = ["A", "B", "C", "D"];

  const root = document.getElementById("compare-root");
  const pickersEl = document.getElementById("compare-pickers");
  const stickyEl = document.getElementById("compare-sticky");
  const stickyInner = document.getElementById("compare-sticky-inner");
  const titleEl = document.getElementById("compare-title");
  const metaEl = document.getElementById("compare-meta");
  const narrativeEl = document.getElementById("compare-narrative");
  /** Selected run slugs, compact (no gaps). */
  let selected = [];
  let stickyBound = false;

  function bySlug(slug) {
    return catalog.find((r) => r.slug === slug) || null;
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** Visible columns: every pick plus one empty slot, between 2 and 4. */
  function slotCount() {
    return Math.min(MAX, Math.max(2, selected.length + 1));
  }

  function slotRuns() {
    const n = slotCount();
    const runs = [];
    for (let i = 0; i < n; i++) runs.push(bySlug(selected[i] || "") );
    return runs;
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return "";
    const d = new Date(t);
    return d.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    });
  }

  /** A run is a model on an engine on a host at a time — the label says all four. */
  function runLabel(r) {
    return [r.short || r.model, r.engine, r.host, fmtDate(r.recordedAt)]
      .filter(Boolean)
      .join(" · ");
  }

  function readPrefill() {
    const params = new URLSearchParams(location.search);
    selected = [];
    for (const key of PARAMS) {
      const v = params.get(key) || "";
      if (v && bySlug(v) && !selected.includes(v) && selected.length < MAX) {
        selected.push(v);
      }
    }
  }

  function writeUrl() {
    const params = new URLSearchParams();
    selected.forEach((slug, i) => params.set(PARAMS[i], slug));
    const q = params.toString();
    const next = location.pathname + (q ? "?" + q : "") + location.hash;
    history.replaceState(null, "", next);
  }

  function rankClass(vals, i, higher) {
    const present = vals.filter((v) => v != null && !Number.isNaN(v));
    if (present.length < 2 || vals[i] == null) return "";
    const best = higher ? Math.max.apply(null, present) : Math.min.apply(null, present);
    const worst = higher ? Math.min.apply(null, present) : Math.max.apply(null, present);
    if (best === worst) return "";
    if (vals[i] === best) return "best";
    if (vals[i] === worst) return "worst";
    return "";
  }

  // Newest benchmark first: the run you just took is the one you're picking.
  const byDate = catalog
    .slice()
    .sort(
      (a, b) =>
        (Date.parse(b.recordedAt || "") || 0) -
        (Date.parse(a.recordedAt || "") || 0),
    );

  function optionsHtml(col) {
    return (
      '<option value="">Select run ' + LETTERS[col] + "…</option>" +
      byDate
        .map((r) => {
          const takenElsewhere =
            selected.includes(r.slug) && selected[col] !== r.slug;
          const sel = r.slug === selected[col] ? " selected" : "";
          return (
            '<option value="' +
            esc(r.slug) +
            '"' +
            sel +
            (takenElsewhere ? " disabled" : "") +
            ">" +
            esc(runLabel(r)) +
            "</option>"
          );
        })
        .join("")
    );
  }

  function pickerCard(col) {
    const row = bySlug(selected[col] || "");
    const color = SERIES[col % SERIES.length];
    const link =
      row && row.href
        ? '<a class="open-report" href="' + esc(row.href) + '">open report →</a>'
        : '<span class="open-report muted-slot">open report →</span>';
    const sub = row
      ? esc([row.engine, row.host].filter(Boolean).join(" · ") || row.baseUrl || "")
      : "Choose a run to load scores";
    return (
      '<div class="picker-card" data-col="' + col + '">' +
      '<div class="picker-card-top">' +
      '<span class="swatch" style="background:' + color + '"></span>' +
      '<label class="picker-label" for="cmp-pick-' + col + '">Run ' + LETTERS[col] + "</label>" +
      "</div>" +
      '<select class="model-picker" id="cmp-pick-' + col + '" data-col="' + col + '">' +
      optionsHtml(col) +
      "</select>" +
      '<div class="picker-sub">' + sub + "</div>" +
      link +
      "</div>"
    );
  }

  function stickyLabel(col) {
    const row = bySlug(selected[col] || "");
    const color = SERIES[col % SERIES.length];
    const name = row ? runLabel(row) : "—";
    return (
      '<div class="sticky-col">' +
      '<span class="swatch" style="background:' + color + '"></span>' +
      '<span class="sticky-name">' + esc(name) + "</span>" +
      "</div>"
    );
  }

  function bindPickers() {
    if (!pickersEl) return;
    pickersEl.querySelectorAll(".model-picker").forEach((sel) => {
      sel.addEventListener("change", () => {
        const col = Number(sel.getAttribute("data-col"));
        const value = sel.value || "";
        if (value) selected[col] = value;
        else selected.splice(col, 1);
        selected = selected.filter(Boolean).slice(0, MAX);
        writeUrl();
        render();
      });
    });
  }

  function bindStickyObserver() {
    if (stickyBound || !pickersEl || !stickyEl) return;
    stickyBound = true;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        // Show freeze header once the picker block leaves the top of the viewport
        const show = e && e.boundingClientRect.bottom < 8;
        stickyEl.classList.toggle("visible", !!show);
        stickyEl.setAttribute("aria-hidden", show ? "false" : "true");
      },
      { root: null, threshold: [0, 0.01, 1], rootMargin: "0px" },
    );
    io.observe(pickersEl);
  }

  function cellBig(rows, vals, i, higher, textFn) {
    if (!rows[i]) {
      return '<div class="cell"><div class="big blank-cell">—</div></div>';
    }
    const cls = rankClass(vals, i, higher);
    const text = textFn(vals[i], rows[i]);
    return '<div class="cell"><div class="big ' + cls + '">' + text + "</div></div>";
  }

  function row(rows, label, vals, higher, textFn) {
    const cells = rows
      .map((_, i) => cellBig(rows, vals, i, higher, textFn))
      .join("");
    return '<div class="cell metric">' + esc(label) + "</div>" + cells;
  }

  function pctText(v) {
    return v == null ? "—" : v + "%";
  }

  function blankRow(rows, label) {
    return (
      '<div class="cell metric">' + esc(label) + "</div>" +
      rows.map(() => '<div class="cell"><span class="hint blank-cell">—</span></div>').join("")
    );
  }

  function buildNarrative(runs) {
    const picked = runs.filter(Boolean);
    if (picked.length < 2) {
      return {
        lead: "Pick two to four runs to compare.",
        lines: [
          "Each column starts empty — choose a run from the dropdown above that column.",
          "The same model on two servers is two different runs; pick each by host.",
          "Scores stay independent: Coverage, Conformance, and Capability are never averaged.",
        ],
      };
    }
    if (picked.length > 2) {
      const lines = [];
      const best = (label, key, higher, fmt) => {
        const withVal = picked.filter((r) => r[key] != null);
        if (withVal.length < 2) return;
        const winner = withVal.reduce((a, b) =>
          higher ? (b[key] > a[key] ? b : a) : (b[key] < a[key] ? b : a),
        );
        lines.push(label + ": " + runLabel(winner) + " leads at " + fmt(winner[key]) + ".");
      };
      best("Coverage core", "core", true, pctText);
      best("Conformance", "conformance", true, pctText);
      best("Capability", "capability", true, pctText);
      best("MUST violations (fewest)", "mustViolations", false, String);
      if (!lines.length) lines.push("No measured score deltas between these runs.");
      return { lead: "Comparing " + picked.length + " runs", lines };
    }
    const a = picked[0];
    const b = picked[1];
    const lines = [];
    const delta = (label, x, y, unit) => {
      if (x == null || y == null) return;
      if (x === y) {
        lines.push(label + " tied at " + x + (unit || "%") + ".");
        return;
      }
      const d = Math.round((y - x) * 10) / 10;
      const sign = d > 0 ? "+" : "";
      lines.push(
        label + " " + x + (unit || "%") + " → " + y + (unit || "%") +
          " (" + sign + d + (unit === "" ? "" : "pp") + ") · " +
          a.short + " → " + b.short + ".",
      );
    };
    delta("Coverage core", a.core, b.core);
    delta("Coverage extended", a.extended, b.extended);
    delta("Coverage frontier", a.frontier, b.frontier);
    delta("Conformance", a.conformance, b.conformance);
    if (a.capability != null && b.capability != null) {
      if (a.verdict === b.verdict && a.capability === b.capability) {
        lines.push("Capability stayed " + a.verdict + " at " + a.capability + "%.");
      } else if (a.verdict === b.verdict) {
        delta("Capability (" + a.verdict + ")", a.capability, b.capability);
      } else {
        lines.push(
          "Capability " + a.verdict + " " + a.capability + "% → " +
            b.verdict + " " + b.capability + "% · " + a.short + " → " + b.short + ".",
        );
      }
    }
    if (a.agenticPassed != null && b.agenticPassed != null) {
      if (a.agenticPassed !== b.agenticPassed || a.agenticTotal !== b.agenticTotal) {
        lines.push(
          "Agentic " + a.agenticPassed + "/" + a.agenticTotal + " → " +
            b.agenticPassed + "/" + b.agenticTotal + ".",
        );
      }
    }
    if (a.mustViolations !== b.mustViolations) {
      lines.push("MUST violations " + a.mustViolations + " → " + b.mustViolations + ".");
    }
    if (!lines.length) {
      lines.push("No measured score deltas between these two runs.");
    }
    const sameModel = a.model === b.model;
    const sameEngine = (a.engine || a.baseUrl || "") === (b.engine || b.baseUrl || "");
    let lead = "Mixed models and engines";
    if (sameModel && !sameEngine) lead = "Same model, different engines";
    else if (!sameModel && sameEngine) lead = "Same engine, different models";
    else if (sameModel && sameEngine)
      lead = "Same model and engine — treat as before/after or depth change";
    return { lead, lines };
  }

  // ---- SVG charts -----------------------------------------------------------

  function fmtTokensK(n) {
    return n >= 1000 ? Math.round(n / 100) / 10 + "k" : String(n);
  }

  /** Inline SVG line chart: log-x prompt tokens, linear-y. Theme via CSS vars. */
  function lineChartSvg(title, unit, series) {
    const W = 460, H = 220;
    const pad = { l: 46, r: 14, t: 26, b: 30 };
    const all = series.flatMap((s) => s.points);
    if (!all.length) return "";
    const xs = all.map((p) => Math.log10(Math.max(1, p.x)));
    const x0 = Math.min.apply(null, xs);
    const x1 = Math.max.apply(null, xs);
    const yMax = Math.max.apply(null, all.map((p) => p.y)) * 1.12 || 1;
    const r1 = (n) => Math.round(n * 10) / 10;
    const sx = (x) =>
      x1 === x0
        ? pad.l + (W - pad.l - pad.r) / 2
        : pad.l + ((Math.log10(Math.max(1, x)) - x0) / (x1 - x0)) * (W - pad.l - pad.r);
    const sy = (y) => H - pad.b - (y / yMax) * (H - pad.t - pad.b);
    const yTicks = [0, 0.25, 0.5, 0.75, 1]
      .map((f) => {
        const v = yMax * f;
        const y = r1(sy(v));
        return (
          '<line x1="' + pad.l + '" y1="' + y + '" x2="' + (W - pad.r) + '" y2="' + y +
          '" stroke="var(--line)" stroke-width="1"/>' +
          '<text x="' + (pad.l - 6) + '" y="' + (y + 3) +
          '" text-anchor="end" font-size="10" fill="var(--muted)">' +
          (v >= 1000 ? r1(v / 1000) + "k" : Math.round(v)) + "</text>"
        );
      })
      .join("");
    const xVals = [...new Set(all.map((p) => p.x))].sort((a, b) => a - b);
    const xTicks = xVals
      .map(
        (v) =>
          '<text x="' + r1(sx(v)) + '" y="' + (H - pad.b + 16) +
          '" text-anchor="middle" font-size="10" fill="var(--muted)">' +
          fmtTokensK(v) + "</text>",
      )
      .join("");
    const lines = series
      .filter((s) => s.points.length > 0)
      .map((s) => {
        const pts = s.points.slice().sort((a, b) => a.x - b.x);
        const d = pts.map((p) => r1(sx(p.x)) + "," + r1(sy(p.y))).join(" ");
        const dots = pts
          .map(
            (p) =>
              '<circle cx="' + r1(sx(p.x)) + '" cy="' + r1(sy(p.y)) + '" r="3" fill="' +
              s.color + '"><title>' + esc(s.label) + " · " + fmtTokensK(p.x) +
              " tok → " + r1(p.y) + " " + esc(unit) + "</title></circle>",
          )
          .join("");
        return (
          '<polyline points="' + d + '" fill="none" stroke="' + s.color +
          '" stroke-width="2"/>' + dots
        );
      })
      .join("");
    return (
      '<svg class="ctx-chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(title) + '">' +
      '<text x="' + pad.l + '" y="15" font-size="11" font-weight="700" fill="var(--ink)">' + esc(title) + "</text>" +
      '<text x="' + (W - pad.r) + '" y="15" text-anchor="end" font-size="10" fill="var(--muted)">' + esc(unit) + "</text>" +
      yTicks + xTicks + lines +
      "</svg>"
    );
  }

  /** Grouped bar chart of the primary scores, one bar color per run. */
  function scoreBarsSvg(metrics, runs) {
    const W = 460, H = 220;
    const pad = { l: 40, r: 14, t: 26, b: 34 };
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;
    const r1 = (n) => Math.round(n * 10) / 10;
    const groupW = plotW / metrics.length;
    const barW = Math.min(26, (groupW - 16) / runs.length);
    const sy = (v) => pad.t + plotH - (v / 100) * plotH;
    const yTicks = [0, 25, 50, 75, 100]
      .map((v) => {
        const y = r1(sy(v));
        return (
          '<line x1="' + pad.l + '" y1="' + y + '" x2="' + (W - pad.r) + '" y2="' + y +
          '" stroke="var(--line)" stroke-width="1"/>' +
          '<text x="' + (pad.l - 6) + '" y="' + (y + 3) +
          '" text-anchor="end" font-size="10" fill="var(--muted)">' + v + "</text>"
        );
      })
      .join("");
    let bars = "";
    metrics.forEach((m, mi) => {
      const cx = pad.l + groupW * mi + groupW / 2;
      const start = cx - (barW * runs.length + 3 * (runs.length - 1)) / 2;
      runs.forEach((run, ri) => {
        const v = m.value(run.r);
        const x = r1(start + ri * (barW + 3));
        if (v == null) {
          bars +=
            '<text x="' + r1(x + barW / 2) + '" y="' + r1(sy(0) - 4) +
            '" text-anchor="middle" font-size="9" fill="var(--muted)">—</text>';
          return;
        }
        const y = r1(sy(v));
        bars +=
          '<rect x="' + x + '" y="' + y + '" width="' + r1(barW) + '" height="' +
          r1(sy(0) - y) + '" rx="2" fill="' + run.color + '"><title>' +
          esc(runLabel(run.r)) + " · " + esc(m.label) + " " + v + "%</title></rect>";
      });
      bars +=
        '<text x="' + r1(cx) + '" y="' + (H - pad.b + 16) +
        '" text-anchor="middle" font-size="10" fill="var(--muted)">' + esc(m.label) + "</text>";
    });
    return (
      '<svg class="ctx-chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Primary scores">' +
      '<text x="' + pad.l + '" y="15" font-size="11" font-weight="700" fill="var(--ink)">Primary scores</text>' +
      '<text x="' + (W - pad.r) + '" y="15" text-anchor="end" font-size="10" fill="var(--muted)">%</text>' +
      yTicks + bars +
      "</svg>"
    );
  }

  function legendHtml(runs) {
    return (
      '<div class="chart-legend">' +
      runs
        .map(
          (run) =>
            '<span><span class="swatch" style="background:' + run.color + '"></span>' +
            esc(runLabel(run.r)) + "</span>",
        )
        .join("") +
      "</div>"
    );
  }

  function chartsHtml(rows) {
    const picked = [];
    rows.forEach((r, i) => {
      if (r) picked.push({ r, color: SERIES[i % SERIES.length] });
    });
    if (picked.length < 2) return "";
    const charts = [];
    charts.push(
      scoreBarsSvg(
        [
          { label: "Core", value: (r) => r.core },
          { label: "Conformance", value: (r) => r.conformance },
          { label: "Capability", value: (r) => r.capability },
          { label: "Fidelity", value: (r) => r.fidelity },
        ],
        picked,
      ),
    );
    const decodeSeries = picked
      .map((run) => ({
        label: runLabel(run.r),
        color: run.color,
        points: (run.r.contextScaling || [])
          .filter((p) => p.decode != null)
          .map((p) => ({ x: p.tokens, y: p.decode })),
      }))
      .filter((s) => s.points.length > 0);
    if (decodeSeries.some((s) => s.points.length >= 2) || decodeSeries.length >= 2) {
      charts.push(lineChartSvg("Decode vs context", "tok/s", decodeSeries));
    }
    const ttftSeries = picked
      .map((run) => ({
        label: runLabel(run.r),
        color: run.color,
        points: (run.r.contextScaling || [])
          .filter((p) => p.ttft != null)
          .map((p) => ({ x: p.tokens, y: p.ttft })),
      }))
      .filter((s) => s.points.length > 0);
    if (ttftSeries.some((s) => s.points.length >= 2) || ttftSeries.length >= 2) {
      charts.push(lineChartSvg("First token vs context", "ms", ttftSeries));
    }
    const drawn = charts.filter(Boolean);
    if (!drawn.length) return "";
    return (
      '<div class="overview-label"><h2>Charts</h2><p>Scores and context scaling — hardware-dependent timings only compare across runs on the same machine</p></div>' +
      '<div class="ctx-charts">' + drawn.join("") + "</div>" +
      legendHtml(picked)
    );
  }

  // ---- render ---------------------------------------------------------------

  function render() {
    const rows = slotRuns();
    const n = rows.length;
    const picked = rows.filter(Boolean);

    if (titleEl) {
      titleEl.textContent = picked.length
        ? picked.map((r) => r.short || r.model).join(" vs ")
        : "Compare runs";
    }
    if (metaEl) {
      const bits = [];
      if (picked.length >= 2) bits.push(picked.length + " runs selected");
      else if (picked.length === 1) bits.push("1 run selected — pick at least one more");
      else bits.push("Select runs in each column");
      bits.push(catalog.length + " in library");
      metaEl.innerHTML = bits.map((t) => "<span>" + esc(t) + "</span>").join("");
    }

    const narr = buildNarrative(rows);
    if (narrativeEl) {
      narrativeEl.innerHTML =
        "<h2>What changed</h2>" +
        '<p class="lead">' + esc(narr.lead) + "</p>" +
        "<ul>" + narr.lines.map((l) => "<li>" + esc(l) + "</li>").join("") + "</ul>";
    }

    // Pickers once at the top
    if (pickersEl) {
      pickersEl.style.setProperty("--n", String(n));
      pickersEl.innerHTML = rows.map((_, i) => pickerCard(i)).join("");
      bindPickers();
      bindStickyObserver();
    }
    // Freeze-row labels (spreadsheet-style sticky header)
    if (stickyInner) {
      stickyInner.style.setProperty("--n", String(n));
      stickyInner.innerHTML =
        '<div class="sticky-metric"></div>' +
        rows.map((_, i) => stickyLabel(i)).join("");
    }

    const grid = '<div class="compare-hero" style="--n:' + n + '">';
    const coreVals = rows.map((r) => (r ? r.core : null));
    const confVals = rows.map((r) => (r ? r.conformance : null));
    const capVals = rows.map((r) => (r ? r.capability : null));
    const agentVals = rows.map((r) =>
      r && r.agenticTotal != null ? r.agenticPassed / Math.max(1, r.agenticTotal) : null,
    );
    const fidVals = rows.map((r) => (r ? r.fidelity : null));
    const mustVals = rows.map((r) => (r ? r.mustViolations : null));

    let html = "";

    html +=
      '<div class="overview-label"><h2>Primary scores</h2><p>Scores stay independent — never averaged</p></div>';
    html +=
      grid +
      row(rows, "Coverage (Core)", coreVals, true, pctText) +
      row(rows, "Conformance", confVals, true, pctText) +
      row(rows, "Capability", capVals, true, (v, r) =>
        v == null
          ? "—"
          : v + "%" + (r && r.verdict ? ' <span class="hint">' + esc(r.verdict) + "</span>" : ""),
      ) +
      row(rows, "Agentic", agentVals, true, (v, r) =>
        r && r.agenticTotal != null ? r.agenticPassed + "/" + r.agenticTotal : "—",
      ) +
      row(rows, "Fidelity", fidVals, true, pctText) +
      row(rows, "MUST violations", mustVals, false, (v) =>
        v == null ? "—" : String(v),
      ) +
      "</div>";

    html += chartsHtml(rows);

    html +=
      '<div class="overview-label"><h2>Coverage detail</h2><p>Core · Extended · Frontier</p></div>';
    html +=
      grid +
      row(rows, "Coverage · core", rows.map((r) => (r ? r.core : null)), true, pctText) +
      row(rows, "Coverage · extended", rows.map((r) => (r ? r.extended : null)), true, pctText) +
      row(rows, "Coverage · frontier", rows.map((r) => (r ? r.frontier : null)), true, pctText);

    ["core", "extended", "frontier"].forEach((t) => {
      const cells = rows
        .map((r) => {
          if (!r) {
            return '<div class="cell"><div class="hint blank-cell">—</div></div>';
          }
          const miss = (r.missing && r.missing[t]) || [];
          return (
            '<div class="cell"><div class="hint" style="color:var(--ink-2)">' +
            (miss.length
              ? miss.map((m) => "✗ " + esc(m)).join("<br>")
              : '<span style="color:var(--good)">none</span>') +
            "</div></div>"
          );
        })
        .join("");
      html += '<div class="cell metric">Missing · ' + esc(t) + "</div>" + cells;
    });
    html += "</div>";

    // categories
    const catIds = [];
    rows.forEach((r) => {
      if (!r) return;
      (r.categories || []).forEach((c) => {
        if (!catIds.includes(c.category)) catIds.push(c.category);
      });
    });
    html +=
      '<div class="overview-label"><h2>Capability categories</h2><p>Side-by-side floor check</p></div>';
    html += grid;
    if (!catIds.length) {
      html += blankRow(rows, "Categories");
    } else {
      catIds.forEach((cat) => {
        const vals = rows.map((r) => {
          if (!r) return null;
          const hit = (r.categories || []).find((c) => c.category === cat);
          return hit ? hit.pct : null;
        });
        const label =
          (rows.find((r) => r && (r.categories || []).some((c) => c.category === cat))
            ?.categories || []
          ).find((c) => c.category === cat)?.label ||
          CAT_LABELS[cat] ||
          cat;
        html += row(rows, label, vals, true, pctText);
      });
    }
    html += "</div>";

    // surfaces
    const surfaces = [];
    rows.forEach((r) => {
      if (!r) return;
      (r.bySurface || []).forEach((s) => {
        if (!surfaces.includes(s.surface)) surfaces.push(s.surface);
      });
    });
    html += '<div class="overview-label"><h2>Conformance by surface</h2></div>';
    html += grid;
    if (!surfaces.length) {
      html += blankRow(rows, "Surfaces");
    } else {
      surfaces.forEach((surface) => {
        const vals = rows.map((r) => {
          if (!r) return null;
          const hit = (r.bySurface || []).find((s) => s.surface === surface);
          return hit ? hit.pct : null;
        });
        html += row(rows, surface, vals, true, pctText);
      });
    }
    html += "</div>";

    root.innerHTML = html;
  }

  readPrefill();
  render();
})();
`;
