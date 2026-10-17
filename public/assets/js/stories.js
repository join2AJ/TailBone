(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const grid = $("#storyGrid");
  const more = $("#moreBtn");
  const PAGE = 12;
  let offset = 0;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  let toastTimer;
  const toast = (text) => {
    const t = $("#toast");
    t.textContent = text;
    t.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-show"), 3200);
  };

  function card(s) {
    const c = el("article", `story${s.featured ? " story--featured" : ""}`);
    const stars = el("div", "stars", "★".repeat(s.rating) + "☆".repeat(5 - s.rating));
    stars.setAttribute("aria-label", `${s.rating} out of 5 stars`);
    c.append(stars);
    if (s.title) c.append(el("h3", "", s.title));
    c.append(el("p", "", s.body));
    const who = el("footer", "story__who");
    who.append(el("span", "q-avatar", s.name[0]));
    const meta = el("div");
    meta.append(el("strong", "", s.name));
    const sub = [s.city, s.duration && `pain for ${s.duration}`].filter(Boolean).join(" · ");
    if (sub) meta.append(el("small", "", sub));
    who.append(meta);
    c.append(who);
    return c;
  }

  async function load() {
    more.disabled = true;
    try {
      const res = await fetch(`/api/stories?limit=${PAGE}&offset=${offset}`);
      if (!res.ok) throw new Error();
      const { stories, total, average, disabled } = await res.json();
      if (disabled) {
        grid.replaceChildren(el("p", "muted center", "Patient stories are not available right now."));
        $("#share").hidden = true;
        more.hidden = true;
        return;
      }
      stories.forEach((s) => grid.append(card(s)));
      offset += stories.length;
      more.hidden = offset >= total;
      if (total) $("#storyStats").textContent = `${total} stories · average rating ${average}/5 · every story is shared by a patient and published with consent.`;
      if (!total) grid.append(el("p", "muted center", "Stories will appear here soon."));
    } catch {
      grid.replaceChildren(el("p", "muted center", "Stories couldn't be loaded right now. Please try again later."));
    } finally {
      more.disabled = false;
    }
  }
  more.addEventListener("click", load);
  load();

  // ---- Share form ----
  const form = $("#shareForm");
  const body = $("#sBody");
  body.addEventListener("input", () => { $("#charCount").textContent = `${body.value.length} / 2000`; });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#shareErr");
    err.hidden = true;
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd);
    payload.rating = Number(payload.rating);
    payload.consent = fd.get("consent") === "on";
    if (!payload.consent) { toast("Please tick the consent box."); return; }
    const btn = e.submitter;
    btn.disabled = true;
    try {
      const res = await fetch("/api/stories", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't send your story. Please try again.");
      form.hidden = true;
      $("#shareDone").hidden = false;
      $("#shareDone").focus();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
    }
  });
})();
