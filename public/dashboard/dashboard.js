// Phase-1 clinic dashboard (/dashboard): website videos, announcement bar, opening hours and contact details, FAQ,
// newspaper clippings and their history; for the super admin also the launch phase and the staff list. Talks only to
// /api/studio (netlify/functions/api.mjs), which signs in with Supabase and keeps the session in HttpOnly cookies.
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const content = $("#content");
  const PAGES = { home: "Home", treatment: "Treatment", doctor: "Doctor" };
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const FEATURES = {
    booking: "Online booking form (while hidden, the website asks people to call, WhatsApp or email)",
    accounts: "My appointments and the follow-up check-in page",
    referrals: "Refer a patient and the partner log-in",
    home_visits: "Request form for treatment at your place (the Clinics tab and FAQ still mention it)",
    story_form: "The \"Share your story\" form",
    stories: "Patient stories (the Stories page and the stories on the Doctor page)",
  };
  const VIEWS = { videos: "Videos", announcement: "Announcement bar", hours: "Opening hours & contact", faq: "FAQ", press: "Newspaper clippings", history: "Change history", launch: "Launch phase", staff: "Staff & activity" };
  const state = { me: null, factorId: null, data: null, defaults: null };

  let toastTimer;
  function toast(text) {
    const t = $("#toast");
    t.textContent = text;
    t.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-show"), 4500);
  }
  const when = (t) => (t ? new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");
  const day = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");

  async function api(path, { method = "GET", body, raw } = {}) {
    const res = await fetch(`/api/studio${path}`, {
      method, credentials: "same-origin",
      headers: { "x-requested-with": "fetch", ...(body !== undefined && !raw ? { "content-type": "application/json" } : {}), ...(raw ? { "content-type": raw.type || "application/octet-stream" } : {}) },
      body: raw || (body === undefined ? undefined : JSON.stringify(body)),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !["/login", "/mfa/verify"].includes(path)) { showLogin(path === "/me" ? "" : data.error); throw new Error(data.error || "Please sign in."); }
    if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    return data;
  }
  async function act(fn) { try { await fn(); } catch (ex) { toast(ex.message); } }

  // ---------- Sign in ----------
  function showForm(id) {
    for (const f of ["#loginForm", "#codeForm", "#enrollForm"]) $(f).hidden = f !== id;
    $("#appView").hidden = true;
    $("#loginView").hidden = false;
    $(`${id} input`)?.focus();
  }
  function showLogin(message) {
    const err = $("#loginErr");
    err.hidden = !message;
    err.textContent = message || "";
    showForm("#loginForm");
  }
  async function startEnroll() {
    const r = await api("/mfa/enroll", { method: "POST", body: {} });
    state.factorId = r.factorId;
    // The QR code comes from Supabase as an SVG; shown as an image so nothing in it can run.
    const src = /^data:image\/svg\+xml/.test(r.qr || "") ? r.qr : `data:image/svg+xml;utf-8,${encodeURIComponent(r.qr || "")}`;
    $("#enrollQr").innerHTML = `<img src="${esc(src)}" alt="QR code for your authenticator app" width="200" height="200">`;
    $("#enrollSecret").textContent = r.secret || "";
    showForm("#enrollForm");
  }
  $("#loginForm").addEventListener("submit", (e) => {
    e.preventDefault();
    $("#loginErr").hidden = true;
    act(async () => {
      const r = await api("/login", { method: "POST", body: { email: $("#loginEmail").value, password: $("#loginPass").value } }).catch((ex) => { showLogin(ex.message); throw ex; });
      $("#loginPass").value = "";
      if (r.step === "mfa") { state.factorId = r.factorId; showForm("#codeForm"); } else await startEnroll();
    });
  });
  const verify = (input) => act(async () => {
    const code = input.value.replace(/\D/g, "");
    await api("/mfa/verify", { method: "POST", body: { factorId: state.factorId, code } }).catch((ex) => { $("#loginErr").hidden = false; $("#loginErr").textContent = ex.message; input.select(); throw ex; });
    input.value = "";
    $("#loginErr").hidden = true;
    boot();
  });
  $("#codeForm").addEventListener("submit", (e) => { e.preventDefault(); verify($("#codeInput")); });
  $("#enrollForm").addEventListener("submit", (e) => { e.preventDefault(); verify($("#enrollCode")); });
  $("#logoutBtn").addEventListener("click", () => act(async () => { await api("/logout", { method: "POST", body: {} }); state.me = null; showLogin(); }));
  $("#sideToggle").addEventListener("click", () => $("#side").classList.toggle("is-open"));

  async function boot() {
    let me;
    try { me = await api("/me"); } catch { return; }
    if (me.aal !== "aal2") {
      // Signed in with the password only: finish two-step sign-in.
      try {
        const r = await api("/login-state");
        if (r.step === "mfa") { state.factorId = r.factorId; showForm("#codeForm"); return; }
        if (r.step === "enroll") { await startEnroll(); return; }
      } catch { /* fall through */ }
      showLogin("Please sign in again.");
      return;
    }
    state.me = me;
    $("#meName").textContent = me.name || (me.role === "superadmin" ? "Super admin" : "Doctor");
    $("#meEmail").textContent = me.email;
    $("#meAvatar").textContent = (me.name || me.email)[0].toUpperCase();
    $$("[data-super]").forEach((a) => { a.hidden = me.role !== "superadmin"; });
    $("#loginView").hidden = true;
    $("#appView").hidden = false;
    route();
  }

  // ---------- Data ----------
  async function load() {
    const [data, defaults] = await Promise.all([api("/website"), state.defaults || fetch("/assets/data/site-defaults.json").then((r) => r.json())]);
    state.data = data;
    state.defaults = defaults;
    const A = data.areas;
    return {
      videos: A.videos || [],
      announcement: A.announcement || { enabled: false, text: "", textHi: "", link: "", linkText: "", start: "", end: "", tone: "info" },
      hours: A.hours || defaults.hours,
      contact: A.contact || defaults.contact,
      faq: (A.faq || defaults.faq).map((x) => ({ ...x })),
      press: (A.press || defaults.press).map((x) => ({ ...x })),
    };
  }
  const save = async (area, value, message) => {
    const r = await api(`/website/${area}`, { method: "PUT", body: { value } });
    toast(message || "Saved. The website shows it within a minute.");
    return r.value;
  };
  const changed = (k) => {
    const m = state.data.meta[k];
    return m ? `<p class="muted small">Last changed ${esc(when(m.updatedAt))} by ${esc(m.updatedBy)}. Earlier versions are under <a href="#/history">History</a>.</p>` : '<p class="muted small">Showing the website\'s built-in content. Your first save replaces it.</p>';
  };
  const moveBtns = (i, n, attr) => `<button type="button" class="btn btn--ghost btn--sm" ${attr}="up" data-i="${i}" ${i ? "" : "disabled"} aria-label="Move up">↑</button> <button type="button" class="btn btn--ghost btn--sm" ${attr}="down" data-i="${i}" ${i < n - 1 ? "" : "disabled"} aria-label="Move down">↓</button>`;
  const moved = (list, i, dir) => { const j = dir === "up" ? i - 1 : i + 1; if (j < 0 || j >= list.length) return list; const c = [...list]; [c[i], c[j]] = [c[j], c[i]]; return c; };
  const pageChecks = (name, chosen) => Object.entries(PAGES).map(([k, v]) => `<label class="check"><input type="checkbox" name="${name}" value="${k}" ${chosen.includes(k) ? "checked" : ""}> ${esc(v)}</label>`).join(" ");

  // ---------- Views ----------
  async function route() {
    if (!state.me) return;
    const name = location.hash.replace(/^#\//, "") || "videos";
    const view = Object.hasOwn(VIEWS, name) && (state.me.role === "superadmin" || !["launch", "staff"].includes(name)) ? name : "videos";
    $("#viewTitle").textContent = VIEWS[view];
    $$(".side__nav a").forEach((a) => a.classList.toggle("is-active", a.dataset.view === view));
    $("#side").classList.remove("is-open");
    content.innerHTML = '<div class="empty">Loading…</div>';
    try { await RENDER[view](); } catch (ex) { content.innerHTML = `<div class="alert alert--error">${esc(ex.message)}</div>`; }
  }
  window.addEventListener("hashchange", route);

  const RENDER = {
    async videos() {
      const { videos } = await load();
      content.innerHTML = `
        <section class="panel-card">
          <h2>Add a video</h2>
          <p class="muted small">Paste a <strong>YouTube</strong> link (Share → Copy link; Shorts work too) or an <strong>Instagram</strong> post or reel link (··· → Copy link). Choose the pages it appears on. Videos load only when a visitor taps them.</p>
          <form class="form" id="vForm">
            <div class="field-row">
              <div class="field" style="flex:2"><label for="vUrl">YouTube or Instagram link</label><input id="vUrl" required placeholder="https://youtu.be/… or https://www.instagram.com/reel/…"></div>
              <div class="field" style="flex:2"><label for="vTitle">Title shown under it</label><input id="vTitle" maxlength="120" placeholder="e.g. Why sitting hurts your tailbone"></div>
            </div>
            <fieldset class="field"><legend>Show on</legend>${pageChecks("pages", ["treatment"])}</fieldset>
            <button class="btn btn--primary btn--sm">Add video</button>
          </form>
        </section>
        <div class="table-wrap"><table>
          <thead><tr><th>Order</th><th>Video</th><th>Shows on</th><th>Shown</th><th></th></tr></thead>
          <tbody>${videos.map((v, i) => `<tr>
            <td class="nowrap">${moveBtns(i, videos.length, "data-move")}</td>
            <td><div class="yt-row">${v.type === "youtube" ? `<img src="https://i.ytimg.com/vi/${esc(v.id)}/default.jpg" alt="" width="80" height="60" loading="lazy">` : '<span class="ig-badge" aria-hidden="true">IG</span>'}
              <span><a href="${esc(v.type === "youtube" ? `https://www.youtube.com/watch?v=${v.id}` : v.url)}" target="_blank" rel="noopener">${esc(v.title || (v.type === "youtube" ? "Untitled video" : `Instagram ${v.kind}`))}</a>${v.short ? ' <span class="badge">Short</span>' : ""}<br><button type="button" class="link-btn small" data-edit="${i}">Edit title</button></span></div></td>
            <td class="small">${Object.entries(PAGES).map(([k, lab]) => `<label class="check"><input type="checkbox" data-page="${i}" value="${k}" ${v.pages.includes(k) ? "checked" : ""}> ${esc(lab)}</label>`).join("<br>")}</td>
            <td><label class="check"><input type="checkbox" data-vis="${i}" ${v.visible !== false ? "checked" : ""}> Visible</label></td>
            <td><button type="button" class="btn btn--danger btn--sm" data-del="${i}">Remove</button></td>
          </tr>`).join("") || '<tr><td colspan="5"><div class="empty">No videos yet. The Videos section stays hidden on the website until you add one.</div></td></tr>'}</tbody>
        </table></div>
        <p class="muted small">On the Treatment page, Instagram posts appear in the "From Instagram" section; YouTube videos appear under Videos.</p>`;
      const put = (list, msg) => act(async () => { await save("videos", list, msg); route(); });
      $("#vForm").addEventListener("submit", (e) => {
        e.preventDefault();
        put([{ url: $("#vUrl").value.trim(), title: $("#vTitle").value, pages: $$('#vForm [name="pages"]:checked').map((c) => c.value), visible: true }, ...videos], "Video added. It shows on the website within a minute.");
      });
      $$("[data-move]").forEach((b) => b.addEventListener("click", () => put(moved(videos, Number(b.dataset.i), b.dataset.move), "Order saved.")));
      $$("[data-vis]").forEach((c) => c.addEventListener("change", () => put(videos.map((v, i) => (i === Number(c.dataset.vis) ? { ...v, visible: c.checked } : v)), c.checked ? "Shown on the website." : "Hidden from the website.")));
      $$("[data-page]").forEach((c) => c.addEventListener("change", () => {
        const i = Number(c.dataset.page);
        const pages = $$(`[data-page="${i}"]:checked`).map((x) => x.value);
        if (!pages.length) { c.checked = true; toast("A video needs at least one page. To take it off the website, untick Visible."); return; }
        put(videos.map((v, k) => (k === i ? { ...v, pages } : v)), "Pages saved.");
      }));
      $$("[data-edit]").forEach((b) => b.addEventListener("click", () => {
        const i = Number(b.dataset.edit);
        const title = prompt("Title shown under the video", videos[i].title || "");
        if (title !== null) put(videos.map((v, k) => (k === i ? { ...v, title } : v)), "Title saved.");
      }));
      $$("[data-del]").forEach((b) => b.addEventListener("click", () => { if (confirm("Remove this video from the website?")) put(videos.filter((_, i) => i !== Number(b.dataset.del)), "Video removed."); }));
    },

    async announcement() {
      const { announcement: A } = await load();
      content.innerHTML = `
        <section class="panel-card">
          <h2>Announcement bar</h2>
          <p class="muted small">A coloured strip at the top of every page, e.g. a holiday closure or "Lucknow clinic now open". Visitors can close it. With dates, it appears and disappears by itself.</p>
          ${changed("announcement")}
          <form class="form" id="aForm">
            <label class="check"><input type="checkbox" name="enabled" ${A.enabled ? "checked" : ""}> Show the announcement</label>
            <div class="field"><label for="aText">Message (English)</label><input id="aText" name="text" maxlength="200" value="${esc(A.text)}" placeholder="e.g. The clinic is closed on 14 November. Online consultations continue."></div>
            <div class="field"><label for="aTextHi">Message in Hindi (optional; the Hindi pages show English if empty)</label><input id="aTextHi" name="textHi" maxlength="200" value="${esc(A.textHi)}"></div>
            <div class="field-row">
              <div class="field"><label for="aLink">Link (optional)</label><input id="aLink" name="link" value="${esc(A.link)}" placeholder="/book or https://…"></div>
              <div class="field"><label for="aLinkText">Link text</label><input id="aLinkText" name="linkText" maxlength="40" value="${esc(A.linkText)}" placeholder="Find out more"></div>
            </div>
            <div class="field-row">
              <div class="field"><label for="aStart">Show from (optional)</label><input id="aStart" type="date" name="start" value="${esc(A.start)}"></div>
              <div class="field"><label for="aEnd">Show until (optional)</label><input id="aEnd" type="date" name="end" value="${esc(A.end)}"></div>
              <div class="field"><label for="aTone">Colour</label><select id="aTone" name="tone">${[["info", "Green (news)"], ["warning", "Amber (closure, change)"], ["success", "Bright green (good news)"]].map(([v, l]) => `<option value="${v}" ${A.tone === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
            </div>
            <p class="small muted" style="margin:.4rem 0 .2rem">Preview</p>
            <div class="announce-preview" id="aPreview"></div>
            <button class="btn btn--primary btn--sm">Save announcement</button>
          </form>
        </section>`;
      const form = $("#aForm");
      const read = () => { const f = new FormData(form); return { enabled: f.get("enabled") === "on", text: f.get("text"), textHi: f.get("textHi"), link: f.get("link"), linkText: f.get("linkText"), start: f.get("start"), end: f.get("end"), tone: f.get("tone") }; };
      const preview = () => {
        const a = read();
        $("#aPreview").innerHTML = a.text ? `<div class="announce announce--${esc(a.tone)}"><div class="announce__inner"><p>${esc(a.text)}${a.link ? ` <a href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.linkText || "Find out more")} →</a>` : ""}</p><span class="announce__close" aria-hidden="true">×</span></div></div>
          <p class="small muted">${a.enabled ? `Shows ${a.start ? `from ${esc(day(a.start))}` : "from now"}${a.end ? ` until ${esc(day(a.end))}` : ""}.` : "Switched off: not shown on the website."}</p>` : '<p class="small muted">Write a message to see the preview.</p>';
      };
      form.addEventListener("input", preview);
      preview();
      form.addEventListener("submit", (e) => { e.preventDefault(); act(async () => { await save("announcement", read(), read().enabled ? "Saved. The bar shows on the website within a minute." : "Saved (switched off)."); route(); }); });
    },

    async hours() {
      const { hours: H, contact: C } = await load();
      content.innerHTML = `
        <section class="panel-card">
          <h2>Opening hours</h2>
          <p class="muted small">Shown on every page: the open/closed status at the top, the Clinics page, the footer and Google's details.</p>
          ${changed("hours")}
          <form class="form" id="hForm">
            <div class="hours-edit">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<div class="hours-edit__row">
              <strong>${DAYS[d]}</strong>
              <label class="check"><input type="checkbox" name="closed-${d}" ${H[d] ? "" : "checked"}> Closed</label>
              <input type="time" name="open-${d}" value="${esc(H[d]?.[0] || "10:00")}" step="1800" aria-label="${DAYS[d]} opens">
              <span aria-hidden="true">–</span>
              <input type="time" name="close-${d}" value="${esc(H[d]?.[1] || "17:00")}" step="1800" aria-label="${DAYS[d]} closes">
            </div>`).join("")}</div>
            <button class="btn btn--primary btn--sm">Save opening hours</button>
          </form>
        </section>
        <section class="panel-card">
          <h2>Contact details</h2>
          <p class="muted small">Changes the phone, WhatsApp and email links on every page.</p>
          ${changed("contact")}
          <form class="form" id="cForm">
            <div class="field-row">
              <div class="field"><label for="cPhone">Phone (as shown)</label><input id="cPhone" name="phone" required value="${esc(C.phone)}"></div>
              <div class="field"><label for="cWa">WhatsApp number (country code, digits only)</label><input id="cWa" name="whatsapp" required inputmode="numeric" value="${esc(C.whatsapp)}"></div>
              <div class="field"><label for="cEmail">Email</label><input id="cEmail" name="email" type="email" required value="${esc(C.email)}"></div>
            </div>
            <button class="btn btn--primary btn--sm">Save contact details</button>
          </form>
        </section>`;
      $("#hForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const value = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, f.get(`closed-${d}`) ? null : [f.get(`open-${d}`), f.get(`close-${d}`)]]));
        if (confirm("Save the new opening hours? They show on every page.")) act(async () => { await save("hours", value, "Opening hours saved."); route(); });
      });
      $("#cForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const value = Object.fromEntries(new FormData(e.target));
        if (confirm("Save the new contact details? They appear on every page.")) act(async () => { await save("contact", value, "Contact details saved."); route(); });
      });
    },

    async faq() {
      let { faq } = await load();
      content.innerHTML = `
        <section class="panel-card">
          <h2>Frequently asked questions</h2>
          <p class="muted small">Shown on the FAQ page (English). Leave a blank line between paragraphs. For a link write <code>[link text](/policies.html)</code>.</p>
          ${changed("faq")}
          <div id="fList" class="stack"></div>
          <div class="row-gap"><button type="button" class="btn btn--ghost btn--sm" id="fAdd">+ Add a question</button>
            <button type="button" class="btn btn--primary btn--sm" id="fSave">Save FAQ</button> <span class="small muted" id="fDirty" hidden>Unsaved changes</span></div>
        </section>`;
      const list = $("#fList");
      const dirty = () => { $("#fDirty").hidden = false; };
      const draw = () => {
        list.innerHTML = faq.map((x, i) => `<div class="faq-edit${x.visible ? "" : " is-hidden"}">
          <div class="faq-edit__bar"><strong>Question ${i + 1}</strong><span>${moveBtns(i, faq.length, "data-fmove")}
            <label class="check"><input type="checkbox" data-fvis="${i}" ${x.visible ? "checked" : ""}> Shown</label>
            <button type="button" class="btn btn--danger btn--sm" data-fdel="${i}">Delete</button></span></div>
          <div class="field"><label for="fq${i}">Question</label><input id="fq${i}" data-fq="${i}" maxlength="200" value="${esc(x.q)}"></div>
          <div class="field"><label for="fa${i}">Answer</label><textarea id="fa${i}" data-fa="${i}" rows="4" maxlength="2000">${esc(x.a)}</textarea></div>
        </div>`).join("") || '<div class="empty">No questions. Add one, or restore the built-in questions from History.</div>';
      };
      draw();
      list.addEventListener("input", (e) => { const t = e.target; if (t.dataset.fq) faq[t.dataset.fq].q = t.value; if (t.dataset.fa) faq[t.dataset.fa].a = t.value; dirty(); });
      list.addEventListener("change", (e) => { if (e.target.dataset.fvis) { faq[e.target.dataset.fvis].visible = e.target.checked; dirty(); draw(); } });
      list.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        if (b.dataset.fmove) { faq = moved(faq, Number(b.dataset.i), b.dataset.fmove); dirty(); draw(); }
        if (b.dataset.fdel && confirm("Delete this question? (It's only removed from the website when you press Save FAQ.)")) { faq.splice(Number(b.dataset.fdel), 1); dirty(); draw(); }
      });
      $("#fAdd").addEventListener("click", () => { faq.push({ q: "", a: "", visible: true }); dirty(); draw(); $(`#fq${faq.length - 1}`).focus(); });
      $("#fSave").addEventListener("click", () => act(async () => { await save("faq", faq, "FAQ saved. The FAQ page shows it within a minute."); route(); }));
    },

    async press() {
      let { press } = await load();
      content.innerHTML = `
        <section class="panel-card">
          <h2>Add a newspaper clipping</h2>
          <p class="muted small">A clear photo or scan of the clipping (JPG, PNG or WebP, up to 4 MB). It appears on the <a href="/press.html" target="_blank" rel="noopener">In the news</a> page, and the newspaper's name appears in "As featured in".</p>
          <form class="form" id="pForm">
            <div class="field-row">
              <div class="field"><label for="pPhoto">Photo of the clipping</label><input id="pPhoto" type="file" accept="image/jpeg,image/png,image/webp" required></div>
              <div class="field"><label for="pPub">Newspaper</label><input id="pPub" required maxlength="80" placeholder="e.g. The Times of India"></div>
            </div>
            <div class="field-row">
              <div class="field" style="flex:2"><label for="pTitle">Headline or description (optional)</label><input id="pTitle" maxlength="160"></div>
              <div class="field"><label for="pDate">Date</label><input id="pDate" type="date"></div>
              <div class="field"><label for="pLang">Edition / language (optional)</label><input id="pLang" maxlength="40" placeholder="Hindi edition"></div>
            </div>
            <button class="btn btn--primary btn--sm">Upload and add</button>
          </form>
        </section>
        <section class="panel-card">
          <h2>Clippings on the website</h2>
          ${changed("press")}
          <div class="table-wrap"><table id="pTable"></table></div>
          <div class="row-gap"><button type="button" class="btn btn--primary btn--sm" id="pSave">Save clippings</button> <span class="small muted" id="pDirty" hidden>Unsaved changes</span></div>
        </section>`;
      const table = $("#pTable");
      const dirty = () => { $("#pDirty").hidden = false; };
      const draw = () => {
        table.innerHTML = `<thead><tr><th>Order</th><th>Clipping</th><th>Newspaper and date</th><th>Shown</th><th></th></tr></thead>
          <tbody>${press.map((p, i) => `<tr>
            <td class="nowrap">${moveBtns(i, press.length, "data-pmove")}</td>
            <td><a href="${esc(p.image)}" target="_blank" rel="noopener"><img src="${esc(p.thumb || p.image)}" alt="" width="64" height="80" style="object-fit:cover;border-radius:6px" loading="lazy"></a></td>
            <td><div class="field"><label class="sr-only" for="pp${i}">Newspaper</label><input id="pp${i}" data-pf="publication" data-i="${i}" value="${esc(p.publication)}" maxlength="80"></div>
              <div class="field-row"><input type="date" data-pf="date" data-i="${i}" value="${esc(p.date)}" aria-label="Date"><input data-pf="language" data-i="${i}" value="${esc(p.language)}" maxlength="40" placeholder="Edition" aria-label="Edition or language"></div></td>
            <td><label class="check"><input type="checkbox" data-pvis="${i}" ${p.visible ? "checked" : ""}> Shown</label></td>
            <td><button type="button" class="btn btn--danger btn--sm" data-pdel="${i}">Delete</button></td>
          </tr>`).join("") || '<tr><td colspan="5"><div class="empty">No clippings.</div></td></tr>'}</tbody>`;
      };
      draw();
      table.addEventListener("input", (e) => { const t = e.target; if (t.dataset.pf) { press[t.dataset.i][t.dataset.pf] = t.value; dirty(); } });
      table.addEventListener("change", (e) => { if (e.target.dataset.pvis) { press[e.target.dataset.pvis].visible = e.target.checked; dirty(); } });
      table.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        if (b.dataset.pmove) { press = moved(press, Number(b.dataset.i), b.dataset.pmove); dirty(); draw(); }
        if (b.dataset.pdel && confirm("Delete this clipping? (It's only removed from the website when you press Save clippings.)")) { press.splice(Number(b.dataset.pdel), 1); dirty(); draw(); }
      });
      $("#pSave").addEventListener("click", () => act(async () => { await save("press", press, "Clippings saved."); route(); }));
      $("#pForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const file = $("#pPhoto").files[0];
        if (!file) { toast("Choose a photo of the clipping."); return; }
        if (file.size > 4 * 1024 * 1024) { toast("Photos up to 4 MB can be added."); return; }
        act(async () => {
          const size = await new Promise((resolve) => { const im = new Image(); im.onload = () => { resolve([im.naturalWidth, im.naturalHeight]); URL.revokeObjectURL(im.src); }; im.onerror = () => resolve([800, 1000]); im.src = URL.createObjectURL(file); });
          const up = await api("/upload", { method: "POST", raw: file });
          const item = { publication: $("#pPub").value, title: $("#pTitle").value, date: $("#pDate").value, language: $("#pLang").value, image: up.media.url, thumb: up.media.url, width: size[0], height: size[1], visible: true };
          await save("press", [item, ...press], "Clipping added. It shows on the In the news page within a minute.");
          route();
        });
      });
    },

    async history() {
      await load();
      const h = state.data.history;
      content.innerHTML = `
        <section class="panel-card">
          <h2>Change history</h2>
          <p class="muted small">Every save keeps the version before it. <strong>Restore</strong> puts that version back on the website (the current one stays in this list, so you can switch back).</p>
          <div class="table-wrap"><table>
            <thead><tr><th>When</th><th>What</th><th>Changed by</th><th></th></tr></thead>
            <tbody>${h.filter((x) => x.key !== "launch").map((x) => `<tr><td class="nowrap small">${esc(when(x.changedAt))}</td><td>${esc(x.label)}</td><td class="small">${esc(x.changedBy)}</td>
              <td><button type="button" class="btn btn--ghost btn--sm" data-restore="${x.id}" data-label="${esc(x.label)}">${x.wasDefault ? "Back to built-in" : "Restore version before this"}</button></td></tr>`).join("") || '<tr><td colspan="4"><div class="empty">No changes yet.</div></td></tr>'}</tbody>
          </table></div>
        </section>`;
      $$("[data-restore]").forEach((b) => b.addEventListener("click", () => {
        if (confirm(`Put back the ${b.dataset.label.toLowerCase()} as it was before this change?`)) act(async () => { await api(`/website/history/${b.dataset.restore}/restore`, { method: "POST", body: {} }); toast("Restored. The website shows it within a minute."); route(); });
      }));
    },

    async launch() {
      const [L, defaults] = await Promise.all([api("/launch"), state.defaults || fetch("/assets/data/site-defaults.json").then((r) => r.json())]);
      state.defaults = defaults;
      const current = L.launch || defaults.launch;
      const hidden = new Set(current.hidden);
      const hiddenArticles = new Set(current.hiddenArticles);
      const shown = defaults.articles.filter((a) => !hiddenArticles.has(a.id)).length;
      content.innerHTML = `
        <section class="panel-card">
          <div class="panel-card__head"><h2>What the website shows</h2>
            <span class="small">${L.publishConnected ? '<span class="badge badge--confirmed">Publishing connected</span>' : '<span class="badge badge--pending">Publishing not connected yet</span>'}</span></div>
          <p class="muted small">Ticked items are <strong>hidden</strong> from the public website for now. Untick to bring them back, press <strong>Save</strong>, then <strong>Publish to website</strong>: the website is rebuilt and the change is live in about two minutes. ${L.launch ? `Last saved ${esc(when(L.launch.updatedAt))} by ${esc(L.launch.updatedBy)}.` : "Showing the settings the website was built with."}</p>
          <form class="form" id="lForm">
            <fieldset class="field"><legend>Hidden features</legend>
              ${Object.entries(FEATURES).map(([k, label]) => `<label class="check"><input type="checkbox" name="feature" value="${k}" ${hidden.has(k) ? "checked" : ""}> ${esc(label)}</label>`).join("<br>")}
            </fieldset>
            <details class="launch-articles"><summary><strong>Articles held back</strong> · ${defaults.articles.length - shown} hidden, ${shown} on the website</summary>
              <div class="table-wrap"><table><thead><tr><th>No.</th><th>Article</th><th>Hidden</th></tr></thead><tbody>
                ${defaults.articles.map((a) => `<tr><td class="nowrap">#${a.id}</td><td>${esc(a.title)}<br><span class="muted small">${esc(a.tags.join(", "))}</span></td>
                  <td><label class="check"><input type="checkbox" name="article" value="${a.id}" ${hiddenArticles.has(a.id) ? "checked" : ""}> Hidden</label></td></tr>`).join("")}
              </tbody></table></div>
            </details>
            <div class="row-gap"><button class="btn btn--primary btn--sm" type="submit">Save</button>
              <button class="btn btn--ghost btn--sm" type="button" id="lPublish">Publish to website</button></div>
          </form>
        </section>`;
      $("#lForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        act(async () => {
          await api("/launch", { method: "PUT", body: { hidden: f.getAll("feature"), hiddenArticles: f.getAll("article").map(Number), articleIds: defaults.articles.map((a) => a.id) } });
          toast("Saved. Press Publish to website to make it live.");
          route();
        });
      });
      $("#lPublish").addEventListener("click", () => {
        if (confirm("Rebuild the public website with the saved launch settings now?")) act(async () => { await api("/launch/publish", { method: "POST", body: {} }); toast("Publishing started. The website updates in about two minutes."); });
      });
    },

    async staff() {
      const { staff, log } = await api("/staff");
      content.innerHTML = `
        <section class="panel-card">
          <div class="panel-card__head"><h2>Staff</h2></div>
          <p class="muted small"><strong>Doctor</strong> accounts can change the website content (videos, announcement, hours, contact, FAQ, clippings). Only the <strong>super admin</strong> sees the launch phase and this page.</p>
          <div class="table-wrap"><table>
            <thead><tr><th>Person</th><th>Role</th><th>Status</th><th></th></tr></thead>
            <tbody>${staff.map((u) => `<tr>
              <td><strong>${esc(u.name || "–")}</strong>${u.email === state.me.email ? ' <span class="badge">You</span>' : ""}<br><span class="muted small">${esc(u.email)}</span></td>
              <td>${u.role === "superadmin" ? '<span class="badge badge--completed">Super admin</span>' : '<span class="badge">Doctor</span>'}</td>
              <td>${u.disabled ? '<span class="badge badge--cancelled">Disabled</span>' : '<span class="badge badge--confirmed">Active</span>'}</td>
              <td>${u.email === state.me.email ? "" : `<div class="item__actions">
                <button class="btn btn--ghost btn--sm" data-toggle="${esc(u.email)}" data-disabled="${u.disabled ? 1 : 0}">${u.disabled ? "Enable" : "Disable"}</button>
                <button class="btn btn--danger btn--sm" data-remove="${esc(u.email)}">Remove</button></div>`}</td>
            </tr>`).join("")}</tbody>
          </table></div>
        </section>
        <section class="panel-card">
          <h2>Add the doctor (or another person)</h2>
          <ol class="small">
            <li>Here: enter their name and email and press <strong>Add</strong>.</li>
            <li>In <strong>Supabase → project tailbone-clinic → Authentication → Users → Add user → Create new user</strong>: the same email and a temporary password, with <strong>Auto Confirm User</strong> ticked. Give them the password in person or by phone.</li>
            <li>They sign in at <strong>${esc(location.origin)}/dashboard</strong> and set up two-step sign-in on their phone.</li>
          </ol>
          <form class="form" id="sForm">
            <div class="field-row">
              <div class="field"><label for="sName">Name</label><input id="sName" maxlength="120" required placeholder="Dr Rajveer Singh"></div>
              <div class="field"><label for="sEmail">Email</label><input id="sEmail" type="email" required></div>
              <div class="field"><label for="sRole">Role</label><select id="sRole"><option value="doctor">Doctor</option><option value="superadmin">Super admin</option></select></div>
            </div>
            <button class="btn btn--primary btn--sm">Add</button>
          </form>
        </section>
        <section class="panel-card">
          <h2>Recent activity</h2>
          <div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>
            ${log.map((l) => `<tr><td class="nowrap small">${esc(when(l.at))}</td><td class="small">${esc(l.actor)}</td><td class="small">${esc(l.action.replace(/_/g, " "))}${l.target ? `: ${esc(l.target)}` : ""}</td></tr>`).join("") || '<tr><td colspan="3"><div class="empty">Nothing yet.</div></td></tr>'}
          </tbody></table></div>
        </section>`;
      $("#sForm").addEventListener("submit", (e) => {
        e.preventDefault();
        act(async () => { await api("/staff", { method: "POST", body: { name: $("#sName").value, email: $("#sEmail").value, role: $("#sRole").value } }); toast("Added. Now create their login in Supabase (step 2)."); route(); });
      });
      $$("[data-toggle]").forEach((b) => b.addEventListener("click", () => act(async () => { await api(`/staff/${encodeURIComponent(b.dataset.toggle)}`, { method: "PATCH", body: { disabled: b.dataset.disabled !== "1" } }); route(); })));
      $$("[data-remove]").forEach((b) => b.addEventListener("click", () => {
        if (confirm(`Remove ${b.dataset.remove} from the staff list? They can no longer change the website.`)) act(async () => { await api(`/staff/${encodeURIComponent(b.dataset.remove)}`, { method: "DELETE" }); route(); });
      }));
    },
  };

  boot().catch(() => showLogin());
})();
