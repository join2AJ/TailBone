// Each short page (/, /coccydynia, /treatment, /doctor, /locations, /faq, /book) is its own pre-built HTML
// file (scripts/build-pages.js) with its own title, description, canonical link and heading, so search
// engines and AI assistants can read every page without running scripts. This script only marks the
// current menu item and sends old one-page links ("/#appointment") to the matching new page.
(() => {
  "use strict";

  const PAGES = { "/": "home", "/coccydynia": "coccydynia", "/treatment": "treatment", "/doctor": "doctor", "/locations": "locations", "/faq": "faq", "/book": "book" };
  // Old one-page anchors → new pages (keeps links in old messages and bookmarks working).
  const LEGACY = {
    top: "/", coccydynia: "/coccydynia", checker: "/coccydynia", tips: "/coccydynia",
    treatment: "/treatment", instagram: "/treatment", doctor: "/doctor", stories: "/doctor",
    locations: "/locations", faq: "/faq", appointment: "/book",
  };
  const KEEP_ANCHOR = ["tips", "checker", "instagram"];

  const normalise = (p) => p.replace(/\/index\.html$/, "/").replace(/\.html$/, "").replace(/\/+$/, "") || "/";
  const path = normalise(location.pathname);

  const goLegacy = (anchor) => {
    const to = LEGACY[anchor];
    if (!to || to === "/") return false;
    location.replace(to + (KEEP_ANCHOR.includes(anchor) ? `#${anchor}` : ""));
    return true;
  };
  if (path === "/" && goLegacy(location.hash.slice(1))) return;
  window.addEventListener("hashchange", () => { if (normalise(location.pathname) === "/") goLegacy(location.hash.slice(1)); });

  document.documentElement.dataset.route = PAGES[path] || "";
  document.querySelectorAll(".nav a, .footer a, .mbar a").forEach((a) => {
    const active = a.origin === location.origin && normalise(a.pathname) === path && !a.hash;
    a.classList.toggle("is-active", active && !a.classList.contains("btn"));
    if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  window.dispatchEvent(new CustomEvent("routechange", { detail: { path, page: PAGES[path] } }));
})();
