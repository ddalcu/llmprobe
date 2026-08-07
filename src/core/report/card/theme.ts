export const THEME_BOOT = `(function(){try{var t=localStorage.getItem("llmprobe-theme");if(t==="dark"||t==="cyber"||t==="light")document.documentElement.setAttribute("data-theme",t);else document.documentElement.setAttribute("data-theme","light");}catch(e){document.documentElement.setAttribute("data-theme","light");}})();`;

export const THEME_SCRIPT = `
(function () {
  var KEY = "llmprobe-theme";
  var root = document.documentElement;
  function apply(theme) {
    if (theme !== "dark" && theme !== "cyber") theme = "light";
    root.setAttribute("data-theme", theme);
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    document.querySelectorAll("[data-theme-select]").forEach(function (el) {
      el.value = theme;
    });
  }
  var current = root.getAttribute("data-theme") || "light";
  apply(current);
  document.querySelectorAll("[data-theme-select]").forEach(function (el) {
    el.addEventListener("change", function () { apply(el.value); });
  });
})();
`;

export function themeSwitcherHtml(): string {
  return `<div class="theme-switch">
    <label for="theme-select">Theme</label>
    <select id="theme-select" data-theme-select aria-label="Color theme">
      <option value="light">Light</option>
      <option value="dark">Dark</option>
      <option value="cyber">Cyber</option>
    </select>
  </div>`;
}
