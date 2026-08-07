/** Browser script for interactive compare workbench. */
export const COMPARE_SCRIPT = `
(function () {
  const catalog = window.__COMPARE__;
  const CAT_LABELS = window.__CAT_LABELS__ || {};
  const SERIES = window.__SERIES__ || ["#1f6feb", "#0d7a45", "#c98a00", "#9b59b6", "#e05a3c"];
  if (!catalog || !catalog.length) return;

  const root = document.getElementById("compare-root");
  const pickersEl = document.getElementById("compare-pickers");
  const stickyEl = document.getElementById("compare-sticky");
  const stickyInner = document.getElementById("compare-sticky-inner");
  const titleEl = document.getElementById("compare-title");
  const metaEl = document.getElementById("compare-meta");
  const narrativeEl = document.getElementById("compare-narrative");
  let selected = ["", ""]; // slugs for col 0 and 1
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

  function readPrefill() {
    const params = new URLSearchParams(location.search);
    const a = params.get("a") || "";
    const b = params.get("b") || "";
    if (a && bySlug(a)) selected[0] = a;
    if (b && bySlug(b)) selected[1] = b;
    // avoid same model twice from bad URL
    if (selected[0] && selected[0] === selected[1]) selected[1] = "";
  }

  function writeUrl() {
    const params = new URLSearchParams();
    if (selected[0]) params.set("a", selected[0]);
    if (selected[1]) params.set("b", selected[1]);
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

  function optionsHtml(col) {
    const other = selected[col === 0 ? 1 : 0];
    return (
      '<option value="">' + (col === 0 ? "Select model A…" : "Select model B…") + "</option>" +
      catalog
        .map((r) => {
          const disabled = other && r.slug === other ? " disabled" : "";
          const sel = r.slug === selected[col] ? " selected" : "";
          return (
            '<option value="' +
            esc(r.slug) +
            '"' +
            sel +
            disabled +
            ">" +
            esc(r.short || r.model) +
            "</option>"
          );
        })
        .join("")
    );
  }

  function pickerCard(col) {
    const row = bySlug(selected[col]);
    const color = SERIES[col % SERIES.length];
    const link =
      row && row.href
        ? '<a class="open-report" href="' + esc(row.href) + '">open report →</a>'
        : '<span class="open-report muted-slot">open report →</span>';
    const sub = row
      ? esc(row.engine || row.baseUrl || "")
      : "Choose a model to load scores";
    return (
      '<div class="picker-card" data-col="' +
      col +
      '">' +
      '<div class="picker-card-top">' +
      '<span class="swatch" style="background:' +
      color +
      '"></span>' +
      '<label class="picker-label" for="cmp-pick-' +
      col +
      '">Model ' +
      (col === 0 ? "A" : "B") +
      "</label>" +
      "</div>" +
      '<select class="model-picker" id="cmp-pick-' +
      col +
      '" data-col="' +
      col +
      '">' +
      optionsHtml(col) +
      "</select>" +
      '<div class="picker-sub">' +
      sub +
      "</div>" +
      link +
      "</div>"
    );
  }

  function stickyLabel(col) {
    const row = bySlug(selected[col]);
    const color = SERIES[col % SERIES.length];
    const name = row ? row.short || row.model : "—";
    return (
      '<div class="sticky-col">' +
      '<span class="swatch" style="background:' +
      color +
      '"></span>' +
      '<span class="sticky-name">' +
      esc(name) +
      "</span>" +
      "</div>"
    );
  }

  function bindPickers() {
    if (!pickersEl) return;
    pickersEl.querySelectorAll(".model-picker").forEach((sel) => {
      sel.addEventListener("change", () => {
        const col = Number(sel.getAttribute("data-col"));
        selected[col] = sel.value || "";
        if (selected[0] && selected[0] === selected[1]) {
          selected[col === 0 ? 1 : 0] = "";
        }
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
    return (
      '<div class="cell"><div class="big ' +
      cls +
      '">' +
      text +
      "</div></div>"
    );
  }

  function row(label, vals, higher, textFn) {
    const rows = selected.map((slug) => bySlug(slug));
    const cells = [0, 1]
      .map((i) => cellBig(rows, vals, i, higher, textFn))
      .join("");
    return '<div class="cell metric">' + esc(label) + "</div>" + cells;
  }

  function pctText(v) {
    return v == null ? "—" : v + "%";
  }

  function buildNarrative(a, b) {
    if (!a || !b) {
      return {
        lead: "Pick two models to compare.",
        lines: [
          "Each column starts empty — choose a model from the dropdown above that column.",
          "Scores stay independent: Coverage, Conformance, and Capability are never averaged.",
        ],
      };
    }
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
        label +
          " " +
          x +
          (unit || "%") +
          " → " +
          y +
          (unit || "%") +
          " (" +
          sign +
          d +
          (unit === "" ? "" : "pp") +
          ") · " +
          a.short +
          " → " +
          b.short +
          ".",
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
          "Capability " +
            a.verdict +
            " " +
            a.capability +
            "% → " +
            b.verdict +
            " " +
            b.capability +
            "% · " +
            a.short +
            " → " +
            b.short +
            ".",
        );
      }
    }
    if (a.agenticPassed != null && b.agenticPassed != null) {
      if (
        a.agenticPassed !== b.agenticPassed ||
        a.agenticTotal !== b.agenticTotal
      ) {
        lines.push(
          "Agentic " +
            a.agenticPassed +
            "/" +
            a.agenticTotal +
            " → " +
            b.agenticPassed +
            "/" +
            b.agenticTotal +
            ".",
        );
      }
    }
    if (a.mustViolations !== b.mustViolations) {
      lines.push(
        "MUST violations " + a.mustViolations + " → " + b.mustViolations + ".",
      );
    }
    if (!lines.length) {
      lines.push("No measured score deltas between these two runs.");
    }
    const sameModel = a.model === b.model;
    const sameEngine =
      (a.engine || a.baseUrl || "") === (b.engine || b.baseUrl || "");
    let lead = "Mixed models and engines";
    if (sameModel && !sameEngine) lead = "Same model, different engines";
    else if (!sameModel && sameEngine) lead = "Same engine, different models";
    else if (sameModel && sameEngine)
      lead = "Same model and engine — treat as before/after or depth change";
    return { lead, lines };
  }

  function render() {
    const a = bySlug(selected[0]);
    const b = bySlug(selected[1]);

    if (titleEl) {
      titleEl.textContent =
        a && b
          ? (a.short || a.model) + " vs " + (b.short || b.model)
          : a
            ? (a.short || a.model) + " vs …"
            : b
              ? "… vs " + (b.short || b.model)
              : "Compare models";
    }
    if (metaEl) {
      const bits = [];
      if (a && b) bits.push("2 models selected");
      else if (a || b) bits.push("1 of 2 models selected");
      else bits.push("Select models in each column");
      bits.push(catalog.length + " in library");
      metaEl.innerHTML = bits.map((t) => "<span>" + esc(t) + "</span>").join("");
    }

    const narr = buildNarrative(a, b);
    if (narrativeEl) {
      narrativeEl.innerHTML =
        "<h2>What changed</h2>" +
        '<p class="lead">' +
        esc(narr.lead) +
        "</p>" +
        "<ul>" +
        narr.lines.map((l) => "<li>" + esc(l) + "</li>").join("") +
        "</ul>";
    }

    // Pickers once at the top
    if (pickersEl) {
      pickersEl.innerHTML = pickerCard(0) + pickerCard(1);
      bindPickers();
      bindStickyObserver();
    }
    // Freeze-row labels (spreadsheet-style sticky header)
    if (stickyInner) {
      stickyInner.innerHTML =
        '<div class="sticky-metric"></div>' + stickyLabel(0) + stickyLabel(1);
    }

    const rowsA = [a, b];
    const coreVals = rowsA.map((r) => (r ? r.core : null));
    const confVals = rowsA.map((r) => (r ? r.conformance : null));
    const capVals = rowsA.map((r) => (r ? r.capability : null));
    const agentVals = rowsA.map((r) =>
      r && r.agenticTotal != null
        ? r.agenticPassed / Math.max(1, r.agenticTotal)
        : null,
    );
    const fidVals = rowsA.map((r) => (r ? r.fidelity : null));
    const mustVals = rowsA.map((r) => (r ? r.mustViolations : null));

    let html = "";

    html +=
      '<div class="overview-label"><h2>Primary scores</h2><p>Scores stay independent — never averaged</p></div>';
    html +=
      '<div class="compare-hero" style="--n:2">' +
      row("Coverage (Core)", coreVals, true, pctText) +
      row("Conformance", confVals, true, pctText) +
      row("Capability", capVals, true, (v, r) =>
        v == null
          ? "—"
          : v + "%" + (r && r.verdict ? ' <span class="hint">' + esc(r.verdict) + "</span>" : ""),
      ) +
      row("Agentic", agentVals, true, (v, r) =>
        r && r.agenticTotal != null
          ? r.agenticPassed + "/" + r.agenticTotal
          : "—",
      ) +
      row("Fidelity", fidVals, true, pctText) +
      row("MUST violations", mustVals, false, (v) =>
        v == null ? "—" : String(v),
      ) +
      "</div>";

    html +=
      '<div class="overview-label"><h2>Coverage detail</h2><p>Core · Extended · Frontier</p></div>';
    html +=
      '<div class="compare-hero" style="--n:2">' +
      row("Coverage · core", rowsA.map((r) => (r ? r.core : null)), true, pctText) +
      row(
        "Coverage · extended",
        rowsA.map((r) => (r ? r.extended : null)),
        true,
        pctText,
      ) +
      row(
        "Coverage · frontier",
        rowsA.map((r) => (r ? r.frontier : null)),
        true,
        pctText,
      );

    ["core", "extended", "frontier"].forEach((t) => {
      const cells = rowsA
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
      html +=
        '<div class="cell metric">Missing · ' + esc(t) + "</div>" + cells;
    });
    html += "</div>";

    // categories
    const catIds = [];
    rowsA.forEach((r) => {
      if (!r) return;
      (r.categories || []).forEach((c) => {
        if (!catIds.includes(c.category)) catIds.push(c.category);
      });
    });
    html +=
      '<div class="overview-label"><h2>Capability categories</h2><p>Side-by-side floor check</p></div>';
    html += '<div class="compare-hero" style="--n:2">';
    if (!catIds.length) {
      html +=
        '<div class="cell metric">Categories</div>' +
        '<div class="cell"><span class="hint blank-cell">—</span></div>' +
        '<div class="cell"><span class="hint blank-cell">—</span></div>';
    } else {
      catIds.forEach((cat) => {
        const vals = rowsA.map((r) => {
          if (!r) return null;
          const hit = (r.categories || []).find((c) => c.category === cat);
          return hit ? hit.pct : null;
        });
        const label =
          (rowsA.find((r) => r && (r.categories || []).some((c) => c.category === cat))
            ?.categories || []
          ).find((c) => c.category === cat)?.label ||
          CAT_LABELS[cat] ||
          cat;
        html += row(label, vals, true, pctText);
      });
    }
    html += "</div>";

    // surfaces
    const surfaces = [];
    rowsA.forEach((r) => {
      if (!r) return;
      (r.bySurface || []).forEach((s) => {
        if (!surfaces.includes(s.surface)) surfaces.push(s.surface);
      });
    });
    html +=
      '<div class="overview-label"><h2>Conformance by surface</h2></div>';
    html += '<div class="compare-hero" style="--n:2">';
    if (!surfaces.length) {
      html +=
        '<div class="cell metric">Surfaces</div>' +
        '<div class="cell"><span class="hint blank-cell">—</span></div>' +
        '<div class="cell"><span class="hint blank-cell">—</span></div>';
    } else {
      surfaces.forEach((surface) => {
        const vals = rowsA.map((r) => {
          if (!r) return null;
          const hit = (r.bySurface || []).find((s) => s.surface === surface);
          return hit ? hit.pct : null;
        });
        html += row(surface, vals, true, pctText);
      });
    }
    html += "</div>";

    root.innerHTML = html;
  }

  readPrefill();
  render();
})();
`;
