// Shows what the clinic changed in the dashboard's "Website" section: the announcement bar, opening hours, contact
// details, FAQ, newspaper clippings and videos. The pages are built with their own text, so if the server can't be
// reached nothing changes and the built-in content stays.
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Only addresses on this site ("/…") or https links; anything else is dropped (the server checks too).
  const safeUrl = (u) => (typeof u === "string" && /^(\/(?!\/)|https:\/\/)[^\s"<>]*$/.test(u) ? u : "");
  const num = (n) => (Number.isFinite(+n) && +n > 0 ? Math.round(+n) : "");
  const HI = document.documentElement.lang === "hi";
  const BUILT_IN = { phone: "+91 98866 88323", whatsapp: "919886688323", email: "contact@tailbonetreatment.com" };
  const DAYS = HI ? ["रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"] : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const SHORT = HI ? ["रवि", "सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const CLOSED = HI ? "बंद" : "Closed";
  const page = (() => {
    const p = location.pathname.replace(/^\/hi(?=\/|$)/, "").replace(/\.html$/, "").replace(/\/index$/, "/");
    return { "/": "home", "": "home", "/treatment": "treatment", "/doctor": "doctor", "/faq": "faq", "/press": "press" }[p] || "";
  })();

  // Safe text with [link text](/address) links and blank-line paragraphs (the dashboard's FAQ format).
  const rich = (text) => esc(text).split(/\n{2,}/).map((para) => `<p>${para.replace(/\n/g, "<br>")
    .replace(/\[([^\]]+)\]\(((?:\/(?!\/)|https:\/\/)[^)\s]+)\)/g, (m, t, u) => `<a href="${u}"${u.startsWith("/") ? "" : ' target="_blank" rel="noopener"'}>${t}</a>`)}</p>`).join("");

  function announcement(a) {
    if (!a || $(".announce")) return;
    const key = `tb_announce_${a.id}`;
    try { if (sessionStorage.getItem(key)) return; } catch { /* storage blocked: show it */ }
    const bar = document.createElement("div");
    bar.className = `announce announce--${a.tone || "info"}`;
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", HI ? "सूचना" : "Announcement");
    const text = (HI && a.textHi) || a.text;
    bar.innerHTML = `<div class="container announce__inner"><p>${esc(text)}${safeUrl(a.link) ? ` <a href="${esc(safeUrl(a.link))}">${esc(a.linkText || "Find out more")} <span aria-hidden="true">→</span></a>` : ""}</p>
      <button type="button" class="announce__close" aria-label="${HI ? "बंद करें" : "Close announcement"}">×</button></div>`;
    $(".announce__close", bar).addEventListener("click", () => { bar.remove(); try { sessionStorage.setItem(key, "1"); } catch { /* ignore */ } });
    document.body.prepend(bar);
  }

  function hours(h) {
    if (!h) return;
    const span = (d) => (h[d] ? `${h[d][0]} – ${h[d][1]}` : CLOSED);
    $$("#hoursList li[data-day]").forEach((li) => { const s = li.lastElementChild; if (s) s.textContent = span(li.dataset.day); });
    // Footer: group days in a row that share the same hours (Mon – Fri 10:00 – 17:00).
    const order = [1, 2, 3, 4, 5, 6, 0];
    const groups = [];
    for (const d of order) {
      const last = groups.at(-1);
      if (last && span(last.days.at(-1)) === span(d)) last.days.push(d); else groups.push({ days: [d] });
    }
    const label = (g) => (g.days.length === 1 ? DAYS[g.days[0]] : `${SHORT[g.days[0]]} – ${SHORT[g.days.at(-1)]}`);
    $$(".f-hours").forEach((ul) => { ul.innerHTML = groups.map((g) => `<li><span>${esc(label(g))}</span><span>${esc(span(g.days[0]))}</span></li>`).join(""); });
    // The clinic's details for Google (structured data): same hours.
    const EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const spec = groups.filter((g) => h[g.days[0]]).map((g) => ({ "@type": "OpeningHoursSpecification", dayOfWeek: g.days.map((d) => EN[d]), opens: h[g.days[0]][0], closes: h[g.days[0]][1] }));
    $$('script[type="application/ld+json"]').forEach((el) => {
      try {
        let found = false;
        const json = JSON.parse(el.textContent, (k, v) => { if (k === "openingHoursSpecification") { found = true; return spec; } return v; });
        if (found) el.textContent = JSON.stringify(json);
      } catch { /* leave it as built */ }
    });
  }

  function contact(c) {
    if (!c) return;
    const digits = (s) => String(s).replace(/\D/g, "");
    const oldTel = digits(BUILT_IN.phone);
    $$('a[href^="tel:"]').forEach((a) => {
      if (digits(a.getAttribute("href")) !== oldTel) return;
      a.href = `tel:+${digits(c.phone)}`;
      a.childNodes.forEach((n) => { if (n.nodeType === 3 && n.textContent.includes(BUILT_IN.phone)) n.textContent = n.textContent.replace(BUILT_IN.phone, c.phone); });
    });
    $$('a[href*="wa.me/"]').forEach((a) => { a.href = a.getAttribute("href").replace(`wa.me/${BUILT_IN.whatsapp}`, `wa.me/${c.whatsapp}`); });
    $$('a[href^="mailto:"]').forEach((a) => {
      if (!a.getAttribute("href").includes(BUILT_IN.email)) return;
      a.href = a.getAttribute("href").replace(BUILT_IN.email, c.email);
      a.childNodes.forEach((n) => { if (n.nodeType === 3 && n.textContent.includes(BUILT_IN.email)) n.textContent = n.textContent.replace(BUILT_IN.email, c.email); });
    });
  }

  function faq(list) {
    const box = $("#faq .faq");
    if (!list || !box || HI) return; // Hindi FAQ keeps its translated text
    box.innerHTML = list.map((x) => `<details class="reveal is-visible"><summary>${esc(x.q)}</summary>${rich(x.a)}</details>`).join("");
  }

  const prettyDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "");
  function press(list) {
    if (!list) return;
    const grid = $(".press-grid");
    if (grid) {
      grid.innerHTML = list.map((p) => {
        const heading = p.language ? `${p.publication} (${p.language})` : p.publication;
        return `<li class="press-card" id="${esc(p.slug)}">
          <a href="${esc(safeUrl(p.image))}" class="press-card__img" data-full="${esc(safeUrl(p.image))}" data-w="${num(p.width)}" data-h="${num(p.height)}" data-caption="${esc(heading)}${p.date ? `, ${esc(prettyDate(p.date))}` : ""}" aria-label="Open the full clipping: ${esc(heading)}">
            <img src="${esc(safeUrl(p.thumb) || safeUrl(p.image))}" alt="Newspaper clipping: ${esc(p.title || heading)}" width="${num(p.thumbWidth || p.width)}" height="${num(p.thumbHeight || p.height)}" loading="lazy" decoding="async">
          </a>
          <h2>${esc(heading)}</h2>
          <p class="muted small">${p.date ? `<time datetime="${esc(p.date)}">${esc(prettyDate(p.date))}</time>` : ""}</p>
        </li>`;
      }).join("");
    }
    // "As featured in": one link per newspaper, to its first clipping.
    const strip = $(".press-strip");
    if (strip) {
      const seen = new Map();
      for (const p of list) { const name = p.publication.split(",")[0].trim(); if (!seen.has(name)) seen.set(name, p.slug); }
      $$("a:not(.press-strip__more)", strip).forEach((a) => a.remove());
      const more = $(".press-strip__more", strip);
      for (const [name, slug] of seen) {
        const a = document.createElement("a");
        a.href = `/press.html#${slug}`;
        a.textContent = name;
        strip.insertBefore(a, more);
      }
    }
  }

  function videos(all) {
    const list = all?.[page];
    const section = $("#videos");
    if (!section || !list?.length) return;
    const grid = $(".video-grid", section);
    grid.innerHTML = "";
    for (const v of list) {
      const fig = document.createElement("figure");
      if (v.type === "youtube") {
        fig.className = `video-card${v.short ? " video-card--short" : ""}`;
        fig.innerHTML = `<button class="video-card__play" type="button" aria-label="Play video${v.title ? `: ${esc(v.title)}` : ""}">
            <img src="https://i.ytimg.com/vi/${esc(v.id)}/hqdefault.jpg" alt="" loading="lazy" decoding="async"><span class="video-card__icon" aria-hidden="true">▶</span></button>
          ${v.title ? `<figcaption>${esc(v.title)}</figcaption>` : ""}`;
        // YouTube loads only when tapped: faster pages, and no third-party requests until then.
        $(".video-card__play", fig).addEventListener("click", (e) => {
          const iframe = document.createElement("iframe");
          iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?autoplay=1&rel=0`;
          iframe.title = v.title || "YouTube video";
          iframe.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
          iframe.allowFullscreen = true;
          e.currentTarget.replaceWith(iframe);
        });
      } else {
        fig.className = `video-card video-card--ig video-card--${v.kind === "reel" ? "short" : "post"}`;
        fig.innerHTML = `<button class="video-card__play video-card__play--ig" type="button" aria-label="Load Instagram ${v.kind}${v.title ? `: ${esc(v.title)}` : ""}">
            <span class="video-card__icon" aria-hidden="true">${v.kind === "reel" ? "▶" : "◎"}</span><span>${v.kind === "reel" ? "Watch reel" : "View post"}</span></button>
          ${v.title ? `<figcaption>${esc(v.title)}</figcaption>` : ""}`;
        $(".video-card__play", fig).addEventListener("click", (e) => {
          const iframe = document.createElement("iframe");
          if (!/^https:\/\/www\.instagram\.com\/(p|reel)\/[\w-]+\/$/.test(v.url)) return;
          iframe.src = `${v.url}embed/`;
          iframe.title = v.title || `Instagram ${v.kind}`;
          iframe.allow = "encrypted-media; picture-in-picture";
          e.currentTarget.replaceWith(iframe);
        });
      }
      grid.append(fig);
    }
    section.hidden = false;
  }

  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), 5000);
  fetch("/api/site-content", { signal: ctrl?.signal, credentials: "omit" })
    .then((r) => (r.ok && (r.headers.get("content-type") || "").includes("json") ? r.json() : Promise.reject()))
    .then((data) => {
      clearTimeout(timer);
      window.TB_SITE = data;
      const steps = [() => announcement(data.announcement), () => hours(data.hours), () => contact(data.contact), () => faq(data.faq), () => press(data.press), () => videos(data.videos)];
      for (const step of steps) { try { step(); } catch { /* one area failing leaves the others */ } }
      document.dispatchEvent(new CustomEvent("tb:site", { detail: data }));
    })
    .catch(() => { /* server not reachable: the built-in content stays */ });
})();
