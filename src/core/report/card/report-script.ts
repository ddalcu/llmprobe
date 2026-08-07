/** Browser script for single-run report interactivity. */
export const REPORT_SCRIPT = `
(function () {
  const data = window.__LLMPROBE__;
  if (!data) return;

  function setExpanded(btn, panel, open) {
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    panel.hidden = !open;
    panel.classList.toggle("open", open);
  }

  // Generic expand toggles
  document.querySelectorAll("[data-expand]").forEach((btn) => {
    const id = btn.getAttribute("data-expand");
    const panel = document.getElementById(id);
    if (!panel) return;
    btn.addEventListener("click", () => {
      const open = btn.getAttribute("aria-expanded") !== "true";
      setExpanded(btn, panel, open);
    });
  });

  // Tier expand (coverage)
  document.querySelectorAll(".tier-toggle").forEach((btn) => {
    const panel = document.getElementById(btn.getAttribute("aria-controls"));
    if (!panel) return;
    btn.addEventListener("click", () => {
      const open = btn.getAttribute("aria-expanded") !== "true";
      setExpanded(btn, panel, open);
    });
  });

  // Conformance filter table
  const tbody = document.getElementById("conf-tbody");
  const countEl = document.getElementById("conf-filter-count");
  const rows = data.confRows || [];
  let outcomeFilter = "fail"; // default: failures
  let surfaceFilter = "";

  function escHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function pill(status) {
    const cls = ["pass","fail","unsupported","inconclusive","skipped"].includes(status)
      ? status : "not-probed";
    return '<span class="status-pill ' + cls + '">' + escHtml(status) + '</span>';
  }

  function matches(row) {
    if (surfaceFilter && row.surface !== surfaceFilter) return false;
    if (outcomeFilter === "all") return true;
    if (outcomeFilter === "fail") return row.status === "fail" || row.outcome === "fail";
    return row.outcome === outcomeFilter || row.status === outcomeFilter;
  }

  function renderConf() {
    if (!tbody) return;
    const filtered = rows.filter(matches);
    if (countEl) {
      countEl.textContent = filtered.length + " of " + rows.length + " rows";
    }
    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5"><div class="empty-filter">No checks match this filter.</div></td></tr>';
      return;
    }
    tbody.innerHTML = filtered.map((row) => {
      const failCls = row.status === "fail" ? " class=\\"fail-row\\"" : "";
      return "<tr" + failCls + ">" +
        "<td>" + escHtml(row.test) + "</td>" +
        "<td>" + escHtml(row.surface) + "</td>" +
        "<td>" + escHtml(row.assertion) + (row.severity ? ' <span class="fine">(' + escHtml(row.severity) + ")</span>" : "") + "</td>" +
        "<td>" + escHtml(row.evidence || "—") + "</td>" +
        "<td>" + pill(row.status) + "</td>" +
        "</tr>";
    }).join("");
  }

  document.querySelectorAll("[data-outcome-filter]").forEach((chip) => {
    chip.addEventListener("click", () => {
      outcomeFilter = chip.getAttribute("data-outcome-filter");
      document.querySelectorAll("[data-outcome-filter]").forEach((c) =>
        c.classList.toggle("active", c === chip),
      );
      renderConf();
    });
  });

  document.querySelectorAll("[data-surface-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const surface = btn.getAttribute("data-surface-filter");
      if (surfaceFilter === surface) {
        surfaceFilter = "";
        btn.classList.remove("active");
      } else {
        surfaceFilter = surface;
        document.querySelectorAll("[data-surface-filter]").forEach((b) =>
          b.classList.toggle("active", b === btn),
        );
      }
      // When picking a surface, default outcome to all so the surface isn't empty of fails
      if (surfaceFilter) {
        outcomeFilter = "all";
        document.querySelectorAll("[data-outcome-filter]").forEach((c) =>
          c.classList.toggle("active", c.getAttribute("data-outcome-filter") === "all"),
        );
      }
      renderConf();
      const table = document.getElementById("conf-table");
      if (table) table.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });

  const clearSurface = document.getElementById("clear-surface-filter");
  if (clearSurface) {
    clearSurface.addEventListener("click", () => {
      surfaceFilter = "";
      document.querySelectorAll("[data-surface-filter]").forEach((b) => b.classList.remove("active"));
      renderConf();
    });
  }

  renderConf();
})();
`;
