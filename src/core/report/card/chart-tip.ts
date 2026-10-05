/**
 * One floating tooltip for every chart mark. Marks are SVG elements with class
 * `pt` and data-run / data-sub / data-val; the listeners sit on the document,
 * so charts re-rendered later keep working.
 */
export const CHART_TIP_SCRIPT = `
(function () {
  var esc = function (s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  };
  var tip = document.createElement("div");
  tip.className = "chart-tip";
  document.addEventListener("DOMContentLoaded", function () {
    document.body.appendChild(tip);
  });
  var mark = function (e) {
    return e.target.closest && e.target.closest(".pt");
  };
  document.addEventListener("mouseover", function (e) {
    var t = mark(e);
    if (!t) return;
    var d = t.dataset;
    tip.innerHTML =
      '<div class="tip-run"><span class="swatch" style="background:' +
      esc(t.getAttribute("fill")) + '"></span>' + esc(d.run) + "</div>" +
      '<div class="tip-val">' + esc(d.val) + "</div>" +
      '<div class="tip-sub">' + esc(d.sub) + "</div>";
    tip.classList.add("on");
  });
  document.addEventListener("mousemove", function (e) {
    if (!tip.classList.contains("on")) return;
    var x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    tip.style.transform = "translate(" + Math.max(8, x) + "px," + (e.clientY + 14) + "px)";
  });
  document.addEventListener("mouseout", function (e) {
    if (mark(e)) tip.classList.remove("on");
  });
})();
`;
