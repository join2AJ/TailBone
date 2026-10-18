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
    document.addEventListener("click", (e) => {
      if (nav.classList.contains("is-open") && !nav.contains(e.target) && !burger.contains(e.target)) setNav(false);
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") setNav(false); });
  }

  const header = $("#header");
  if (header) {
    const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 10);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  // Wake the booking server while the visitor reads, so booking is instant even if the server was idle.
  // Once per browser tab; sends nothing about the visitor.
  try {
    if (!sessionStorage.getItem("tbWarm")) {
      sessionStorage.setItem("tbWarm", "1");
      const ping = () => fetch("/api/health", { cache: "no-store" }).catch(() => {});
      ("requestIdleCallback" in window) ? requestIdleCallback(ping, { timeout: 3000 }) : setTimeout(ping, 1500);
    }
  } catch { /* storage unavailable */ }
})();
