// Header behaviour for standalone pages (blog): theme toggle, mobile menu and header shadow.
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const root = document.documentElement;

  $("#themeToggle")?.addEventListener("click", () => {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch { /* storage unavailable */ }
  });

  const nav = $("#nav");
  const burger = $("#burger");
  if (nav && burger) {
    const setNav = (open) => {
      nav.classList.toggle("is-open", open);
      burger.setAttribute("aria-expanded", String(open));
      burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    };
    burger.addEventListener("click", () => setNav(!nav.classList.contains("is-open")));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") setNav(false); });
  }

  const header = $("#header");
  if (header) {
    const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 10);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }
})();
