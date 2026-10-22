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
    // Remember which ad or link brought the visitor (this tab only) and any referral code (30 days), for the booking form.
    const q = new URLSearchParams(location.search);
    if (!sessionStorage.getItem("tbLanding")) sessionStorage.setItem("tbLanding", location.pathname);
    if (q.get("utm_source") || q.get("gclid")) {
      sessionStorage.setItem("tbAttr", JSON.stringify({ source: q.get("utm_source") || "", medium: q.get("utm_medium") || "", campaign: q.get("utm_campaign") || "", gclid: q.get("gclid") ? 1 : 0, landing: location.pathname }));
    }
    if (/^[A-Za-z0-9-]{4,12}$/.test(q.get("ref") || "") && !/^TB/i.test(q.get("ref"))) localStorage.setItem("tbRef", JSON.stringify({ code: q.get("ref"), at: Date.now() }));
  } catch { /* storage unavailable */ }
})();
