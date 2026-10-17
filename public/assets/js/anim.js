// Animated explainers: a pause/play button on each, and a still frame for people who prefer reduced motion.
(() => {
  "use strict";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll("figure.anim").forEach((fig) => {
    const svg = fig.querySelector("svg");
    const btn = fig.querySelector(".anim__toggle");
    if (!svg || !btn || typeof svg.pauseAnimations !== "function") { if (btn) btn.hidden = true; return; }
    const set = (playing) => {
      if (playing) svg.unpauseAnimations(); else svg.pauseAnimations();
      btn.textContent = playing ? "Pause animation" : "Play animation";
    };
    btn.addEventListener("click", () => set(svg.animationsPaused()));
    if (reduce) {
      svg.setCurrentTime(Number(fig.dataset.still) || 0);
      set(false);
    }
  });
})();
