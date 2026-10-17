// Animated explainers: tap (or Enter/Space when focused) pauses and resumes; people who prefer
// reduced motion get a still frame. Animations also pause while scrolled out of view.
(() => {
  "use strict";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll("figure.anim").forEach((fig) => {
    const svg = fig.querySelector("svg");
    if (!svg || typeof svg.pauseAnimations !== "function") return;
    let userPaused = reduce;
    if (reduce) { svg.setCurrentTime(Number(fig.dataset.still) || 0); svg.pauseAnimations(); }
    fig.tabIndex = 0;
    fig.title = "Tap to pause or play";
    const toggle = () => {
      userPaused = !svg.animationsPaused();
      if (userPaused) svg.pauseAnimations(); else svg.unpauseAnimations();
    };
    fig.addEventListener("click", toggle);
    fig.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([entry]) => {
        if (userPaused) return;
        if (entry.isIntersecting) svg.unpauseAnimations(); else svg.pauseAnimations();
      }).observe(fig);
    }
  });
})();
