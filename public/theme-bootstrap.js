// Apply persisted theme synchronously before the React tree mounts
// so the user never sees a Mocha-to-Latte (or vice-versa) flash.
// Mirrors LS_PREFIX + "theme" from src/lib/settings.ts.
(function () {
  try {
    var raw = localStorage.getItem("tsunamisim.theme");
    var theme = raw ? JSON.parse(raw) : "mocha";
    if (theme === "mocha" || theme === "latte") {
      document.documentElement.setAttribute("data-theme", theme);
    }
  } catch (_) {
    /* localStorage unavailable; default Mocha will apply via CSS */
  }
})();
