// Loaded synchronously in <head> on every page (inline scripts are blocked by our Content-Security-Policy).
(function () {
  // 1) Apply the saved or system theme before first paint to avoid a flash.
  var t = null;
  try { t = localStorage.getItem("theme"); } catch (e) { /* storage unavailable */ }
  document.documentElement.dataset.theme = t || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

  // 2) Light deterrent against casually saving the clinic's photos and videos (right-click / drag).
  // Real protection of patient data is server-side: nothing private is ever sent to public pages.
  var guarded = "img, video, svg, .ig-card, .doctor__photo";
  document.addEventListener("contextmenu", function (e) {
    if (e.target.closest && e.target.closest(guarded)) e.preventDefault();
  });
  document.addEventListener("dragstart", function (e) {
    if (e.target.closest && e.target.closest(guarded)) e.preventDefault();
  });
})();
