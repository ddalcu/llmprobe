/** Browser script for the model library ranking table. */
export const LIBRARY_SCRIPT = `
(function () {
  const catalog = window.__LIBRARY__;
  if (!catalog || !catalog.length) return;

  const tbody = document.getElementById("rank-body");
  const sortSelect = document.getElementById("sort-key");
  const dirSelect = document.getElementById("sort-dir");
  const countEl = document.getElementById("library-count");
  const filterMeta = document.getElementById("filter-meta");
  const searchInput = document.getElementById("model-search");
  const searchClear = document.getElementById("search-clear");
  const dock = document.getElementById("compare-dock");
  const picksEl = document.getElementById("compare-picks");
  const goBtn = document.getElementById("compare-go");
  const clearBtn = document.getElementById("compare-clear");

  let sortKey = "date";
  let sortDir = "desc";
  let query = "";
  /** @type {string[]} */
  let selected = [];

  const tone = (n) => {
    if (n == null || Number.isNaN(n)) return "neutral";
    if (n >= 90) return "good";
    if (n >= 70) return "caution";
    return "critical";
  };

  const MAX_COMPARE = 4;
  const PARAMS = ["a", "b", "c", "d"];

  const compareHref = (slugs) => {
    return (
      "compare.html?" +
      slugs
        .map((s, i) => PARAMS[i] + "=" + encodeURIComponent(s))
        .join("&")
    );
  };

  function haystack(row) {
    return [
      row.short,
      row.model,
      row.engine,
      row.baseUrl,
      row.source,
      row.slug,
      row.verdict,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function matchesQuery(row, q) {
    if (!q) return true;
    const h = haystack(row);
    // space-separated tokens all must match (typeahead-friendly)
    return q
      .toLowerCase()
      .trim()
      .split(/\\s+/)
      .filter(Boolean)
      .every((tok) => h.includes(tok));
  }

  function valueOf(row, key) {
    switch (key) {
      case "model": return (row.short || row.model || "").toLowerCase();
      case "core": return row.core;
      case "extended": return row.extended;
      case "frontier": return row.frontier;
      case "coverage": {
        // Rank by core first, then extended, then frontier — not a blended display score
        const c = row.core ?? -1;
        const e = row.extended ?? -1;
        const f = row.frontier ?? -1;
        return c * 1e6 + e * 1e3 + f;
      }
      case "conformance": return row.conformance;
      case "capability": return row.capability;
      case "agentic": return row.agenticRatio;
      case "fidelity": return row.fidelity;
      case "decode": return row.decode;
      case "prefill": return row.prefill;
      case "ttft": return row.ttft;
      case "date": {
        const t = row.recordedAt ? Date.parse(row.recordedAt) : NaN;
        return Number.isNaN(t) ? null : t;
      }
      default: return row.recordedAt ? Date.parse(row.recordedAt) : null;
    }
  }

  function filtered() {
    return catalog.filter((row) => matchesQuery(row, query));
  }

  function sorted() {
    const rows = filtered();
    rows.sort((a, b) => {
      const av = valueOf(a, sortKey);
      const bv = valueOf(b, sortKey);
      const aNull = av == null || Number.isNaN(av);
      const bNull = bv == null || Number.isNaN(bv);
      if (aNull && bNull) return (a.short || "").localeCompare(b.short || "");
      if (aNull) return 1;
      if (bNull) return -1;
      if (typeof av === "string" || typeof bv === "string") {
        const cmp = String(av).localeCompare(String(bv));
        return sortDir === "asc" ? cmp : -cmp;
      }
      if (av === bv) return (a.short || "").localeCompare(b.short || "");
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return rows;
  }

  function fmtPct(n) {
    return n == null ? "—" : n + "%";
  }

  /** 8656.8 → "8.7k". Throughput spans two orders of magnitude across engines. */
  function fmtRate(n) {
    if (n == null || Number.isNaN(n)) return "—";
    if (n >= 1000) return Math.round(n / 100) / 10 + "k";
    return String(Math.round(n * 10) / 10);
  }

  function fmtLatency(ms) {
    if (ms == null || Number.isNaN(ms)) return "—";
    return ms >= 1000 ? Math.round(ms / 100) / 10 + "s" : Math.round(ms) + "ms";
  }

  /** "3h ago" for a fresh run, a plain date once it stops being news. */
  function fmtWhen(iso) {
    if (!iso) return "—";
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return "—";
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    if (mins < 60 * 24) return Math.round(mins / 60) + "h ago";
    const days = Math.round(mins / (60 * 24));
    if (days < 7) return days + "d ago";
    const d = new Date(t);
    return d.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    });
  }

  function tierCell(row) {
    const parts = [
      ["core", row.core],
      ["extended", row.extended],
      ["frontier", row.frontier],
    ];
    return '<span class="tier-stack" title="Core | Extended | Frontier">' +
      parts.map((p, i) => {
        const t = tone(p[1]);
        const bit = '<span class="t ' + t + '">' + fmtPct(p[1]) + "</span>";
        return i ? '<span class="sep">|</span>' + bit : bit;
      }).join("") +
      "</span>";
  }

  function renderTable() {
    const rows = sorted();
    const total = catalog.length;
    if (countEl) {
      countEl.textContent =
        rows.length === total
          ? total + " model" + (total === 1 ? "" : "s")
          : rows.length + " of " + total + " model" + (total === 1 ? "" : "s");
    }
    if (filterMeta) {
      filterMeta.textContent = query.trim()
        ? "Filtered by “" + query.trim() + "” · click headers to sort · select up to 4 to compare"
        : (sortKey === "date" && sortDir === "desc" ? "Newest first · " : "") +
          "click column headers to sort · select up to 4 runs to compare";
    }
    if (searchClear) {
      searchClear.classList.toggle("visible", query.trim().length > 0);
    }
    // mark active header
    document.querySelectorAll(".rank-table th[data-sort]").forEach((th) => {
      const key = th.getAttribute("data-sort");
      th.classList.toggle("active", key === sortKey);
      const ind = th.querySelector(".sort-ind");
      if (ind) ind.textContent = key === sortKey ? (sortDir === "asc" ? "▲" : "▼") : "↕";
    });
    if (sortSelect) sortSelect.value = sortKey;
    if (dirSelect) dirSelect.value = sortDir;

    if (rows.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="11"><div class="empty-filter">No models match your search. Clear the filter to see the full library.</div></td></tr>';
      return;
    }

    tbody.innerHTML = rows.map((row, i) => {
      const isSel = selected.includes(row.slug);
      const confT = tone(row.conformance);
      const capT = tone(row.capability);
      const agent =
        row.agenticPassed == null
          ? "—"
          : row.agenticPassed + "/" + row.agenticTotal;
      const agentT =
        row.agenticRatio == null
          ? "neutral"
          : row.agenticRatio === 1
            ? "good"
            : row.agenticRatio === 0
              ? "critical"
              : "caution";
      const compareDisabled =
        !isSel && selected.length >= MAX_COMPARE ? " disabled" : "";
      return (
        '<tr data-slug="' + row.slug + '"' + (isSel ? ' class="selected"' : "") + ">" +
        '<td class="rank-num">' + (i + 1) + "</td>" +
        '<td><a class="rank-model" href="' + escText(row.href) + '">' + escText(row.short) +
          '<span class="sub">' + escText([row.engine, row.endpoint || row.source].filter(Boolean).join(" · ") || "") + "</span></a></td>" +
        "<td>" + tierCell(row) + "</td>" +
        '<td class="metric-cell ' + confT + '">' + fmtPct(row.conformance) + "</td>" +
        '<td class="metric-cell ' + capT + '">' + fmtPct(row.capability) +
          (row.verdict ? '<span class="verdict">' + escText(row.verdict) + "</span>" : "") +
        "</td>" +
        '<td class="metric-cell ' + agentT + '">' + agent + "</td>" +
        '<td class="perf-cell">' + fmtRate(row.decode) + "</td>" +
        '<td class="perf-cell">' + fmtRate(row.prefill) + "</td>" +
        '<td class="perf-cell">' + fmtLatency(row.ttft) + "</td>" +
        '<td class="when-cell" title="' + escText(row.recordedAt || "") + '">' +
          escText(fmtWhen(row.recordedAt)) + "</td>" +
        '<td><div class="row-actions">' +
          '<a class="btn-sm view" href="' + escText(row.href) + '">View</a>' +
          '<button type="button" class="btn-sm compare-add' + (isSel ? " active" : "") +
            '" data-add="' + escText(row.slug) + '"' + compareDisabled + ">" +
            (isSel ? "Selected" : "Compare") +
          "</button>" +
        "</div></td>" +
        "</tr>"
      );
    }).join("");
  }

  function escText(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setQuery(next) {
    query = next;
    if (searchInput && searchInput.value !== next) searchInput.value = next;
    renderTable();
  }

  function bySlug(slug) {
    return catalog.find((r) => r.slug === slug);
  }

  function renderDock() {
    document.body.classList.toggle("has-dock", selected.length > 0);
    if (!dock) return;
    dock.classList.toggle("visible", selected.length > 0);
    if (!picksEl) return;
    if (selected.length === 0) {
      picksEl.innerHTML = "";
      if (goBtn) goBtn.disabled = true;
      return;
    }
    const slots = selected.map((slug) => {
      const row = bySlug(slug);
      const name = row ? row.short : slug;
      return (
        '<div class="pick"><span>' + escText(name) + "</span>" +
        '<button type="button" class="rm" data-rm="' + escText(slug) + '" aria-label="Remove">×</button></div>'
      );
    });
    if (selected.length === 1) {
      slots.push('<div class="empty-slot">Select at least one more run to compare</div>');
    }
    picksEl.innerHTML = slots.join("");
    if (goBtn) {
      goBtn.disabled = selected.length < 2;
      if (selected.length >= 2) {
        goBtn.dataset.href = compareHref(selected);
      }
    }
  }

  function toggleSelect(slug) {
    const idx = selected.indexOf(slug);
    if (idx >= 0) {
      selected.splice(idx, 1);
    } else if (selected.length < MAX_COMPARE) {
      selected.push(slug);
    }
    renderTable();
    renderDock();
  }

  tbody.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-add]");
    if (!btn || btn.disabled) return;
    toggleSelect(btn.getAttribute("data-add"));
  });

  if (picksEl) {
    picksEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-rm]");
      if (!btn) return;
      toggleSelect(btn.getAttribute("data-rm"));
    });
  }

  if (goBtn) {
    goBtn.addEventListener("click", () => {
      if (selected.length < 2) return;
      window.location.href = compareHref(selected);
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      selected = [];
      renderTable();
      renderDock();
    });
  }

  /**
   * Best-first when a metric is picked: names read A→Z and time-to-first-token
   * is a latency, so both want ascending. Every score wants the high end first.
   */
  function defaultDir(key) {
    return key === "model" || key === "ttft" ? "asc" : "desc";
  }

  function setSort(key, dir) {
    if (key) sortKey = key;
    if (dir) sortDir = dir;
    renderTable();
  }

  if (sortSelect) {
    sortSelect.addEventListener("change", () =>
      setSort(sortSelect.value, defaultDir(sortSelect.value)),
    );
  }
  if (dirSelect) {
    dirSelect.addEventListener("change", () => setSort(null, dirSelect.value));
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      setQuery(searchInput.value);
    });
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && query) {
        e.preventDefault();
        setQuery("");
      }
    });
  }
  if (searchClear) {
    searchClear.addEventListener("click", () => {
      setQuery("");
      if (searchInput) searchInput.focus();
    });
  }

  document.querySelectorAll(".rank-table th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-sort");
      if (sortKey === key) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortKey = key;
        sortDir = defaultDir(key);
      }
      renderTable();
    });
  });

  renderTable();
  renderDock();
})();
`;
