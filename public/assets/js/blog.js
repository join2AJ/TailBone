// Blog search and topic filter (on /blog/), and hiding articles the clinic has switched off in the dashboard.
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const slugOf = (href) => { const s = (/^\/blog\/([a-z0-9-]+)\.html$/.exec(href || "") || [])[1]; return s === "index" ? undefined : s; };

  // ---------- Articles switched off by the admin ----------
  // The pages are static, so the list comes from the server. If it can't be reached, everything stays visible.
  function applyHidden(hidden) {
    const slugs = new Set(hidden.map((h) => h.slug));
    const ids = new Set(hidden.map((h) => String(h.id)));
    const own = $("article[data-post-id]");
    if (own && ids.has(own.dataset.postId)) {
      const meta = document.createElement("meta");
      meta.name = "robots"; meta.content = "noindex";
      document.head.append(meta);
      own.innerHTML = `<div class="post-unavailable"><h1>This article is no longer available</h1>
        <p class="muted">It may have been withdrawn for review.</p>
        <p><a class="btn btn--primary" href="/blog/">Browse all articles</a></p></div>`;
    }
    $$("[data-post-id]").forEach((el) => { if (el !== own && ids.has(el.dataset.postId)) el.remove(); });
    $$('a[href^="/blog/"]').forEach((a) => {
      if (!slugs.has(slugOf(a.getAttribute("href")))) return;
      const li = a.closest("li");
      if (li) li.remove(); else a.replaceWith(...a.childNodes);
    });
  }
  const linksArticles = $$('a[href^="/blog/"]').some((a) => slugOf(a.getAttribute("href"))) || $("[data-post-id]");
  const hiddenReady = linksArticles
    ? fetch("/api/blog/hidden").then((r) => (r.ok ? r.json() : { hidden: [] })).then((d) => { applyHidden(d.hidden || []); }).catch(() => {})
    : Promise.resolve();

  // ---------- Search and topic filter ----------
  const grid = $("#postGrid");
  if (!grid) return;
  const input = $("#blogQ");
  const count = $("#blogCount");
  const empty = $("#blogEmpty");
  const chips = $$(".blog-tags .chip");
  let index = null; // full text of every article, loaded the first time someone searches
  let tag = "";

  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "");
  const words = (q) => norm(q).split(/[^a-z0-9ऀ-ॿ]+/).filter((w) => w.length > 1);

  function loadIndex() {
    if (!index) index = fetch("/blog/search.json").then((r) => r.json()).then((list) => new Map(list.map((p) => [String(p.id), p]))).catch(() => new Map());
    return index;
  }

  async function apply({ push = true } = {}) {
    const q = input.value.trim();
    const terms = words(q);
    const text = terms.length ? await loadIndex() : new Map();
    const cards = $$("#postGrid .post-card");
    const scored = cards.map((card) => {
      const order = Number(card.dataset.order);
      const id = card.dataset.postId;
      const tags = (card.dataset.tags || "").split("|");
      if (tag && !tags.includes(tag)) return { card, score: -1, order };
      if (!terms.length) return { card, score: 1, order };
      const p = text.get(id);
      const title = norm(p?.title || card.querySelector("h2").textContent);
      const extra = norm(`${p?.summary || ""} ${tags.join(" ")}`);
      const body = norm(p?.text || card.textContent);
      let score = 0;
      for (const w of terms) {
        const hits = Math.min(body.split(w).length - 1, 8); // how often the article mentions it, capped
        const s = (title.includes(w) ? 10 : 0) + (extra.includes(w) ? 4 : 0) + hits;
        if (!s) return { card, score: -1, order }; // every word must appear somewhere
        score += s;
      }
      return { card, score, order };
    });
    // Best matches first when searching; otherwise newest first, as built.
    scored.sort((a, b) => (terms.length ? b.score - a.score : 0) || a.order - b.order);
    let shown = 0;
    for (const { card, score } of scored) {
      card.hidden = score < 0;
      if (score >= 0) shown++;
      grid.append(card);
    }
    const noun = `${shown} ${shown === 1 ? "article" : "articles"}`;
    count.textContent = `${noun}${q ? ` found for “${q}”` : ""}${tag ? ` in ${tag}` : ""}`;
    empty.hidden = shown > 0;
    chips.forEach((c) => { const on = c.dataset.tag === tag; c.classList.toggle("is-active", on); c.setAttribute("aria-pressed", String(on)); });
    if (push) {
      const url = new URL(location.href);
      q ? url.searchParams.set("q", q) : url.searchParams.delete("q");
      tag ? url.searchParams.set("tag", tag) : url.searchParams.delete("tag");
      history.replaceState(null, "", url);
    }
  }

  $$("#postGrid .post-card").forEach((c, i) => { c.dataset.order = i; });
  let timer;
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(apply, 150); });
  input.addEventListener("focus", loadIndex, { once: true });
  $("#blogSearch").addEventListener("submit", (e) => { e.preventDefault(); apply(); input.blur(); });
  chips.forEach((c) => c.addEventListener("click", () => { tag = c.dataset.tag === tag ? "" : c.dataset.tag; apply(); }));
  $("#blogReset")?.addEventListener("click", () => { input.value = ""; tag = ""; apply(); input.focus(); });

  const params = new URLSearchParams(location.search);
  input.value = params.get("q") || "";
  tag = chips.some((c) => c.dataset.tag === params.get("tag")) ? params.get("tag") : "";
  hiddenReady.then(() => { if (input.value || tag) apply({ push: false }); else count.textContent = `${$$("#postGrid .post-card").length} articles`; });
})();
