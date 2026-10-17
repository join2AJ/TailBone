// Lightweight page router: the homepage file holds every section, and this shows only the sections
// for the current address (/, /coccydynia, /treatment, /doctor, /locations, /faq, /book) — short pages,
// instant switching, working back button and shareable links. Old "#section" links are redirected.
(() => {
  "use strict";

  const ROUTES = {
    "/": { page: "home", heading: "Tailbone Treatment Clinic", title: "Tailbone Treatment Clinic | Coccydynia Specialist · Bengaluru & New Delhi",
      description: "Specialist, non-surgical care for tailbone (coccyx) pain by Dr Rajveer Singh. Clinics in Bengaluru and New Delhi, plus online consultations." },
    "/coccydynia": { page: "coccydynia", heading: "Coccydynia: symptoms, causes and self-check", title: "What is Coccydynia? Symptoms, Causes & Self-check | Tailbone Treatment",
      description: "Understand tailbone pain: what the coccyx is, common causes, typical symptoms, a quick self-check and everyday tips." },
    "/treatment": { page: "treatment", heading: "Non-surgical tailbone pain treatment", title: "Non-surgical Tailbone Pain Treatment | Tailbone Treatment",
      description: "How Internal Manipulation and a personalised plan treat coccydynia without surgery, step by step." },
    "/doctor": { page: "doctor", heading: "Dr Rajveer Singh, coccydynia specialist", title: "Dr Rajveer Singh, Coccydynia Specialist | Tailbone Treatment",
      description: "Meet Dr Rajveer Singh, consulting in Bengaluru, New Delhi and online, and read what patients say." },
    "/locations": { page: "locations", heading: "Our clinics and opening hours", title: "Clinics in Bengaluru & New Delhi · Timings | Tailbone Treatment",
      description: "Addresses, maps and opening hours of our Bengaluru and New Delhi clinics, plus online consultations." },
    "/faq": { page: "faq", heading: "Frequently asked questions", title: "Frequently Asked Questions | Tailbone Treatment",
      description: "Answers about coccydynia, Internal Manipulation, sessions, referrals and appointments." },
    "/book": { page: "book", heading: "Book an appointment", title: "Book an Appointment | Tailbone Treatment",
      description: "Pick a clinic, day and time and book your tailbone pain consultation in seconds." },
  };
  // Old one-page anchors → new pages (keeps links in old messages and bookmarks working).
  const LEGACY = {
    top: "/", coccydynia: "/coccydynia", checker: "/coccydynia", tips: "/coccydynia",
    treatment: "/treatment", instagram: "/treatment", doctor: "/doctor", stories: "/doctor",
    locations: "/locations", faq: "/faq", appointment: "/book",
  };

  const sections = [...document.querySelectorAll("[data-page], [data-page-except]")];
  const navLinks = [...document.querySelectorAll(".nav a, .footer a, .mbar a")];
  const metaDesc = document.querySelector('meta[name="description"]');
  const main = document.getElementById("main");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const normalise = (path) => {
    const p = path.replace(/\/index\.html$/, "/").replace(/\/+$/, "") || "/";
    return ROUTES[p] ? p : null;
  };

  // Every page gets exactly one <h1>. The home hero has its own; inner pages get a visually hidden one
  // (their visible section headings stay h2/h3, so the heading outline never skips a level).
  const pageTitle = document.createElement("h1");
  pageTitle.className = "visually-hidden";
  pageTitle.id = "pageTitle";
  main.prepend(pageTitle);
  function setPageHeading(page, route) {
    pageTitle.hidden = page === "home";
    pageTitle.textContent = route.heading;
  }

  // Canonical address per page, so search engines index each short page separately.
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    document.head.appendChild(canonical);
  }

  function render(path, { anchor = "", initial = false } = {}) {
    const route = ROUTES[path];
    sections.forEach((el) => {
      const show = el.dataset.page ? el.dataset.page.split(" ").includes(route.page) : el.dataset.pageExcept !== route.page;
      el.hidden = !show;
    });
    setPageHeading(route.page, route);
    canonical.href = location.origin + path;
    document.title = route.title;
    if (metaDesc) metaDesc.setAttribute("content", route.description);
    document.documentElement.dataset.route = route.page;
    navLinks.forEach((a) => {
      const target = normalise(new URL(a.href, location.origin).pathname);
      const active = target === path && a.origin === location.origin;
      a.classList.toggle("is-active", active && !a.classList.contains("btn"));
      if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });

    if (!initial && !reduceMotion) {
      main.classList.remove("page-enter");
      void main.offsetWidth; // restart the animation
      main.classList.add("page-enter");
    }
    const target = anchor && document.getElementById(anchor);
    if (target && !target.closest("[hidden]")) {
      requestAnimationFrame(() => target.scrollIntoView({ behavior: initial || reduceMotion ? "auto" : "smooth" }));
    } else if (!initial) {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
    if (!initial) {
      // Move focus to the content for keyboard and screen-reader users.
      main.setAttribute("tabindex", "-1");
      main.focus({ preventScroll: true });
    }
    window.dispatchEvent(new CustomEvent("routechange", { detail: { path, page: route.page } }));
  }

  function navigate(path, anchor = "", { replace = false } = {}) {
    const url = path + (anchor ? `#${anchor}` : "");
    if (replace) history.replaceState({ path }, "", url);
    else if (location.pathname !== path || location.hash !== (anchor ? `#${anchor}` : "")) history.pushState({ path }, "", url);
    render(path, { anchor });
  }

  // Intercept internal links to routed pages.
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest("a[href]");
    if (!a || a.target === "_blank" || a.hasAttribute("download") || a.origin !== location.origin) return;
    let path = normalise(a.pathname);
    let anchor = a.hash.slice(1);
    if (!path && a.pathname === location.pathname && LEGACY[anchor]) { path = LEGACY[anchor]; }
    if (!path) return;
    if (anchor && LEGACY[anchor] === path && anchor !== "tips" && anchor !== "checker" && anchor !== "instagram") anchor = "";
    e.preventDefault();
    navigate(path, anchor);
  });

  // A bare "#appointment"-style hash typed or linked on the same document.
  window.addEventListener("hashchange", () => {
    const anchor = location.hash.slice(1);
    const path = normalise(location.pathname);
    if (path === "/" && LEGACY[anchor] && LEGACY[anchor] !== "/") {
      const keep = ["tips", "checker", "instagram"].includes(anchor) ? anchor : "";
      navigate(LEGACY[anchor], keep, { replace: true });
    }
  });

  window.addEventListener("popstate", () => {
    const path = normalise(location.pathname) || "/";
    render(path, { anchor: location.hash.slice(1) });
  });

  // First load: honour old "/#appointment"-style links, otherwise the current path.
  let path = normalise(location.pathname) || "/";
  let anchor = location.hash.slice(1);
  if (path === "/" && LEGACY[anchor]) {
    path = LEGACY[anchor];
    anchor = ["tips", "checker", "instagram"].includes(anchor) ? anchor : "";
    history.replaceState({ path }, "", path + (anchor ? `#${anchor}` : ""));
  }
  render(path, { anchor, initial: true });
})();
