(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const content = $("#content");
  const modal = $("#modal");
  const modalBody = $("#modalBody");
  const state = { admin: null, clinics: [], today: null, apptFilter: { from: null, to: "", status: "", clinic: "", q: "" }, fuView: "due", storyView: "pending" };

  // ---------- Utilities ----------
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const CLINIC = { del: "New Delhi", online: "Online", lko: "Lucknow", blr: "Bengaluru" };
  const STATUS = { pending: "Pending", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled", no_show: "No-show" };
  const FU_TYPE = { checkin: "Check-in form", call: "Phone call", visit: "Review visit", whatsapp: "WhatsApp message" };
  // All dates and times are shown in clinic time (IST), whatever the computer's own time zone.
  // A plain date ("2026-10-17") is a calendar day; a timestamp ("2026-10-17 20:15:00", stored in UTC) is converted to IST.
  const asDate = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00+05:30`) : new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(d) ? d : `${d.replace(" ", "T")}Z`));
  const day = (d, opts = { weekday: "short", day: "numeric", month: "short" }) => (d ? asDate(d).toLocaleDateString("en-IN", { ...opts, timeZone: "Asia/Kolkata" }) : "");
  const when = (d, opts = { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) => (d ? asDate(d).toLocaleString("en-IN", { ...opts, timeZone: "Asia/Kolkata" }) : "");
  const time12 = (t) => { const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
  const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const phonePretty = (p) => (p && p.startsWith("91") && p.length === 12 ? `+91 ${p.slice(2, 7)} ${p.slice(7)}` : `+${p}`);
  const badge = (s) => `<span class="badge badge--${esc(s)}">${esc(STATUS[s] || s)}</span>`;
  const pain = (v) => (v == null ? "—" : `<span class="pain" style="--v:${Number(v)}">${Number(v)}</span>`);
  const rupees = (paise) => `₹${(Number(paise || 0) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const PAY = { paid: "Paid", refunded: "Refunded", partially_refunded: "Part refunded", pay_at_clinic: "Pay at clinic", awaiting: "Awaiting payment", unpaid: "—" };
  const payBadge = (a) => (a.fee ? `<span class="badge badge--${a.payment_status === "paid" ? "confirmed" : a.payment_status.includes("refund") ? "completed" : "pending"}">${esc(PAY[a.payment_status] || a.payment_status)}</span>` : "");
  const EVENT = {
    booked: "Booked", confirmed: "Confirmed", completed: "Completed", pending: "Set to pending", rescheduled: "Rescheduled", cancelled: "Cancelled",
    no_show: "Marked no-show", paid: "Payment received", refunded: "Refund issued", refund_failed: "Refund failed", hold_expired: "Unpaid hold expired",
    payment_error: "Payment error", paid_late: "Late payment",
  };

  let toastTimer;
  function toast(text) {
    const t = $("#toast");
    t.textContent = text;
    t.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-show"), 3000);
  }

  async function api(path, { method = "GET", body } = {}) {
    const res = await fetch(`/api/admin${path}`, {
      method,
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-requested-with": "fetch" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== "/login") {
      const wasSignedIn = !!state.admin;
      showLogin();
      if (wasSignedIn) {
        $("#loginErr").textContent = "You were signed out after 30 minutes without activity (or from another device). Please sign in again.";
        $("#loginErr").hidden = false;
      }
      throw new Error(data.error || "Please sign in.");
    }
    if (!res.ok) throw new Error(data.error || "Request failed.");
    return data;
  }

  // Tie each visible <label> to its field so screen readers announce it (labels are written without "for").
  let fieldSeq = 0;
  function linkLabels(root) {
    root.querySelectorAll(".field").forEach((field) => {
      const label = field.querySelector(":scope > label:not([for])");
      const control = field.querySelector("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea");
      if (!label || !control || label.contains(control)) return;
      if (!control.id) control.id = `f${++fieldSeq}`;
      label.htmlFor = control.id;
    });
    root.querySelectorAll("th:empty").forEach((th) => { th.innerHTML = '<span class="visually-hidden">Actions</span>'; });
    // On phones each table row is shown as a card; data-label gives every cell its column name (see admin.css).
    root.querySelectorAll("table").forEach((table) => {
      const heads = [...table.querySelectorAll("thead th")].map((th) => th.textContent.trim());
      table.querySelectorAll("tbody tr").forEach((tr) => [...tr.children].forEach((td, i) => {
        if (heads[i] && !td.hasAttribute("data-label") && !td.hasAttribute("colspan")) td.dataset.label = heads[i];
      }));
    });
    // Scrollable tables must be reachable with the keyboard.
    root.querySelectorAll(".table-wrap:not([tabindex])").forEach((w) => { w.tabIndex = 0; w.setAttribute("role", "region"); w.setAttribute("aria-label", "Table"); });
  }
  new MutationObserver(() => { linkLabels(content); linkLabels(modalBody); }).observe(document.body, { childList: true, subtree: true });

  const openModal = (html) => { modalBody.innerHTML = html; delete modal.dataset.dirty; modal.showModal(); };
  const closeModal = () => { delete modal.dataset.dirty; modal.close(); };
  // Typing in a dialog marks it changed; closing it then asks first, so a stray click or Esc can't wipe a form.
  modalBody.addEventListener("input", () => { modal.dataset.dirty = "1"; });
  const mayClose = () => !modal.dataset.dirty || confirm("Close without saving? What you typed will be lost.");
  /** Ask, then run an action; errors are shown instead of failing silently. */
  async function confirmThen(question, action) {
    if (question && !confirm(question)) return;
    try { await action(); } catch (ex) { toast(ex.message); }
  }
  /** Toast with an Undo button (used for quick, reversible changes). */
  function undoToast(text, undo) {
    const t = $("#toast");
    t.innerHTML = `${esc(text)} <button type="button" class="toast__undo">Undo</button>`;
    t.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-show"), 6000);
    t.querySelector("button").addEventListener("click", async () => { t.classList.remove("is-show"); try { await undo(); route(); } catch (ex) { toast(ex.message); } }, { once: true });
  }

  // ---------- Auth ----------
  function showLogin() {
    state.admin = null;
    $("#appView").hidden = true;
    $("#loginView").hidden = false;
    $("#loginEmail").focus();
  }

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#loginErr");
    err.hidden = true;
    const res = await fetch("/api/admin/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: $("#loginEmail").value, password: $("#loginPass").value, code: $("#loginCode").value || undefined }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : { error: "Can't reach the server." };
    if (res && res.ok) {
      $("#loginPass").value = "";
      $("#loginCode").value = "";
      $("#codeField").hidden = true;
      boot();
      return;
    }
    if (data.needCode) {
      $("#codeField").hidden = false;
      $("#loginCode").focus();
    }
    err.textContent = data.error || "Sign-in failed.";
    err.hidden = false;
  });

  $("#logoutBtn").addEventListener("click", async () => {
    await api("/logout", { method: "POST" }).catch(() => {});
    showLogin();
  });

  // ---------- Demo mode (only when the server runs with DEMO_MODE=true) ----------
  async function demoSignIn() {
    const res = await fetch("/api/admin/demo-login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" } });
    if (!res.ok) { toast((await res.json().catch(() => ({}))).error || "Demo unavailable."); return; }
    history.replaceState(null, "", "/admin#/overview");
    boot();
  }
  $("#demoLoginBtn").addEventListener("click", demoSignIn);
  fetch("/api/config").then((r) => (r.ok ? r.json() : Promise.reject(new Error("no server")))).then((cfg) => {
    if (!cfg?.demo) return;
    $("#demoLogin").hidden = false;
    if (new URLSearchParams(location.search).get("demo") === "1" && !state.admin) demoSignIn();
  }).catch(() => { $("#serverNotice").hidden = false; });

  async function boot() {
    try {
      const me = await api("/me");
      Object.assign(state, { admin: me.admin, clinics: me.clinics, today: me.today, demo: me.demo, features: me.features });
      applyAccess();
      state.apptFilter.from ??= me.today;
      $("#meName").textContent = me.admin.name;
      $("#meEmail").textContent = me.admin.email;
      $("#meAvatar").textContent = me.admin.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
      $("#loginView").hidden = true;
      $("#appView").hidden = false;
      if (me.demo && !$("#demoBar")) {
        const bar = document.createElement("div");
        bar.id = "demoBar";
        bar.className = "demo-bar";
        bar.setAttribute("role", "region");
        bar.setAttribute("aria-label", "Demo notice");
        bar.innerHTML = '<span><strong>Demo dashboard</strong> · sample patients · changes reset daily · no real messages or payments are sent</span><span class="demo-bar__actions"><a href="/manage.html?demo=1" target="_blank" rel="noopener">Open the patient view</a></span>';
        $(".main").prepend(bar);
      }
      route();
    } catch {
      showLogin();
    }
  }

  // ---------- Router ----------
  const VIEWS = {
    overview: ["Overview", renderOverview],
    appointments: ["Appointments", renderAppointments],
    followups: ["Follow-ups", renderFollowups],
    patients: ["Patients", renderPatients],
    patient: ["Patient", renderPatient],
    stories: ["Patient stories", renderStories],
    inbox: ["Inbox", renderInbox],
    privacy: ["Privacy & data requests", renderPrivacy],
    payments: ["Payments", renderPayments],
    instagram: ["Instagram highlights", renderInstagram],
    blog: ["Blog articles", renderBlog],
    settings: ["Settings", renderSettings],
    control: ["Control panel", renderControl],
  };

  // Which dashboard section needs which permission (the server enforces the same rules).
  const VIEW_PERM = {
    appointments: "appointments", inbox: "inbox", followups: "followups", patients: "patients", patient: "patients",
    stories: "stories", instagram: "instagram", blog: "blog", payments: "payments", privacy: "privacy", control: "superadmin",
  };
  const allowed = (view) => !VIEW_PERM[view] || state.admin.permissions.includes(VIEW_PERM[view]);
  function applyAccess() {
    $$(".side__nav a").forEach((a) => { a.hidden = !allowed(a.dataset.view); });
    $("#newApptBtn").hidden = !allowed("appointments");
  }

  async function route() {
    if (!state.admin) return;
    const [, name = "overview", param] = location.hash.split("/");
    if (!allowed(name)) {
      $("#viewTitle").textContent = "No access";
      content.innerHTML = '<div class="empty">You don\'t have access to this section. Ask the super admin to enable it for you.</div>';
      return;
    }
    const [title, render] = VIEWS[name] || VIEWS.overview;
    $("#viewTitle").textContent = title;
    $$(".side__nav a").forEach((a) => a.classList.toggle("is-active", a.dataset.view === (name === "patient" ? "patients" : name)));
    $("#side").classList.remove("is-open");
    content.innerHTML = '<div class="empty">Loading…</div>';
    try {
      await render(param);
    } catch (e) {
      content.innerHTML = `<div class="alert alert--error">${esc(e.message)}</div>`;
    }
    content.focus({ preventScroll: true });
    refreshBadges();
  }
  window.addEventListener("hashchange", route);

  async function refreshBadges() {
    try {
      const { stats } = await api("/dashboard");
      const fu = $("#fuCount");
      fu.hidden = !stats.followupsDue;
      fu.textContent = stats.followupsDue;
      const st = $("#storyCount");
      st.hidden = !stats.storiesPending;
      st.textContent = stats.storiesPending;
      if (allowed("privacy")) api("/privacy/requests").then(({ requests }) => {
        const open = requests.filter((q) => ["open", "verifying"].includes(q.status)).length;
        $("#privCount").hidden = !open;
        $("#privCount").textContent = open;
      }).catch(() => {});
      const ib = $("#inboxCount");
      const inbox = stats.unread + stats.toSend;
      ib.hidden = !inbox;
      ib.textContent = inbox;
    } catch { /* ignore */ }
  }

  // ---------- Shared row renderers ----------
  function apptActions(a) {
    const btns = [];
    if (a.status === "pending") btns.push(`<button class="btn btn--primary btn--sm" data-act="confirm" data-id="${a.id}">Confirm</button>`);
    if (["pending", "confirmed"].includes(a.status)) {
      btns.push(`<button class="btn btn--ghost btn--sm" data-act="complete" data-id="${a.id}">Complete</button>`);
    }
    if (a.fee && ["pay_at_clinic", "unpaid"].includes(a.payment_status) && ["pending", "confirmed", "completed"].includes(a.status)) {
      btns.push(`<button class="btn btn--ghost btn--sm" data-act="received" data-id="${a.id}" data-fee="${a.fee}">Received ${rupees(a.fee)}</button>`);
    }
    btns.push(`<button class="btn btn--ghost btn--sm" data-act="open" data-id="${a.id}">Details</button>`);
    return btns.join("");
  }

  function apptItem(a) {
    return `<div class="item">
      <div class="item__time">${time12(a.time)}</div>
      <div class="item__main"><strong>${esc(a.patient_name)}</strong>
        <small>${esc(a.appt_no || "")} · ${esc(CLINIC[a.clinic])} · ${esc(phonePretty(a.patient_phone))} ${a.prefers_female ? "· prefers female clinician" : ""}</small>
        <div>${badge(a.status)} ${payBadge(a)}</div></div>
      <div class="item__actions">${apptActions(a)}</div>
    </div>`;
  }

  function fuItem(f) {
    const overdue = f.status === "pending" && f.due_date < state.today;
    return `<div class="item">
      <div class="item__time">${esc(day(f.due_date, { day: "numeric", month: "short" }))}</div>
      <div class="item__main"><strong><a href="#/patient/${f.patient_id}">${esc(f.patient_name)}</a></strong>
        <small>${esc(FU_TYPE[f.type])}${f.notes ? ` · ${esc(f.notes)}` : ""}</small>
        ${overdue ? '<div><span class="badge badge--cancelled">Overdue</span></div>' : ""}</div>
      <div class="item__actions">
        <a class="btn btn--wa-sm btn--sm" href="${esc(f.whatsappUrl)}" target="_blank" rel="noopener">Send on WhatsApp</a>
        <button class="btn btn--ghost btn--sm" data-act="fu-done" data-id="${f.id}">Mark done</button>
      </div>
    </div>`;
  }

  // Delegated actions shared across views.
  content.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) {
      const row = e.target.closest("[data-href]");
      if (row && !e.target.closest("a,button")) location.hash = row.dataset.href;
      return;
    }
    const { act, id } = btn.dataset;
    try {
      if (act === "confirm") { await api(`/appointments/${id}`, { method: "PATCH", body: { status: "confirmed" } }); toast("Confirmed. Send the WhatsApp confirmation from Details."); route(); }
      if (act === "complete") completeDialog(id);
      if (act === "open") apptDialog(id);
      if (act === "received") receivedDialog(id, Number(btn.dataset.fee));
      if (act === "fu-done" || act === "fu-skip") {
        await api(`/followups/${id}`, { method: "PATCH", body: { status: act === "fu-done" ? "done" : "skipped" } });
        route();
        undoToast(act === "fu-done" ? "Follow-up marked done." : "Follow-up skipped.", () => api(`/followups/${id}`, { method: "PATCH", body: { status: "pending" } }));
      }
      if (act === "fu-copy") { await navigator.clipboard.writeText(btn.dataset.url); toast("Check-in link copied."); }
    } catch (ex) {
      toast(ex.message);
    }
  });

  // ---------- Overview ----------
  async function renderOverview() {
    const d = await api("/dashboard");
    const s = d.stats;
    const max = Math.max(1, ...d.trend.map((t) => t.n));
    const byDate = Object.fromEntries(d.trend.map((t) => [t.date, t.n]));
    const days14 = Array.from({ length: 14 }, (_, i) => addDays(d.today, i - 13));
    content.innerHTML = `
      <div class="kpis">
        <div class="kpi kpi--ok"><small>Today's appointments</small><strong>${s.today}</strong></div>
        <div class="kpi ${s.pending ? "kpi--warn" : ""}"><small>Awaiting confirmation</small><strong>${s.pending}</strong></div>
        <div class="kpi ${s.overdue ? "kpi--warn" : ""}"><small>Follow-ups due${s.overdue ? ` (${s.overdue} overdue)` : ""}</small><strong>${s.followupsDue}</strong></div>
        <div class="kpi kpi--ok"><small>Collected this month (net)</small><strong>${esc(s.collectedMonthText)}</strong></div>
      </div>
      <section class="money" aria-label="Money today">
        <div><small>Collected for today's visits</small><strong>${esc(s.collectedTodayText)}</strong></div>
        <div class="${s.toCollectCount ? "money--due" : ""}"><small>Still to collect at the clinic today</small><strong>${esc(s.toCollectTodayText)}</strong><span class="muted small">${s.toCollectCount} ${s.toCollectCount === 1 ? "patient" : "patients"} · tap "Received" when paid</span></div>
        <div><small>Last 30 days (net)</small><strong>${esc(s.collected30Text)}</strong></div>
      </section>
      <details class="more-kpis">
        <summary>More numbers</summary>
        <div class="kpis kpis--small">
          <div class="kpi"><small>Next 7 days</small><strong>${s.upcoming7}</strong></div>
          <div class="kpi"><small>New patients (30 days)</small><strong>${s.newPatients30}</strong></div>
          <div class="kpi"><small>Visits completed (30 days)</small><strong>${s.completed30}</strong></div>
          <div class="kpi"><small>Avg check-in pain (7 days)</small><strong>${s.avgPain7 ?? "—"}</strong></div>
          <div class="kpi ${s.storiesPending ? "kpi--warn" : ""}"><small>Stories to review</small><strong><a href="#/stories">${s.storiesPending}</a></strong></div>
        </div>
      </details>
      <div class="grid-2">
        <div class="stack">
          <section class="panel-card">
            <div class="panel-card__head"><h2>Today · ${esc(day(d.today, { weekday: "long", day: "numeric", month: "long" }))}</h2><a href="#/appointments">All appointments →</a></div>
            <div class="list">${d.schedule.map(apptItem).join("") || '<div class="empty">No appointments today.</div>'}</div>
          </section>
          <section class="panel-card">
            <div class="panel-card__head"><h2>Tomorrow: send reminders</h2>${d.tomorrow.length > 1 ? `<button type="button" class="btn btn--wa-sm btn--sm" id="sendAllReminders">Send all ${d.tomorrow.length}, one by one</button>` : ""}</div>
            <div class="list">${d.tomorrow.map((a) => `<div class="item"><div class="item__time">${time12(a.time)}</div>
              <div class="item__main"><strong>${esc(a.patient_name)}</strong><small>${esc(CLINIC[a.clinic])}</small><div>${badge(a.status)}</div></div>
              <div class="item__actions"><a class="btn btn--wa-sm btn--sm" target="_blank" rel="noopener" href="${esc(a.links.reminder)}" data-reminder>Send reminder</a></div></div>`).join("") || '<div class="empty">Nothing booked for tomorrow.</div>'}</div>
          </section>
        </div>
        <div class="stack">
          <section class="panel-card">
            <div class="panel-card__head"><h2>Follow-ups due</h2><a href="#/followups">View all →</a></div>
            <div class="list">${d.due.map(fuItem).join("") || '<div class="empty">All caught up 🎉</div>'}</div>
          </section>
          ${d.alerts.length ? `<section class="panel-card">
            <div class="panel-card__head"><h2>⚠️ Patients needing attention</h2></div>
            <div class="list">${d.alerts.map((c) => `<div class="item"><div>${pain(c.pain_score)}</div>
              <div class="item__main"><strong><a href="#/patient/${c.patient_id}">${esc(c.patient_name)}</a></strong><small class="trend-${esc(c.trend)}">Feeling ${esc(c.trend)}</small>${c.notes ? `<small> · ${esc(c.notes)}</small>` : ""}</div><div></div></div>`).join("")}</div>
          </section>` : ""}
          <section class="panel-card">
            <div class="panel-card__head"><h2>Appointments, last 14 days</h2></div>
            <div class="bars">${days14.map((dt) => `<div style="height:${((byDate[dt] || 0) / max) * 100}%" data-tip="${esc(day(dt))}: ${byDate[dt] || 0}"></div>`).join("")}</div>
            <div class="bars__axis"><span>${esc(day(days14[0], { day: "numeric", month: "short" }))}</span><span>Today</span></div>
          </section>
        </div>
      </div>`;
  }

  // "Send all reminders": each tap opens the next patient's WhatsApp message (browsers allow one new tab per tap).
  content.addEventListener("click", (e) => {
    const btn = e.target.closest("#sendAllReminders");
    if (!btn) return;
    const links = $$("[data-reminder]");
    const next = links.find((l) => !l.dataset.sent);
    if (!next) return;
    window.open(next.href, "_blank", "noopener");
    next.dataset.sent = "1";
    next.textContent = "Sent ✓";
    next.classList.replace("btn--wa-sm", "btn--ghost");
    const left = links.filter((l) => !l.dataset.sent).length;
    btn.textContent = left ? `Send next (${links.length - left + 1} of ${links.length})` : "All reminders opened ✓";
    btn.disabled = !left;
  });

  // ---------- Appointments ----------
  async function renderAppointments() {
    const f = state.apptFilter;
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
    const { appointments } = await api(`/appointments?${qs}`);
    content.innerHTML = `
      <section class="panel-card">
        <form class="toolbar" id="apptFilters">
          <div class="field"><label>From</label><input type="date" name="from" value="${esc(f.from || "")}"></div>
          <div class="field"><label>To</label><input type="date" name="to" value="${esc(f.to)}"></div>
          <div class="field"><label>Status</label><select name="status"><option value="">All</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${f.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
          <div class="field"><label>Clinic</label><select name="clinic"><option value="">All</option>${Object.entries(CLINIC).map(([k, v]) => `<option value="${k}" ${f.clinic === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
          <div class="field" style="flex:1"><label>Search</label><input type="search" name="q" placeholder="Name, phone, TBA-…, TBP-… or code" value="${esc(f.q)}"></div>
          <button class="btn btn--primary btn--sm" type="submit">Apply</button>
          <button class="btn btn--ghost btn--sm" type="button" id="clearFilters">Show all</button>
        </form>
      </section>
      <div class="table-wrap"><table>
        <thead><tr><th>When</th><th>Patient</th><th>Clinic</th><th>Status</th><th>Appointment no.</th><th></th></tr></thead>
        <tbody>${appointments.map((a) => `<tr>
          <td class="nowrap"><strong>${esc(day(a.date))}</strong><br><span class="muted">${time12(a.time)}</span></td>
          <td><a href="#/patient/${a.patient_id}"><strong>${esc(a.patient_name)}</strong></a><br><span class="muted">${esc(a.patient_code || "")} · ${esc(phonePretty(a.patient_phone))}</span></td>
          <td>${esc(CLINIC[a.clinic])}</td>
          <td>${badge(a.status)}<br>${payBadge(a)}</td>
          <td class="nowrap"><strong>${esc(a.appt_no || "")}</strong><br><span class="muted">${esc(a.ref)}${a.fee ? ` · ${rupees(a.fee)}` : ""}</span></td>
          <td><div class="item__actions">${apptActions(a)}</div></td>
        </tr>`).join("") || '<tr><td colspan="6"><div class="empty">No appointments match these filters.</div></td></tr>'}</tbody>
      </table></div>`;
    $("#apptFilters").addEventListener("submit", (e) => {
      e.preventDefault();
      Object.assign(state.apptFilter, Object.fromEntries(new FormData(e.target)));
      route();
    });
    $("#clearFilters").addEventListener("click", () => {
      state.apptFilter = { from: "", to: "", status: "", clinic: "", q: "" };
      route();
    });
  }

  async function apptDialog(id) {
    const { appointment: a, events, refunds, quotes } = await api(`/appointments/${id}`);
    const open = ["pending", "confirmed"].includes(a.status);
    const refundable = a.amount_paid - a.amount_refunded;
    openModal(`
      <h2>${esc(a.patient_name)} ${badge(a.status)}</h2>
      <dl class="kv">
        <dt>When</dt><dd>${esc(day(a.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }))}, ${time12(a.time)}</dd>
        <dt>Clinic</dt><dd>${esc(CLINIC[a.clinic])}${a.visit_type === "followup" ? " · follow-up visit" : ""}</dd>
        <dt>Phone</dt><dd><a href="tel:+${esc(a.patient_phone)}">${esc(phonePretty(a.patient_phone))}</a></dd>
        ${a.patient_email ? `<dt>Email</dt><dd>${esc(a.patient_email)}</dd>` : ""}
        <dt>Appointment</dt><dd><strong>${esc(a.appt_no || "")}</strong> · booking code ${esc(a.ref)} · via ${esc(a.source)}</dd>
        <dt>Patient ID</dt><dd>${esc(a.patient_code || "")}</dd>
        ${a.gcal_status ? `<dt>Google Calendar</dt><dd>${a.gcal_status === "synced" ? "Synced ✓" : `<span class="trend-worse">Not synced: ${esc(a.gcal_status)}</span> (retries automatically)`}</dd>` : ""}
        ${a.prefers_female ? "<dt>Preference</dt><dd>Female clinician</dd>" : ""}
        ${a.reason ? `<dt>Patient says</dt><dd>${esc(a.reason)}</dd>` : ""}
        ${a.fee ? `<dt>Payment</dt><dd>${rupees(a.fee)} · ${payBadge(a)}${a.amount_paid ? ` · paid ${rupees(a.amount_paid)}` : ""}${a.amount_refunded ? ` · refunded ${rupees(a.amount_refunded)}` : ""}${a.platform_fee ? `<br><span class="muted small">Split: doctor ${rupees(a.fee - a.platform_fee)} · platform ${rupees(a.platform_fee)}</span>` : ""}</dd>` : ""}
      </dl>
      <img class="appt-qr" src="/api/admin/appointments/${a.id}/qr.svg" alt="QR code for ${esc(a.appt_no || a.ref)}" width="96" height="96">
      <div class="row-gap" style="margin:1rem 0">
        <a class="btn btn--ghost btn--sm" target="_blank" rel="noopener" href="${esc(a.links.chat)}">Open WhatsApp chat</a>
        <a class="btn btn--ghost btn--sm" href="#/patient/${a.patient_id}" id="toPatient">Patient profile</a>
        ${refundable > 0 ? '<button class="btn btn--ghost btn--sm" type="button" id="refundBtn">Issue refund</button>' : ""}
      </div>
      <form class="form" id="apptEdit">
        <div class="field"><label>Clinical notes (private, encrypted)</label><textarea name="notes" rows="4">${esc(a.notes)}</textarea></div>
        ${open ? `<div class="field-row">
          <div class="field"><label>Date</label><input type="date" name="date" value="${esc(a.date)}"></div>
          <div class="field"><label>Time</label><input type="time" name="time" step="900" value="${esc(a.time)}"></div>
        </div>` : ""}
        <div class="field"><label>Status</label><select name="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${a.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <div class="alert alert--ok" id="impact" hidden></div>
        <div class="field" id="reasonField" hidden><label>Reason (sent to the patient)</label><input name="reason" maxlength="300" placeholder="e.g. Doctor travelling, emergency"></div>
        <label class="check"><input type="checkbox" name="silent"> Don't notify the patient about this change</label>
        <div class="row-gap"><button class="btn btn--primary" type="submit">Save changes</button></div>
      </form>
      ${refunds.length ? `<h3 style="margin-top:1.4rem">Refunds</h3><div class="list">${refunds.map((r) => `<div class="item"><div class="item__time">${rupees(r.amount)}</div>
        <div class="item__main"><strong>${esc(r.status)}</strong><small>${esc(day(r.created_at))} · ${esc(r.reason)}${r.error ? ` · ${esc(r.error)}` : ""}</small></div><div></div></div>`).join("")}</div>` : ""}
      <h3 style="margin-top:1.4rem">History</h3>
      <ol class="timeline">${events.map((e) => `<li><strong>${esc(EVENT[e.action] || e.action)}</strong> <span class="muted small">by ${esc(e.actor === "clinic" ? e.actor_name || "clinic" : e.actor === "patient" ? "patient" : "system")} · ${esc(new Date(e.created_at.replace(" ", "T") + "Z").toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }))}</span>${e.detail ? `<br><span class="small">${esc(e.detail)}</span>` : ""}</li>`).join("") || '<li class="muted">No history yet.</li>'}</ol>`);
    $("#toPatient").addEventListener("click", closeModal);
    const form = $("#apptEdit");
    const impact = () => {
      const st = form.status.value;
      const moved = open && (form.date.value !== a.date || form.time.value !== a.time);
      let msg = "";
      if (st === "cancelled" && a.status !== "cancelled") msg = `Cancelling as the clinic: the patient gets a message${quotes ? ` and a full refund of ${rupees(quotes.clinic.amount)}` : ""}.`;
      else if (st === "no_show" && a.status !== "no_show") msg = `No-show: ${quotes ? "no refund (per policy). " : ""}The patient is informed.`;
      else if (st === "confirmed" && a.status !== "confirmed") msg = "The patient receives a confirmation message.";
      if (moved) msg += `${msg ? " " : ""}The patient is told about the new time and can reschedule or cancel free of charge.`;
      $("#impact").hidden = !msg;
      $("#impact").textContent = msg;
      $("#reasonField").hidden = !(st === "cancelled" && a.status !== "cancelled");
    };
    form.addEventListener("input", impact);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const body = { notes: fd.get("notes"), status: fd.get("status"), reason: fd.get("reason") || "", silent: fd.get("silent") === "on" };
      if (open && (fd.get("date") !== a.date || fd.get("time") !== a.time)) { body.date = fd.get("date"); body.time = fd.get("time"); }
      if (body.status === "completed" && a.status !== "completed") { closeModal(); return completeDialog(id, body.notes); }
      if (body.status === "cancelled" && a.status !== "cancelled" && !confirm("Cancel this appointment and notify the patient?")) return;
      try {
        const res = await api(`/appointments/${id}`, { method: "PATCH", body });
        closeModal();
        toast(res.refund ? `Saved. Refund ${rupees(res.refund.amount)}: ${res.refund.status}.` : "Saved.");
        route();
      } catch (ex) { toast(ex.message); }
    });
    const rb = $("#refundBtn");
    if (rb) rb.addEventListener("click", async () => {
      openModal(`<h2>Refund</h2>
        <form class="form" id="refundForm">
          <div class="field"><label>Amount in ₹ (up to ${refundable / 100})</label><input name="amount" type="number" inputmode="decimal" min="1" max="${refundable / 100}" step="0.01" value="${refundable / 100}" required></div>
          <div class="field"><label>Reason (kept in the records)</label><input name="reason" maxlength="200" value="Goodwill refund" required></div>
          <p class="small muted">The money goes back to the patient's original payment method through Razorpay. This can't be undone.</p>
          <div class="row-gap"><button class="btn btn--primary">Refund</button><button class="btn btn--ghost" type="button" id="refundCancel">Cancel</button></div>
        </form>`);
      $("#refundCancel").addEventListener("click", () => apptDialog(id));
      $("#refundForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const amount = Number(e.target.amount.value);
        if (!(amount > 0 && amount <= refundable / 100)) { toast(`Enter an amount between ₹1 and ₹${refundable / 100}.`); return; }
        if (!confirm(`Refund ${rupees(amount * 100)} to the patient now?`)) return;
        const btn = e.target.querySelector("button");
        btn.disabled = true;
        try {
          const res = await api(`/appointments/${id}/refund`, { method: "POST", body: { amount, reason: e.target.reason.value } });
          toast(`Refund ${rupees(res.refund.amount)}: ${res.refund.status}${res.refund.error ? ` (${res.refund.error})` : ""}`);
          delete modal.dataset.dirty;
          apptDialog(id);
        } catch (ex) { btn.disabled = false; toast(ex.message); }
      });
    });
  }

  // Fee paid at the desk: record how, so the payments report and the day's takings are complete.
  function receivedDialog(id, fee) {
    openModal(`<h2>Payment received at the clinic</h2>
      <form class="form" id="receivedForm">
        <p>Record <strong>${rupees(fee)}</strong> as paid for this visit.</p>
        <fieldset class="field"><legend>Paid by</legend>
          <div class="seg">${[["upi", "UPI"], ["cash", "Cash"], ["card", "Card"]].map(([v, l], i) => `<label class="seg__opt"><input type="radio" name="method" value="${v}" ${i ? "" : "checked"}><span>${l}</span></label>`).join("")}</div>
        </fieldset>
        <button class="btn btn--primary">Save</button>
      </form>`);
    $("#receivedForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api(`/appointments/${id}/received`, { method: "POST", body: { method: e.target.method.value } });
        closeModal(); toast(`${rupees(fee)} recorded as paid.`); route();
      } catch (ex) { toast(ex.message); }
    });
  }

  function completeDialog(id, notes) {
    openModal(`
      <h2>Complete visit & plan follow-up</h2>
      <form class="form" id="completeForm">
        ${notes === undefined ? '<div class="field"><label>Visit notes (private)</label><textarea name="notes" rows="3" placeholder="e.g. IM session 1, advised cushion"></textarea></div>' : ""}
        <label class="check"><input type="checkbox" name="schedule" checked> Schedule a follow-up</label>
        <div class="field-row">
          <div class="field"><label>Follow up on</label><input type="date" name="dueDate" value="${addDays(state.today, 14)}"></div>
          <div class="field"><label>Type</label><select name="type">${Object.entries(FU_TYPE).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
        </div>
        <div class="chips">${[3, 7, 14, 30].map((n) => `<button class="chip" type="button" data-days="${n}">+${n} days</button>`).join("")}</div>
        <div class="field"><label>Follow-up note</label><input name="fuNotes" placeholder="e.g. Check sitting tolerance"></div>
        <button class="btn btn--primary btn--block" type="submit">Mark completed</button>
      </form>`);
    $$("[data-days]", modalBody).forEach((b) => b.addEventListener("click", () => { $('[name="dueDate"]', modalBody).value = addDays(state.today, Number(b.dataset.days)); }));
    $("#completeForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = { status: "completed" };
      if (notes !== undefined) body.notes = notes; else if (fd.get("notes")) body.notes = fd.get("notes");
      if (fd.get("schedule")) body.followup = { dueDate: fd.get("dueDate"), type: fd.get("type"), notes: fd.get("fuNotes") };
      try {
        const res = await api(`/appointments/${id}`, { method: "PATCH", body });
        if (res.followup) {
          openModal(`<h2>Visit completed ✓</h2>
            <p>Follow-up scheduled for <strong>${esc(day(res.followup.due_date, { weekday: "long", day: "numeric", month: "long" }))}</strong>.</p>
            <p class="muted small">When it's due, send the patient their check-in link. It also appears in Follow-ups.</p>
            <div class="row-gap"><a class="btn btn--wa-sm" target="_blank" rel="noopener" href="${esc(res.followup.whatsappUrl)}">Send check-in link now</a>
            <button class="btn btn--ghost" type="button" id="okBtn">Done</button></div>`);
          $("#okBtn").addEventListener("click", closeModal);
        } else {
          closeModal();
          toast("Visit marked completed.");
        }
        route();
      } catch (ex) { toast(ex.message); }
    });
  }

  // New appointment (phone / walk-in bookings)
  $("#newApptBtn").addEventListener("click", () => {
    openModal(`
      <h2>New appointment</h2>
      <form class="form" id="newAppt">
        <div class="field-row">
          <div class="field"><label>Patient name</label><input name="name" required></div>
          <div class="field"><label>Phone</label><input name="phone" type="tel" required></div>
        </div>
        <div class="field"><label>Email (optional)</label><input name="email" type="email"></div>
        <fieldset class="field"><legend>Clinic</legend><div class="seg">${Object.entries(CLINIC).map(([k, v], i) => `<label><input type="radio" name="clinic" value="${k}" ${i ? "" : "checked"}><span>${v}</span></label>`).join("")}</div></fieldset>
        <div class="field"><label>Date</label><input type="date" name="date" required value="${state.today}"></div>
        <div class="field"><label>Time <span class="muted small">(free slots shown; any time allowed)</span></label>
          <div class="slot-select" id="slotPick"></div><input type="time" name="time" step="900" required style="margin-top:.4rem"></div>
        <div class="field"><label>Reason / notes</label><textarea name="reason" rows="2"></textarea></div>
        <label class="check"><input type="checkbox" name="pending"> Keep as pending (not yet confirmed)</label>
        <button class="btn btn--primary btn--block" type="submit">Create appointment</button>
      </form>`);
    const form = $("#newAppt");
    const loadPick = async () => {
      const fd = new FormData(form);
      const res = await fetch(`/api/slots?clinic=${fd.get("clinic")}&date=${fd.get("date")}`).then((r) => r.json()).catch(() => ({ slots: [] }));
      $("#slotPick").innerHTML = (res.slots || []).map((s) => `<button type="button" class="slot" ${s.available ? "" : "disabled"} data-t="${s.time}">${time12(s.time)}</button>`).join("") || '<span class="muted small">Clinic closed.</span>';
    };
    form.addEventListener("change", (e) => { if (["clinic", "date"].includes(e.target.name)) loadPick(); });
    $("#slotPick").addEventListener("click", (e) => {
      const b = e.target.closest("[data-t]");
      if (!b) return;
      form.time.value = b.dataset.t;
      $$(".slot", form).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    });
    loadPick();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(form));
      body.status = body.pending ? "pending" : "confirmed";
      try {
        const { appointment: a } = await api("/appointments", { method: "POST", body });
        openModal(`<h2>Appointment created ✓</h2><p><strong>${esc(a.patient_name)}</strong>, ${esc(day(a.date, { weekday: "long", day: "numeric", month: "long" }))} at ${time12(a.time)}, ${esc(CLINIC[a.clinic])}.<br><span class="muted">Ref ${esc(a.ref)}</span></p>
          <div class="row-gap"><a class="btn btn--wa-sm" target="_blank" rel="noopener" href="${esc(a.links.confirm)}">Send WhatsApp confirmation</a><button class="btn btn--ghost" id="okBtn" type="button">Done</button></div>`);
        $("#okBtn").addEventListener("click", closeModal);
        route();
      } catch (ex) { toast(ex.message); }
    });
  });

  // ---------- Follow-ups ----------
  async function renderFollowups() {
    const { followups } = await api(`/followups?view=${state.fuView}`);
    const tabs = { due: "Due now", overdue: "Overdue", upcoming: "Upcoming", done: "Completed" };
    content.innerHTML = `
      <div class="chips">${Object.entries(tabs).map(([k, v]) => `<button class="chip ${state.fuView === k ? "is-active" : ""}" data-fu="${k}">${v}</button>`).join("")}</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Due</th><th>Patient</th><th>Type</th><th>Result</th><th></th></tr></thead>
        <tbody>${followups.map((f) => `<tr>
          <td class="nowrap"><strong>${esc(day(f.due_date))}</strong>${f.status === "pending" && f.due_date < state.today ? '<br><span class="badge badge--cancelled">Overdue</span>' : ""}</td>
          <td><a href="#/patient/${f.patient_id}"><strong>${esc(f.patient_name)}</strong></a><br><span class="muted">${esc(phonePretty(f.patient_phone))}</span></td>
          <td>${esc(FU_TYPE[f.type])}${f.notes ? `<br><span class="muted">${esc(f.notes)}</span>` : ""}</td>
          <td>${f.pain_score != null ? `${pain(f.pain_score)} <span class="trend-${esc(f.trend)}">${esc(f.trend)}</span>` : f.status === "pending" ? '<span class="muted">Waiting</span>' : badge(f.status === "done" ? "completed" : "cancelled")}</td>
          <td><div class="item__actions">${f.status === "pending" ? `
            <a class="btn btn--wa-sm btn--sm" href="${esc(f.whatsappUrl)}" target="_blank" rel="noopener">WhatsApp link</a>
            <button class="btn btn--ghost btn--sm" data-act="fu-copy" data-url="${esc(f.checkinUrl)}">Copy link</button>
            <button class="btn btn--ghost btn--sm" data-act="fu-done" data-id="${f.id}">Done</button>
            <button class="btn btn--ghost btn--sm" data-act="fu-skip" data-id="${f.id}">Skip</button>` : ""}</div></td>
        </tr>`).join("") || '<tr><td colspan="5"><div class="empty">Nothing here.</div></td></tr>'}</tbody>
      </table></div>`;
    $$("[data-fu]").forEach((b) => b.addEventListener("click", () => { state.fuView = b.dataset.fu; route(); }));
  }

  // ---------- Patients ----------
  async function renderPatients() {
    content.innerHTML = `
      <section class="panel-card"><form class="toolbar" id="pSearch">
        <div class="field" style="flex:1"><label>Search patients</label><input type="search" name="q" placeholder="Name, phone or email" value="${esc(state.patientQ || "")}"></div>
        <button class="btn btn--primary btn--sm">Search</button>
      </form></section>
      <div id="pTable"><div class="empty">Loading…</div></div>`;
    const load = async () => {
      const { patients } = await api(`/patients?q=${encodeURIComponent(state.patientQ || "")}`);
      $("#pTable").innerHTML = `<div class="table-wrap"><table>
        <thead><tr><th>Patient</th><th>Phone</th><th>Visits</th><th>Last appointment</th><th>Latest pain</th></tr></thead>
        <tbody>${patients.map((p) => `<tr class="row-link" data-href="#/patient/${p.id}">
          <td><a href="#/patient/${p.id}"><strong>${esc(p.name)}</strong></a>${p.email ? `<br><span class="muted">${esc(p.email)}</span>` : ""}</td>
          <td class="nowrap">${esc(phonePretty(p.phone))}</td><td>${p.visits}</td>
          <td class="nowrap">${esc(day(p.last_date)) || "—"}</td><td>${pain(p.last_pain)}</td>
        </tr>`).join("") || '<tr><td colspan="5"><div class="empty">No patients found.</div></td></tr>'}</tbody></table></div>`;
    };
    $("#pSearch").addEventListener("submit", (e) => { e.preventDefault(); state.patientQ = new FormData(e.target).get("q"); load(); });
    await load();
  }

  function painChart(checkins) {
    if (!checkins.length) return '<div class="empty">No check-ins yet. Pain scores appear here after the patient fills in a check-in link.</div>';
    const W = 520, H = 180, P = 28;
    const xs = (i) => (checkins.length === 1 ? W / 2 : P + (i * (W - 2 * P)) / (checkins.length - 1));
    const ys = (v) => H - P - (v / 10) * (H - 2 * P);
    const pts = checkins.map((c, i) => [xs(i), ys(c.pain_score)]);
    const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
    const area = `${line} L${pts.at(-1)[0]},${H - P} L${pts[0][0]},${H - P} Z`;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Pain score over time">
      ${[0, 5, 10].map((v) => `<line class="grid-line" x1="${P}" x2="${W - P}" y1="${ys(v)}" y2="${ys(v)}"/><text x="4" y="${ys(v) + 3}">${v}</text>`).join("")}
      <path class="area" d="${area}"/><path class="line" d="${line}"/>
      ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="4"><title>${esc(day(checkins[i].created_at))}: ${checkins[i].pain_score}/10</title></circle>`).join("")}
      ${checkins.map((c, i) => `<text x="${xs(i)}" y="${H - 8}" text-anchor="middle">${esc(day(c.created_at, { day: "numeric", month: "short" }))}</text>`).join("")}
    </svg>`;
  }

  async function renderPatient(pid) {
    const { patient: p, appointments, followups, checkins, consents, storyInvite, documents = [], documentKinds = {} } = await api(`/patients/${Number(pid)}`);
    $("#viewTitle").textContent = `${p.name} · ${p.patient_code || ""}`;
    const first = checkins[0]?.pain_score;
    const last = checkins.at(-1)?.pain_score;
    content.innerHTML = `
      <button class="back" type="button" id="backBtn">← Back</button>
      <div class="profile">
        <div class="stack">
          <section class="panel-card">
            <h2>Contact</h2>
            <form class="form" id="pEdit">
              <div class="field"><label>Name</label><input name="name" value="${esc(p.name)}"></div>
              <div class="field"><label>Phone</label><input name="phone" value="${esc(phonePretty(p.phone))}"></div>
              <div class="field"><label>Email</label><input name="email" type="email" value="${esc(p.email || "")}"></div>
              <div class="field"><label>Patient notes (private)</label><textarea name="notes" rows="5" placeholder="History, scans, preferences…">${esc(p.notes)}</textarea></div>
              <button class="btn btn--primary btn--sm">Save</button>
            </form>
            <div class="row-gap" style="margin-top:1rem">
              <a class="btn btn--wa-sm btn--sm" target="_blank" rel="noopener" href="https://wa.me/${esc(p.phone)}">WhatsApp</a>
              <a class="btn btn--ghost btn--sm" href="tel:+${esc(p.phone)}">Call</a>
              <a class="btn btn--ghost btn--sm" target="_blank" rel="noopener" href="${esc(storyInvite)}">Ask for a story</a>
            </div>
          </section>
          <section class="panel-card">
            <h2>Consent & data</h2>
            ${p.anonymised_at ? `<div class="alert alert--ok">Personal data erased on ${esc(day(p.anonymised_at))}. Financial records kept de-identified.</div>` : ""}
            <div class="list">${consents.map((c) => `<div class="item" style="grid-template-columns:1fr auto">
              <div class="item__main"><strong>${esc({ care: "Care & bookings", whatsapp_updates: "WhatsApp updates", story_publication: "Story publication" }[c.purpose] || c.purpose)}</strong>
              <small>Given ${esc(day(c.given_at))} via ${esc(c.source)} · notice v${esc(c.notice_version)}</small></div>
              <div>${c.withdrawn_at ? `<span class="badge badge--cancelled">Withdrawn</span>` : '<span class="badge badge--confirmed">Active</span>'}</div></div>`).join("") || '<div class="empty">No consent recorded (booked before consent capture).</div>'}</div>
            <div class="row-gap" style="margin-top:.8rem">
              <a class="btn btn--ghost btn--sm" href="/api/admin/patients/${p.id}/export" download>Export data (JSON)</a>
              ${p.anonymised_at ? "" : '<button class="btn btn--danger btn--sm" id="eraseBtn" type="button">Erase personal data</button>'}
            </div>
          </section>
          <section class="panel-card">
            <div class="panel-card__head"><h2>Follow-ups</h2><button class="btn btn--ghost btn--sm" id="addFu">+ Add</button></div>
            <div class="list">${followups.map((f) => `<div class="item"><div class="item__time">${esc(day(f.due_date, { day: "numeric", month: "short" }))}</div>
              <div class="item__main"><strong>${esc(FU_TYPE[f.type])}</strong><small>${esc(f.notes)}</small></div>
              <div class="item__actions">${f.status === "pending" ? `<a class="btn btn--wa-sm btn--sm" target="_blank" rel="noopener" href="${esc(f.whatsappUrl)}">Send</a><button class="btn btn--ghost btn--sm" data-act="fu-done" data-id="${f.id}">Done</button>` : badge(f.status === "done" ? "completed" : "cancelled")}</div></div>`).join("") || '<div class="empty">No follow-ups.</div>'}</div>
          </section>
        </div>
        <div class="stack">
          <section class="panel-card">
            <div class="panel-card__head"><h2>Pain progress</h2>${checkins.length > 1 ? `<span class="${last < first ? "trend-better" : last > first ? "trend-worse" : ""}">${first} → ${last} / 10</span>` : ""}</div>
            ${painChart(checkins)}
            ${checkins.length ? `<div class="list" style="margin-top:.8rem">${checkins.slice().reverse().map((c) => `<div class="item"><div>${pain(c.pain_score)}</div>
              <div class="item__main"><strong class="trend-${esc(c.trend)}">Feeling ${esc(c.trend)}</strong><small>${esc(day(c.created_at))}${c.sitting_minutes != null ? ` · sits ${c.sitting_minutes} min` : ""}${c.notes ? ` · ${esc(c.notes)}` : ""}</small></div><div></div></div>`).join("")}</div>` : ""}
          </section>
          ${p.anonymised_at ? "" : `<section class="panel-card" id="docsPanel">
            <div class="panel-card__head"><h2>Documents</h2><button class="btn btn--ghost btn--sm" id="addDoc">+ Add document</button></div>
            <p class="muted small" style="margin-top:0">Plans, visit summaries and reports. Tick <strong>Shared</strong> to let the patient download it from My appointments. PDF, JPG or PNG, up to 10 MB. Stored encrypted.</p>
            <div class="list">${documents.map((d) => `<div class="item">
              <div class="item__time">${esc(day(d.created_at, { day: "numeric", month: "short" }))}</div>
              <div class="item__main"><strong>${esc(d.title)}</strong>
                <small>${esc(d.kindLabel)} · ${esc(d.mime === "application/pdf" ? "PDF" : "Image")} · ${Math.max(1, Math.round(d.size / 1024))} KB · ${d.uploaded_by === "patient" ? "added by the patient" : `by ${esc(d.uploader_name || "clinic")}`}</small></div>
              <div class="item__actions">
                <a class="btn btn--ghost btn--sm" href="/api/admin/documents/${d.id}/file" download>Download</a>
                ${d.uploaded_by === "clinic" ? `<label class="check"><input type="checkbox" data-doc-share="${d.id}" ${d.shared ? "checked" : ""}> Shared</label>` : ""}
                <button class="btn btn--ghost btn--sm" data-doc-del="${d.id}" aria-label="Delete ${esc(d.title)}">Delete</button>
              </div></div>`).join("") || '<div class="empty">No documents yet.</div>'}</div>
          </section>`}
          <section class="panel-card">
            <h2>Appointments</h2>
            <div class="list">${appointments.map((a) => `<div class="item"><div class="item__time">${esc(day(a.date, { day: "numeric", month: "short", year: "2-digit" }))}</div>
              <div class="item__main"><strong>${time12(a.time)} · ${esc(CLINIC[a.clinic])}</strong><small>${esc(a.notes || a.reason)}</small><div>${badge(a.status)}</div></div>
              <div class="item__actions">${apptActions(a)}</div></div>`).join("") || '<div class="empty">No appointments.</div>'}</div>
          </section>
        </div>
      </div>`;
    $("#backBtn").addEventListener("click", () => history.back());
    // ---- Documents ----
    $("#addDoc")?.addEventListener("click", () => {
      openModal(`<h2>Add a document for ${esc(p.name)}</h2>
        <form class="form" id="docForm">
          <div class="field"><label>File (PDF, JPG or PNG, up to 10 MB)</label><input type="file" name="file" accept="application/pdf,image/jpeg,image/png" required></div>
          <div class="field"><label>Type</label><select name="kind">${Object.entries(documentKinds).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select></div>
          <div class="field"><label>Title (optional)</label><input name="title" maxlength="120" placeholder="e.g. Exercise plan, week 1"></div>
          ${appointments.length ? `<div class="field"><label>Visit (optional)</label><select name="appointmentId"><option value="">Not linked to a visit</option>${appointments.map((a) => `<option value="${a.id}">${esc(day(a.date))} · ${time12(a.time)} · ${esc(CLINIC[a.clinic])}</option>`).join("")}</select></div>` : ""}
          <label class="check"><input type="checkbox" name="shared" checked> Share with the patient (they can download it from My appointments)</label>
          <button class="btn btn--primary">Upload</button>
        </form>`);
      $("#docForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = e.target;
        const file = f.file.files[0];
        if (!file) return toast("Please choose a file.");
        if (file.size > 10 * 1024 * 1024) return toast("That file is larger than 10 MB.");
        const qs = new URLSearchParams({ kind: f.kind.value, title: f.title.value, shared: f.shared.checked ? "1" : "0", ...(f.appointmentId?.value ? { appointmentId: f.appointmentId.value } : {}) });
        const btn = f.querySelector("button");
        btn.disabled = true; btn.textContent = "Uploading…";
        try {
          const res = await fetch(`/api/admin/patients/${p.id}/documents?${qs}`, {
            method: "POST", credentials: "same-origin", body: file,
            headers: { "content-type": file.type || "application/octet-stream", "x-requested-with": "fetch" },
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Upload failed.");
          closeModal();
          toast(data.document.shared ? "Document added and shared with the patient." : "Document added (not shared).");
          route();
        } catch (ex) { btn.disabled = false; btn.textContent = "Upload"; toast(ex.message); }
      });
    });
    $$("[data-doc-share]").forEach((c) => c.addEventListener("change", () => confirmThen(null, async () => {
      try { await api(`/documents/${c.dataset.docShare}`, { method: "PATCH", body: { shared: c.checked } }); } catch (ex) { c.checked = !c.checked; throw ex; }
      toast(c.checked ? "Shared: the patient can now download it." : "No longer shared with the patient.");
    })));
    $$("[data-doc-del]").forEach((b) => b.addEventListener("click", () => confirmThen("Delete this document permanently?", async () => {
      await api(`/documents/${b.dataset.docDel}`, { method: "DELETE" }); toast("Document deleted."); route();
    })));
    const eraseBtn = $("#eraseBtn");
    if (eraseBtn) eraseBtn.addEventListener("click", async () => {
      const typed = prompt(`This permanently removes ${p.name}'s name, contact details, notes and check-in comments. Payment records are kept de-identified for tax law.\n\nType the patient's full name to confirm:`);
      if (!typed) return;
      try { await api(`/patients/${p.id}/erase`, { method: "POST", body: { confirm: typed } }); toast("Personal data erased."); route(); } catch (ex) { toast(ex.message); }
    });
    $("#pEdit").addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await api(`/patients/${p.id}`, { method: "PATCH", body: Object.fromEntries(new FormData(e.target)) }); toast("Patient saved."); } catch (ex) { toast(ex.message); }
    });
    $("#addFu").addEventListener("click", () => {
      openModal(`<h2>New follow-up for ${esc(p.name)}</h2>
        <form class="form" id="fuForm">
          <div class="field-row"><div class="field"><label>Due</label><input type="date" name="dueDate" value="${addDays(state.today, 7)}"></div>
          <div class="field"><label>Type</label><select name="type">${Object.entries(FU_TYPE).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div></div>
          <div class="field"><label>Note</label><input name="notes"></div>
          <button class="btn btn--primary btn--block">Add follow-up</button>
        </form>`);
      $("#fuForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        try { await api("/followups", { method: "POST", body: { ...Object.fromEntries(new FormData(e.target)), patientId: p.id } }); closeModal(); toast("Follow-up added."); route(); } catch (ex) { toast(ex.message); }
      });
    });
  }

  // ---------- Stories ----------
  async function renderStories() {
    const { stories } = await api(`/stories?status=${state.storyView}`);
    const tabs = { pending: "To review", approved: "Published", rejected: "Rejected" };
    content.innerHTML = `
      <div class="panel-card__head">
        <div class="chips">${Object.entries(tabs).map(([k, v]) => `<button class="chip ${state.storyView === k ? "is-active" : ""}" data-sv="${k}">${v}</button>`).join("")}</div>
        <button class="btn btn--ghost btn--sm" id="addStory">+ Add a story yourself</button>
      </div>
      <p class="muted small">Patients submit stories at <a href="/stories.html#share" target="_blank">/stories.html</a>. Nothing goes live until you approve it. Starred stories show first on the homepage. Only the first name and last initial are published.</p>
      <div class="list">${stories.map((s) => `<div class="item" style="grid-template-columns:1fr auto">
        <div class="item__main">
          <strong>${"★".repeat(s.rating)}${"☆".repeat(5 - s.rating)} ${esc(s.title || "Untitled")}</strong>
          <p style="margin:.3rem 0">${esc(s.body)}</p>
          <small>${esc(s.name)}${s.city ? `, ${esc(s.city)}` : ""}${s.duration ? ` · had pain for ${esc(s.duration)}` : ""}${s.patient_code ? ` · ${esc(s.patient_code)} / ${esc(s.appt_no || "")}` : ""}${s.phone ? ` · ${esc(phonePretty(s.phone))}` : ""} · ${esc(day(s.created_at))} · via ${esc(s.source)}</small>
        </div>
        <div class="item__actions">
          ${s.status !== "approved" ? `<button class="btn btn--primary btn--sm" data-story="${s.id}" data-set="approved">Approve</button>` : `<button class="btn btn--ghost btn--sm" data-story="${s.id}" data-feature="${s.featured ? 0 : 1}">${s.featured ? "★ Featured" : "☆ Feature"}</button>`}
          <button class="btn btn--ghost btn--sm" data-story-edit="${s.id}">Edit</button>
          ${s.status !== "rejected" ? `<button class="btn btn--ghost btn--sm" data-story="${s.id}" data-set="rejected">${s.status === "approved" ? "Unpublish" : "Reject"}</button>` : ""}
          <button class="btn btn--danger btn--sm" data-story-del="${s.id}">Delete</button>
        </div></div>`).join("") || '<div class="empty">No stories here.</div>'}</div>`;
    const byId = Object.fromEntries(stories.map((s) => [s.id, s]));
    $$("[data-sv]").forEach((b) => b.addEventListener("click", () => { state.storyView = b.dataset.sv; route(); }));
    $$("[data-story]").forEach((b) => b.addEventListener("click", async () => {
      const body = b.dataset.set ? { status: b.dataset.set } : { featured: b.dataset.feature === "1" };
      try { await api(`/stories/${b.dataset.story}`, { method: "PATCH", body }); toast("Updated."); route(); } catch (ex) { toast(ex.message); }
    }));
    $$("[data-story-del]").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm("Delete this story permanently?")) return;
      try { await api(`/stories/${b.dataset.storyDel}`, { method: "DELETE" }); } catch (ex) { toast(ex.message); return; }
      toast("Deleted.");
      route();
    }));
    const storyForm = (s = {}) => `
      <form class="form" id="storyForm">
        <div class="field-row"><div class="field"><label>Name</label><input name="name" value="${esc(s.name || "")}" ${s.id ? "disabled" : "required"}></div>
        <div class="field"><label>City</label><input name="city" value="${esc(s.city || "")}"></div></div>
        <div class="field"><label>Headline</label><input name="title" value="${esc(s.title || "")}"></div>
        <div class="field"><label>Story</label><textarea name="body" rows="5" required>${esc(s.body || "")}</textarea></div>
        ${s.id ? "" : '<div class="field"><label>Rating</label><select name="rating"><option>5</option><option>4</option><option>3</option></select></div>'}
        <button class="btn btn--primary btn--block">${s.id ? "Save" : "Publish story"}</button>
      </form>`;
    $$("[data-story-edit]").forEach((b) => b.addEventListener("click", () => {
      const s = byId[b.dataset.storyEdit];
      openModal(`<h2>Edit story</h2><p class="muted small">Fix typos or trim length. Keep the patient's meaning.</p>${storyForm(s)}`);
      $("#storyForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const { title, body, city } = Object.fromEntries(new FormData(e.target));
        try { await api(`/stories/${s.id}`, { method: "PATCH", body: { title, body, city } }); closeModal(); toast("Saved."); route(); } catch (ex) { toast(ex.message); }
      });
    }));
    $("#addStory").addEventListener("click", () => {
      openModal(`<h2>Add a story</h2><p class="muted small">For feedback received on WhatsApp, Google or in person. Only add it with the patient's permission.</p>${storyForm()}`);
      $("#storyForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        try { await api("/stories", { method: "POST", body: Object.fromEntries(new FormData(e.target)) }); closeModal(); toast("Story published."); state.storyView = "approved"; route(); } catch (ex) { toast(ex.message); }
      });
    });
  }

  // ---------- Instagram ----------
  async function renderInstagram() {
    const { media } = await api("/media");
    content.innerHTML = `
      <section class="panel-card">
        <h2>Add a post or reel</h2>
        <p class="muted small">Open the post on Instagram, tap ··· → <em>Copy link</em>, and paste it here. Pick posts with the most views and comments (you can see these in Instagram's Professional dashboard). They appear in the "From Instagram" section of the homepage, newest first. Up to 12 are shown.</p>
        <form class="toolbar" id="mediaForm">
          <div class="field" style="flex:2"><label>Instagram link</label><input name="url" required placeholder="https://www.instagram.com/reel/…"></div>
          <div class="field" style="flex:1"><label>Caption (optional)</label><input name="caption" maxlength="140" placeholder="e.g. What is Internal Manipulation?"></div>
          <button class="btn btn--primary btn--sm">Add</button>
        </form>
      </section>
      <div class="table-wrap"><table>
        <thead><tr><th>Order</th><th>Post</th><th>Type</th><th>Shown</th><th></th></tr></thead>
        <tbody>${media.map((m, i) => `<tr>
          <td class="nowrap"><button class="btn btn--ghost btn--sm" data-move="up" data-id="${m.id}" ${i ? "" : "disabled"}>↑</button> <button class="btn btn--ghost btn--sm" data-move="down" data-id="${m.id}" ${i < media.length - 1 ? "" : "disabled"}>↓</button></td>
          <td><a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.caption || m.url)}</a></td>
          <td>${m.kind === "reel" ? "🎬 Reel" : "🖼️ Post"}</td>
          <td><label class="check"><input type="checkbox" data-vis="${m.id}" ${m.visible ? "checked" : ""}> Visible</label></td>
          <td><button class="btn btn--danger btn--sm" data-mdel="${m.id}">Remove</button></td>
        </tr>`).join("") || '<tr><td colspan="5"><div class="empty">No posts yet. Until you add some, the homepage shows a "Follow on Instagram" card instead.</div></td></tr>'}</tbody>
      </table></div>`;
    $("#mediaForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await api("/media", { method: "POST", body: Object.fromEntries(new FormData(e.target)) }); toast("Added to homepage."); route(); } catch (ex) { toast(ex.message); }
    });
    $$("[data-move]").forEach((b) => b.addEventListener("click", () => confirmThen(null, async () => { await api(`/media/${b.dataset.id}`, { method: "PATCH", body: { move: b.dataset.move } }); route(); })));
    $$("[data-vis]").forEach((c) => c.addEventListener("change", () => confirmThen(null, async () => {
      try { await api(`/media/${c.dataset.vis}`, { method: "PATCH", body: { visible: c.checked } }); } catch (ex) { c.checked = !c.checked; throw ex; }
      toast(c.checked ? "Shown on site." : "Hidden.");
    })));
    $$("[data-mdel]").forEach((b) => b.addEventListener("click", () => confirmThen("Remove this post from the homepage?", async () => { await api(`/media/${b.dataset.mdel}`, { method: "DELETE" }); toast("Removed."); route(); })));
  }

  // ---------- Blog articles ----------
  async function renderBlog() {
    const { posts } = await api("/blog");
    const hiddenCount = posts.filter((p) => !p.enabled).length;
    const when = (t) => new Date(t.replace(" ", "T") + "Z").toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
    content.innerHTML = `
      <section class="panel-card">
        <p class="muted small" style="margin:0">Untick <strong>Shown</strong> to take an article off the website straight away: it disappears from the blog, search, "Keep reading" links and the Tailbone pain page, and its address shows "no longer available". Tick it again to bring it back. Each article keeps its number for good. To edit or add articles, change the files in <code>content/blog/</code> and publish.</p>
      </section>
      <div class="toolbar"><div class="field" style="flex:1"><label for="blogFilter">Find an article</label><input id="blogFilter" type="search" placeholder="Number, title or tag"></div>
        <p class="muted small" style="margin:0;align-self:end">${posts.length} articles · ${hiddenCount} hidden</p></div>
      <div class="table-wrap"><table>
        <thead><tr><th>No.</th><th>Article</th><th>Tags</th><th>Published</th><th>Shown</th><th>Last changed</th></tr></thead>
        <tbody>${posts.map((p) => `<tr data-find="${esc(`#${p.id} ${p.id} ${p.title} ${p.tags.join(" ")}`.toLowerCase())}">
          <td class="nowrap"><strong>#${p.id}</strong></td>
          <td><a href="/blog/${esc(p.slug)}.html" target="_blank" rel="noopener">${esc(p.title)}</a></td>
          <td class="small">${esc(p.tags.join(", "))}</td>
          <td class="nowrap small">${esc(p.date)}</td>
          <td><label class="check"><input type="checkbox" data-post="${p.id}" ${p.enabled ? "checked" : ""}> Shown</label></td>
          <td class="small muted">${p.changedAt ? `${esc(when(p.changedAt))}<br>${esc(p.changedBy || "")}` : "–"}</td>
        </tr>`).join("") || '<tr><td colspan="6"><div class="empty">No articles found. Run the build to publish them.</div></td></tr>'}</tbody>
      </table></div>`;
    $("#blogFilter").addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      $$("tr[data-find]").forEach((tr) => { tr.hidden = !!q && !tr.dataset.find.includes(q); });
    });
    $$("[data-post]").forEach((c) => c.addEventListener("change", async () => {
      try {
        await api(`/blog/${c.dataset.post}`, { method: "PATCH", body: { enabled: c.checked } });
        toast(c.checked ? `Article #${c.dataset.post} is shown on the website.` : `Article #${c.dataset.post} is hidden from the website.`);
        route();
      } catch (ex) { c.checked = !c.checked; toast(ex.message); }
    }));
  }

  // ---------- Inbox ----------
  async function renderInbox(tab = "doctor") {
    const audience = tab === "patient" ? "patient" : "doctor";
    const { notifications, automatic } = await api(`/notifications?audience=${audience}`);
    content.innerHTML = `
      <div class="chips">
        <a class="chip ${audience === "doctor" ? "is-active" : ""}" href="#/inbox">Changes by patients</a>
        <a class="chip ${audience === "patient" ? "is-active" : ""}" href="#/inbox/patient">Messages to patients</a>
      </div>
      ${audience === "doctor" ? `
        <div class="panel-card__head"><p class="muted small" style="margin:0">New bookings, reschedules and cancellations made by patients. Also emailed to the doctor when email is set up.</p>
        <button class="btn btn--ghost btn--sm" id="readAll">Mark all read</button></div>
        <div class="list">${notifications.map((n) => `<div class="item" style="grid-template-columns:auto 1fr">
          <div>${n.read_at ? "" : '<span class="badge badge--pending">New</span>'}</div>
          <div class="item__main"><strong>${esc(n.body)}</strong><small>${esc(when(n.created_at))}</small></div></div>`).join("") || '<div class="empty">Nothing yet.</div>'}</div>`
      : `
        <p class="muted small">${automatic
          ? "WhatsApp Business API is connected: messages are sent automatically. Failed ones can be re-sent by hand."
          : "Automatic WhatsApp isn't connected yet, so each message below is ready to send with one tap. It opens WhatsApp with the text filled in and marks the message as sent."}</p>
        <div class="table-wrap"><table><thead><tr><th>Status</th><th>To</th><th>Message</th><th></th></tr></thead><tbody>
        ${notifications.map((n) => `<tr>
          <td>${n.status === "sent" ? badge("confirmed").replace("Confirmed", "Sent") : n.status === "failed" ? badge("cancelled").replace("Cancelled", "Failed") : badge("pending").replace("Pending", "To send")}</td>
          <td class="nowrap">${esc(phonePretty(n.recipient))}<br><span class="muted">${esc(n.ref || "")}</span></td>
          <td style="max-width:460px">${esc(n.body)}${n.error ? `<br><span class="muted small">${esc(n.error)}</span>` : ""}</td>
          <td><div class="item__actions">${n.status !== "sent" && n.sendUrl ? `<a class="btn btn--wa-sm btn--sm" target="_blank" rel="noopener" href="${esc(n.sendUrl)}" data-sent="${n.id}">Send on WhatsApp</a>` : ""}</div></td>
        </tr>`).join("") || '<tr><td colspan="4"><div class="empty">No messages yet.</div></td></tr>'}
        </tbody></table></div>`}`;
    const ra = $("#readAll");
    if (ra) ra.addEventListener("click", () => confirmThen(null, async () => { await api("/notifications/read-all", { method: "POST" }); route(); }));
    // Opening the WhatsApp link counts as sending it.
    $$("[data-sent]").forEach((aEl) => aEl.addEventListener("click", () => {
      api(`/notifications/${aEl.dataset.sent}`, { method: "PATCH", body: { status: "sent" } }).then(() => setTimeout(route, 400)).catch(() => {});
    }));
  }

  // ---------- Privacy requests (DPDP / GDPR) ----------
  async function renderPrivacy() {
    const { requests, noticeVersion } = await api("/privacy/requests");
    const TYPE = { access: "Copy of data", correction: "Correction", erasure: "Erasure", withdraw_consent: "Withdraw consent", grievance: "Grievance" };
    content.innerHTML = `
      <section class="panel-card">
        <p class="muted small" style="margin:0">Requests from patients' <strong>My appointments</strong> page (identity already checked by appointment number and phone) and from the <a href="/privacy.html#request" target="_blank">privacy page</a>. <strong>Completed</strong> on a copy, correction or deletion request carries it out: the patient can download their data, the corrected details are saved, or their personal data is erased. If nobody acts, these happen <strong>automatically after 3 days</strong> (patients are promised 7). Other requests: verify identity, act, then mark completed within 30 days. Privacy notice in force: v${esc(noticeVersion)}.</p>
      </section>
      <div class="table-wrap"><table>
        <thead><tr><th>Due</th><th>Request</th><th>From</th><th>Details</th><th>Status</th><th></th></tr></thead>
        <tbody>${requests.map((q) => {
          const overdue = ["open", "verifying"].includes(q.status) && q.due_at < state.today;
          return `<tr>
          <td class="nowrap"><strong>${esc(day(q.due_at))}</strong>${overdue ? '<br><span class="badge badge--cancelled">Overdue</span>' : ""}<br><span class="muted">${esc(q.ref)}</span></td>
          <td>${esc(TYPE[q.type])}</td>
          <td>${esc(q.name)}<br><span class="muted">${esc(q.phone ? phonePretty(q.phone) : "")} ${esc(q.email || "")}</span>${q.patient_id ? `<br><a href="#/patient/${q.patient_id}">Matched patient →</a>` : '<br><span class="muted small">No matching patient</span>'}</td>
          <td style="max-width:300px">${q.changes ? `Change to: ${Object.entries(q.changes).map(([k, v]) => `<strong>${esc(k)}</strong> ${esc(k === "phone" ? phonePretty(v) : v)}`).join(", ")}<br>` : ""}${esc(q.details)}${q.auto_at && ["open", "verifying"].includes(q.status) ? `<br><span class="small">⏱ Completes automatically ${esc(new Date(q.auto_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }))}</span>` : ""}${q.resolution ? `<br><span class="muted small">${q.completed_by ? `By ${esc(q.completed_by === "auto" ? "automatic step" : q.completed_by)} · ` : ""}${esc(q.resolution)}</span>` : ""}</td>
          <td>${badge({ open: "pending", verifying: "pending", completed: "completed", rejected: "cancelled" }[q.status]).replace(/>[^<]+</, `>${esc(q.status)}<`)}</td>
          <td><div class="item__actions">${["open", "verifying"].includes(q.status) ? `
            <button class="btn btn--ghost btn--sm" data-req="${q.id}" data-st="verifying">Verifying</button>
            <button class="btn btn--primary btn--sm" data-req="${q.id}" data-st="completed">Completed</button>
            <button class="btn btn--ghost btn--sm" data-req="${q.id}" data-st="rejected">Reject</button>` : ""}</div></td>
        </tr>`;
        }).join("") || '<tr><td colspan="6"><div class="empty">No requests yet.</div></td></tr>'}</tbody>
      </table></div>`;
    $$("[data-req]").forEach((b) => b.addEventListener("click", async () => {
      const q = requests.find((x) => String(x.id) === b.dataset.req);
      const automatic = b.dataset.st === "completed" && q.patient_id && ["access", "correction", "erasure"].includes(q.type);
      if (automatic && !confirm({ access: "Make the data download available to this patient now?", correction: "Save the corrected details now?", erasure: "Erase this patient's personal data now? This cannot be undone." }[q.type])) return;
      const resolution = b.dataset.st === "verifying" || automatic ? "" : prompt(b.dataset.st === "completed" ? "What was done? (e.g. Data exported and sent by email; erased on request)" : "Reason for rejecting (shared with the person):");
      if (b.dataset.st !== "verifying" && !automatic && !resolution) return;
      try { await api(`/privacy/requests/${b.dataset.req}`, { method: "PATCH", body: { status: b.dataset.st, resolution: resolution || undefined } }); toast("Updated."); route(); } catch (ex) { toast(ex.message); }
    }));
  }

  // ---------- Payments ----------
  async function renderPayments() {
    const from = state.payFrom || addDays(state.today, -30);
    const to = state.payTo || state.today;
    const { totals: t, rows } = await api(`/payments/summary?from=${from}&to=${to}`);
    content.innerHTML = `
      <section class="panel-card"><form class="toolbar" id="payFilter">
        <div class="field"><label>From</label><input type="date" name="from" value="${esc(from)}"></div>
        <div class="field"><label>To</label><input type="date" name="to" value="${esc(to)}"></div>
        <button class="btn btn--primary btn--sm">Show</button>
        <a class="btn btn--ghost btn--sm" href="/api/admin/payments/export.csv?from=${esc(from)}&to=${esc(to)}" download>Download for the accountant (CSV)</a>
      </form></section>
      <div class="kpis">
        <div class="kpi"><small>Paid bookings</small><strong>${t.bookings}</strong></div>
        <div class="kpi kpi--ok"><small>Collected</small><strong>${rupees(t.collected)}</strong></div>
        <div class="kpi ${t.refunded ? "kpi--warn" : ""}"><small>Refunded</small><strong>${rupees(t.refunded)}</strong></div>
        <div class="kpi kpi--ok"><small>Net</small><strong>${rupees(t.net)}</strong></div>
        <div class="kpi"><small>Doctor's share</small><strong>${rupees(t.doctor)}</strong></div>
        <div class="kpi"><small>Platform fee</small><strong>${rupees(t.platform)}</strong></div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Patient</th><th>Fee</th><th>Paid</th><th>Refunded</th><th>Split (doctor / platform)</th><th>Status</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td class="nowrap">${esc(day(r.date))}<br><span class="muted">${esc(r.ref)}</span></td>
          <td>${esc(r.patient_name)}<br><span class="muted">${esc(CLINIC[r.clinic])}</span></td>
          <td>${rupees(r.fee)}</td><td>${rupees(r.amount_paid)}</td><td>${r.amount_refunded ? rupees(r.amount_refunded) : "—"}</td>
          <td class="nowrap">${r.platform_fee ? `${rupees(r.fee - r.platform_fee)} / ${rupees(r.platform_fee)}` : "No split"}</td>
          <td>${badge(r.status)}<br><span class="muted small">${esc(r.payment_id || "")}</span></td>
        </tr>`).join("") || '<tr><td colspan="7"><div class="empty">No online payments in this period.</div></td></tr>'}</tbody>
      </table></div>`;
    $("#payFilter").addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      state.payFrom = fd.get("from");
      state.payTo = fd.get("to");
      route();
    });
  }

  // ---------- Settings ----------
  // ---------- Settings (each part shown only to those allowed to use it) ----------
  async function renderSettings() {
    const can = (p) => state.admin.permissions.includes(p);
    const isSuper = state.admin.role === "superadmin";
    const blocked = can("settings") ? (await api("/blocked")).blocked : [];
    const pol = can("settings") ? await api("/settings/policy") : null;
    const P = pol?.policy;
    const C = P?.commission; // only present for the super admin

    const policyCard = !P ? "" : `
      <section class="panel-card">
        <div class="panel-card__head"><h2>Fees, payments & policies</h2>
          <span class="small">${pol.paymentsEnabled ? '<span class="badge badge--confirmed">Razorpay connected</span>' : '<span class="badge badge--pending">Razorpay not connected: pay at clinic</span>'}
          ${pol.whatsappApi ? '<span class="badge badge--confirmed">WhatsApp API connected</span>' : '<span class="badge badge--pending">WhatsApp: one-tap manual sending</span>'}</span></div>
        <form class="form" id="policyForm">
          <h3>Clinics and consultation fees (₹)</h3>
          <p class="muted small">Closed or "opening soon" clinics can't be booked on the website. Existing bookings stay; contact those patients to move them.</p>
          <div class="clinic-grid">${Object.entries(CLINIC).map(([k, v]) => `
            <div class="field"><label for="st-${k}">${esc(v)}</label>
              <div class="field-row"><select id="st-${k}" name="clinics.${k}">${[["open", "Open"], ["closed", "Closed"], ["soon", "Opening soon"]].map(([val, lab]) => `<option value="${val}" ${P.clinics[k] === val ? "selected" : ""}>${lab}</option>`).join("")}</select>
              <input type="number" min="0" name="fees.${k}" value="${P.fees[k]}" aria-label="${esc(v)} fee in rupees" title="Fee ₹"></div></div>`).join("")}
          </div>
          <div class="field-row">
            <div class="field"><label>Follow-up fee (₹) within N days</label><div class="field-row"><input type="number" min="0" name="followup.fee" value="${P.followup.fee}"><input type="number" min="0" max="365" name="followup.windowDays" value="${P.followup.windowDays}" aria-label="Follow-up window in days" title="days"></div></div>
          </div>
          <div class="field"><label>Payment</label><select name="payments.mode">
            <option value="online" ${P.payments.mode === "online" ? "selected" : ""}>Pay online to confirm (needs Razorpay)</option>
            <option value="clinic" ${P.payments.mode === "clinic" ? "selected" : ""}>Pay at the clinic</option></select></div>

          <h3>Cancellation refunds (patient cancels)</h3>
          <p class="muted small">The first matching row applies. Clinic cancellations are always refunded in full; no-shows are never refunded.</p>
          ${P.cancellation.map((t, i) => `<div class="field-row">
            <div class="field"><label>At least … hours before</label><input type="number" min="0" name="cancel.${i}.hoursBefore" value="${t.hoursBefore}" ${t.hoursBefore === 0 && i === P.cancellation.length - 1 ? "readonly" : ""}></div>
            <div class="field"><label>Refund %</label><input type="number" min="0" max="100" name="cancel.${i}.refundPercent" value="${t.refundPercent}"></div></div>`).join("")}

          <h3>Rescheduling by patients</h3>
          <div class="field-row">
            <div class="field"><label>Allowed until … hours before</label><input type="number" min="0" name="reschedule.minHoursBefore" value="${P.reschedule.minHoursBefore}"></div>
            <div class="field"><label>Max times per booking</label><input type="number" min="0" max="10" name="reschedule.maxTimes" value="${P.reschedule.maxTimes}"></div>
          </div>

          ${C ? `<h3>Platform commission (Razorpay Route) <span class="badge badge--pending">Super admin only</span></h3>
          <p class="muted small">When on, each online payment is split automatically: the doctor's share goes to the doctor's Razorpay linked account and the platform fee stays with the platform account. Refunds reverse both shares proportionally.</p>
          <label class="check"><input type="checkbox" name="commission.enabled" ${C.enabled ? "checked" : ""}> Split payments</label>
          <div class="field-row">
            <div class="field"><label>Type</label><select name="commission.type"><option value="fixed" ${C.type === "fixed" ? "selected" : ""}>Fixed ₹ per booking</option><option value="percent" ${C.type === "percent" ? "selected" : ""}>% of fee</option></select></div>
            <div class="field"><label>Value</label><input type="number" min="0" name="commission.value" value="${C.value}"></div>
          </div>
          <div class="field"><label>Doctor's linked account id</label><input name="commission.doctorAccountId" placeholder="acc_XXXXXXXXXXXX" value="${esc(C.doctorAccountId)}"></div>
          <p class="small" id="splitPreview"></p>` : ""}
          <button class="btn btn--primary">Save fees & policies</button>
        </form>
        <h3>Change history</h3>
        <p class="muted small">Every change is recorded with the date, time and who made it. Bookings keep the cancellation and reschedule rules that applied when they were made.</p>
        <div class="list">${(pol.history || []).map((h) => `<div class="item"><div class="item__time">${esc(new Date(h.changedAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }))}</div>
          <div class="item__main"><strong>${esc(h.by)}</strong><small>${h.changes.map(esc).join("<br>")}</small></div></div>`).join("") || '<div class="empty">No changes yet.</div>'}</div>
      </section>`;

    const holidaysCard = !can("settings") ? "" : `
        <section class="panel-card">
          <h2>Holidays & closed days</h2>
          <p class="muted small">Patients can't book a clinic on a blocked day. Existing bookings stay, so contact those patients to move them.</p>
          <form class="toolbar" id="blockForm">
            <div class="field"><label>Date</label><input type="date" name="date" required min="${state.today}"></div>
            <div class="field"><label>Clinic</label><select name="clinic"><option value="all">All clinics</option>${Object.entries(CLINIC).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
            <div class="field" style="flex:1"><label>Reason</label><input name="reason" placeholder="e.g. Diwali, travelling"></div>
            <button class="btn btn--primary btn--sm">Block</button>
          </form>
          <div class="list" style="margin-top:1rem">${blocked.map((b) => `<div class="item"><div class="item__time">${esc(day(b.date))}</div>
            <div class="item__main"><strong>${esc(b.clinic === "all" ? "All clinics" : CLINIC[b.clinic])}</strong><small>${esc(b.reason)}</small></div>
            <div class="item__actions"><button class="btn btn--ghost btn--sm" data-unblock="${b.id}">Remove</button></div></div>`).join("") || '<div class="empty">No upcoming closed days.</div>'}</div>
        </section>`;

    const cal = can("settings") ? await api("/calendar") : null;
    const calendarCard = !cal ? "" : `
      <section class="panel-card">
        <div class="panel-card__head"><h2>Calendar</h2>
          <span class="small">${cal.googleSync ? '<span class="badge badge--confirmed">Google Calendar sync on</span>' : '<span class="badge badge--pending">Google Calendar sync not set up</span>'}
          ${cal.failing ? `<span class="badge badge--cancelled">${cal.failing} not synced yet</span>` : ""}</span></div>
        <p class="small"><strong>Live sync</strong> (recommended): every booking appears in the doctor's Google Calendar instantly, changes and cancellations update it, and his own busy times block those slots on the website. Set up once. See DEPLOY.md → "Google Calendar".</p>
        <p class="small"><strong>Subscribe link</strong> (no setup): in Google Calendar choose <em>Other calendars → + → From URL</em> and paste this private link. Google refreshes it every few hours.</p>
        <div class="toolbar"><div class="field" style="flex:1"><label for="feedUrl">Private calendar link</label><input id="feedUrl" readonly value="${esc(cal.feedUrl)}"></div>
          <button class="btn btn--ghost btn--sm" type="button" id="copyFeed">Copy</button>
          <button class="btn btn--ghost btn--sm" type="button" id="rotateFeed">Change link</button></div>
        <p class="muted small">Keep this link private: anyone with it can see appointment times and first names. "Change link" stops the old one working.</p>
      </section>`;
    content.innerHTML = `
      ${policyCard}
      ${calendarCard}
      <div class="grid-2">
        <div class="stack">
          ${holidaysCard}
          <section class="panel-card" id="securityPanel">
            <h2>My account security</h2>
            <p class="small">${state.admin.twoFactor ? '<span class="badge badge--confirmed">Two-factor sign-in on</span>' : '<span class="badge badge--cancelled">Two-factor sign-in off</span> Turn it on to protect patient data.'}</p>
            <div id="twofa"></div>
            <div class="row-gap" style="margin-top:.6rem">
              ${state.admin.twoFactor ? '<button class="btn btn--ghost btn--sm" id="tfaOff" type="button">Turn off two-factor</button>' : '<button class="btn btn--primary btn--sm" id="tfaSetup" type="button">Set up two-factor sign-in</button>'}
              <button class="btn btn--ghost btn--sm" id="revokeBtn" type="button">Sign out all other devices</button>
            </div>
          </section>
        </div>
        <div class="stack">
          ${can("export") ? `<section class="panel-card">
            <h2>Export</h2>
            <p class="muted small">Download every appointment as a spreadsheet (CSV opens in Excel and Google Sheets).</p>
            <a class="btn btn--ghost" href="/api/admin/export/appointments.csv">Download appointments.csv</a>
          </section>` : ""}
          ${isSuper ? `<section class="panel-card">
            <div class="panel-card__head"><h2>Backups</h2><button class="btn btn--ghost btn--sm" id="backupNow" type="button">Back up now</button></div>
            <p class="muted small">Encrypted backups run daily; the last 14 are kept. Download one each week and store it somewhere else, such as an encrypted drive.</p>
            <div class="list" id="backupList"><div class="empty">Loading…</div></div>
          </section>` : ""}
          <section class="panel-card">
            <h2>Change my password</h2>
            <form class="form" id="pwForm">
              <div class="field"><label>Current password</label><input type="password" name="current" autocomplete="current-password" required></div>
              <div class="field"><label>New password (10+ characters)</label><input type="password" name="next" autocomplete="new-password" minlength="10" required></div>
              <button class="btn btn--primary btn--sm">Update password</button>
            </form>
          </section>
        </div>
      </div>
      ${isSuper ? `<section class="panel-card">
        <div class="panel-card__head"><h2>Security log</h2><button class="btn btn--ghost btn--sm" id="logBtn" type="button">Show</button></div>
        <p class="muted small" style="margin:0">Sign-ins, failed attempts, lockouts, patient record views, exports, erasures, feature and user changes. Kept for 2 years.</p>
        <div id="secLog"></div>
      </section>` : ""}`;

    const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };

    on("#logBtn", "click", async () => {
      const { log } = await api("/security/log");
      $("#secLog").innerHTML = `<div class="table-wrap" style="margin-top:.8rem;max-height:420px;overflow:auto"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>IP</th></tr></thead><tbody>
        ${log.map((l) => `<tr><td class="nowrap">${esc(when(l.created_at))}</td><td>${esc(l.actor)}</td><td>${esc(l.action.replace(/_/g, " "))}</td><td>${esc(l.target)}</td><td class="muted">${esc(l.ip)}</td></tr>`).join("") || '<tr><td colspan="5"><div class="empty">Empty</div></td></tr>'}</tbody></table></div>`;
    });
    on("#blockForm", "submit", async (e) => {
      e.preventDefault();
      try {
        const res = await api("/blocked", { method: "POST", body: Object.fromEntries(new FormData(e.target)) });
        toast(res.clashes ? `Blocked. ${res.clashes} existing booking(s) on that day need rescheduling.` : "Day blocked.");
        route();
      } catch (ex) { toast(ex.message); }
    });
    $$("[data-unblock]").forEach((b) => b.addEventListener("click", () => confirmThen("Open this day for bookings again?", async () => { await api(`/blocked/${b.dataset.unblock}`, { method: "DELETE" }); toast("Day reopened for bookings."); route(); })));

    on("#copyFeed", "click", async () => { try { await navigator.clipboard.writeText($("#feedUrl").value); toast("Link copied."); } catch { $("#feedUrl").select(); } });
    on("#rotateFeed", "click", async () => {
      if (!confirm("Create a new private link? Calendars subscribed with the old link will stop updating.")) return;
      try { await api("/calendar/rotate", { method: "POST" }); toast("New link created. Re-subscribe with it."); route(); } catch (ex) { toast(ex.message); }
    });

    // ---- Backups (super admin) ----
    if (isSuper) {
      const loadBackups = async () => {
        const { backups } = await api("/backups");
        $("#backupList").innerHTML = backups.slice(0, 5).map((b) => `<div class="item" style="grid-template-columns:1fr auto">
          <div class="item__main"><strong>${esc(new Date(b.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }))}</strong><small>${(b.size / 1024).toFixed(0)} KB · encrypted</small></div>
          <div class="item__actions"><a class="btn btn--ghost btn--sm" href="/api/admin/backups/${encodeURIComponent(b.file)}">Download</a></div></div>`).join("") || '<div class="empty">No backups yet. The first runs tonight, or use "Back up now".</div>';
      };
      loadBackups().catch((ex) => { $("#backupList").innerHTML = `<div class="empty">${esc(ex.message)}</div>`; });
      on("#backupNow", "click", async () => { try { await api("/backups", { method: "POST" }); toast("Backup created."); loadBackups(); } catch (ex) { toast(ex.message); } });
    }

    // ---- My account ----
    on("#revokeBtn", "click", async () => { try { await api("/sessions/revoke", { method: "POST" }); toast("All other devices have been signed out."); } catch (ex) { toast(ex.message); } });
    on("#tfaSetup", "click", async () => {
      try {
        const { secret, uri } = await api("/2fa/setup", { method: "POST" });
        $("#twofa").innerHTML = `<ol class="small">
            <li>Install Google Authenticator or Microsoft Authenticator on your phone.</li>
            <li>Tap <em>+</em> → <em>Enter a setup key</em>. Account: <strong>Tailbone Clinic</strong>, key: <code class="key">${esc(secret)}</code> (time-based).</li>
            <li>Enter the 6-digit code the app shows:</li></ol>
          <form class="toolbar" id="tfaForm"><div class="field"><input name="code" inputmode="numeric" maxlength="7" placeholder="123456" required></div><button class="btn btn--primary btn--sm">Turn on</button></form>
          <p class="muted small">On a phone, you can also <a href="${esc(uri)}">open this link</a> to add it automatically.</p>`;
        $("#tfaForm").addEventListener("submit", async (e) => {
          e.preventDefault();
          try { await api("/2fa/enable", { method: "POST", body: { code: e.target.code.value } }); state.admin.twoFactor = true; toast("Two-factor sign-in is on."); route(); } catch (ex) { toast(ex.message); }
        });
      } catch (ex) { toast(ex.message); }
    });
    on("#tfaOff", "click", async () => {
      openModal(`<h2>Turn off two-factor sign-in</h2>
        <form class="form" id="tfaOffForm">
          <div class="field"><label>Your password</label><input name="password" type="password" autocomplete="current-password" required></div>
          <div class="field"><label>Current 6-digit code</label><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required></div>
          <p class="small muted">Your account will be protected by the password alone.</p>
          <button class="btn btn--danger">Turn off</button>
        </form>`);
      $("#tfaOffForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          await api("/2fa/disable", { method: "POST", body: { password: e.target.password.value, code: e.target.code.value } });
          state.admin.twoFactor = false; closeModal(); toast("Two-factor sign-in turned off."); route();
        } catch (ex) { toast(ex.message); }
      });
    });
    on("#pwForm", "submit", async (e) => {
      e.preventDefault();
      try { await api("/password", { method: "POST", body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); toast("Password updated."); } catch (ex) { toast(ex.message); }
    });

    // ---- Fees & policies ----
    const pf = $("#policyForm");
    if (!pf) return;
    const readPolicy = () => {
      const fd = new FormData(pf);
      const n = (k) => Number(fd.get(k));
      const body = {
        fees: Object.fromEntries(Object.keys(CLINIC).map((k) => [k, n(`fees.${k}`)])),
        clinics: Object.fromEntries(Object.keys(CLINIC).map((k) => [k, fd.get(`clinics.${k}`)])),
        followup: { fee: n("followup.fee"), windowDays: n("followup.windowDays") },
        payments: { mode: fd.get("payments.mode") },
        cancellation: P.cancellation.map((_, i) => ({ hoursBefore: n(`cancel.${i}.hoursBefore`), refundPercent: n(`cancel.${i}.refundPercent`) })),
        reschedule: { minHoursBefore: n("reschedule.minHoursBefore"), maxTimes: n("reschedule.maxTimes") },
      };
      if (C) body.commission = { enabled: fd.get("commission.enabled") === "on", type: fd.get("commission.type"), value: n("commission.value"), doctorAccountId: fd.get("commission.doctorAccountId") };
      return body;
    };
    const preview = () => {
      if (!C) return;
      const p = readPolicy();
      const fee = p.fees.del;
      const cut = !p.commission.enabled ? 0 : Math.min(fee, p.commission.type === "percent" ? Math.round((fee * p.commission.value) / 100) : p.commission.value);
      $("#splitPreview").textContent = p.commission.enabled
        ? `Example: patient pays ₹${fee} → doctor receives ₹${fee - cut}, platform keeps ₹${cut} (before Razorpay's gateway charges).`
        : "Split is off: the full amount goes to the account that owns the Razorpay keys.";
    };
    pf.addEventListener("input", preview);
    preview();
    pf.addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await api("/settings/policy", { method: "PUT", body: readPolicy() }); toast("Saved and recorded in the change history. New rules apply to new bookings."); route(); } catch (ex) { toast(ex.message); }
    });
  }

  // ---------- Control panel (super admin): site features and dashboard users ----------
  async function renderControl() {
    const d = await api("/superadmin");
    const permBoxes = (selected, name = "perm") => Object.entries(d.permissionInfo).map(([k, label]) =>
      `<label class="check"><input type="checkbox" name="${name}" value="${k}" ${selected.includes(k) ? "checked" : ""}> ${esc(label)}</label>`).join("");
    content.innerHTML = `
      ${state.demo ? '<div class="alert alert--ok">Demo: you can look around, but changes here are disabled because they would affect every demo visitor.</div>' : ""}
      <section class="panel-card">
        <div class="panel-card__head"><h2>Website features</h2><span class="muted small">Switch parts of the site on or off. Changes apply immediately.</span></div>
        <form id="featForm" class="toggles">
          ${Object.entries(d.featureInfo).map(([k, f]) => `
            <label class="toggle">
              <input type="checkbox" name="${k}" ${d.features[k] ? "checked" : ""}>
              <span class="toggle__switch" aria-hidden="true"></span>
              <span class="toggle__text"><strong>${esc(f.label)}</strong><small>${esc(f.help)}</small></span>
            </label>`).join("")}
          <p class="muted small">Always on (required by law): privacy notice, data-rights requests, "download my data", consent records.</p>
          <button class="btn btn--primary" type="submit">Save features</button>
        </form>
      </section>

      <section class="panel-card">
        <div class="panel-card__head"><h2>Dashboard users</h2><button class="btn btn--primary btn--sm" id="addUser" type="button">+ Add user</button></div>
        <p class="muted small">Super admins can do everything, including this page, commission settings, backups and the security log. Admins only see the sections you tick for them.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>User</th><th>Role</th><th>Access</th><th>Status</th><th></th></tr></thead>
          <tbody>${d.users.map((u) => `<tr>
            <td><strong>${esc(u.name)}</strong>${u.id === state.admin.id ? ' <span class="badge">You</span>' : ""}<br><span class="muted">${esc(u.email)}</span></td>
            <td>${u.role === "superadmin" ? '<span class="badge badge--completed">Super admin</span>' : '<span class="badge">Admin</span>'}</td>
            <td class="small">${u.role === "superadmin" ? "Everything" : esc(u.permissions.map((p) => p).join(", ") || "Overview only")}</td>
            <td class="small">${u.disabled ? badge("cancelled").replace("Cancelled", "Disabled") : badge("confirmed").replace("Confirmed", "Active")}
              <br>${u.twoFactor ? "2FA on" : '<span class="trend-worse">2FA off</span>'}<br><span class="muted">Last sign-in: ${u.lastLoginAt ? esc(day(u.lastLoginAt)) : "never"}</span></td>
            <td><div class="item__actions">
              <button class="btn btn--ghost btn--sm" data-edit="${u.id}">Edit access</button>
              <button class="btn btn--ghost btn--sm" data-reset="${u.id}">Reset password</button>
              ${u.twoFactor ? `<button class="btn btn--ghost btn--sm" data-reset2fa="${u.id}">Reset 2FA</button>` : ""}
              ${u.id !== state.admin.id ? `<button class="btn ${u.disabled ? "btn--primary" : "btn--danger"} btn--sm" data-toggle="${u.id}" data-disabled="${u.disabled ? 1 : 0}">${u.disabled ? "Enable" : "Disable"}</button>` : ""}
            </div></td>
          </tr>`).join("")}</tbody>
        </table></div>
      </section>`;

    $("#featForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(Object.keys(d.featureInfo).map((k) => [k, e.target[k].checked]));
      try { await api("/superadmin/features", { method: "PUT", body }); toast("Features saved. The website updates straight away."); route(); } catch (ex) { toast(ex.message); }
    });

    const showTemp = (email, pw) => {
      openModal(`<h2>Temporary password</h2>
        <p>Share this with <strong>${esc(email)}</strong> privately (in person or by phone call). It's shown only once.</p>
        <p><code class="key" style="font-size:1.2rem">${esc(pw)}</code></p>
        <p class="muted small">They should sign in at <strong>/admin</strong>, change it in Settings → Change my password, and turn on two-factor sign-in.</p>
        <button class="btn btn--primary" type="button" id="okBtn">Done</button>`);
      $("#okBtn").addEventListener("click", () => { closeModal(); route(); });
    };

    $("#addUser").addEventListener("click", () => {
      openModal(`<h2>Add a dashboard user</h2>
        <form class="form" id="userForm">
          <div class="field-row">
            <div class="field"><label>Name</label><input name="name" required></div>
            <div class="field"><label>Email</label><input name="email" type="email" required></div>
          </div>
          <div class="field"><label>Role</label><select name="role"><option value="admin">Admin (only the sections ticked below)</option><option value="superadmin">Super admin (everything)</option></select></div>
          <fieldset class="field"><legend>Sections this admin can open</legend><div class="perm-grid">${permBoxes(d.defaultPermissions)}</div></fieldset>
          <button class="btn btn--primary btn--block">Create user</button>
        </form>`);
      $("#userForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          const res = await api("/superadmin/users", { method: "POST", body: { name: fd.get("name"), email: fd.get("email"), role: fd.get("role"), permissions: fd.getAll("perm") } });
          showTemp(res.email, res.temporaryPassword);
        } catch (ex) { toast(ex.message); }
      });
    });

    const byId = Object.fromEntries(d.users.map((u) => [u.id, u]));
    $$("[data-edit]").forEach((b) => b.addEventListener("click", () => {
      const u = byId[b.dataset.edit];
      openModal(`<h2>Access for ${esc(u.name)}</h2>
        <form class="form" id="accessForm">
          <div class="field"><label>Role</label><select name="role"><option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option><option value="superadmin" ${u.role === "superadmin" ? "selected" : ""}>Super admin</option></select></div>
          <fieldset class="field"><legend>Sections (admins only; super admins see everything)</legend><div class="perm-grid">${permBoxes(u.permissions)}</div></fieldset>
          <button class="btn btn--primary btn--block">Save access</button>
        </form>`);
      $("#accessForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try { await api(`/superadmin/users/${u.id}`, { method: "PATCH", body: { role: fd.get("role"), permissions: fd.getAll("perm") } }); closeModal(); toast("Access updated. It applies on their next click."); route(); } catch (ex) { toast(ex.message); }
      });
    }));
    $$("[data-reset]").forEach((b) => b.addEventListener("click", async () => {
      const u = byId[b.dataset.reset];
      if (!confirm(`Reset ${u.name}'s password? They'll be signed out everywhere.`)) return;
      try { const res = await api(`/superadmin/users/${u.id}`, { method: "PATCH", body: { resetPassword: true } }); showTemp(u.email, res.temporaryPassword); } catch (ex) { toast(ex.message); }
    }));
    $$("[data-reset2fa]").forEach((b) => b.addEventListener("click", async () => {
      const u = byId[b.dataset.reset2fa];
      if (!confirm(`Turn off two-factor sign-in for ${u.name}? Use this if they lost their phone; ask them to set it up again.`)) return;
      try { await api(`/superadmin/users/${u.id}`, { method: "PATCH", body: { reset2fa: true } }); toast("Two-factor reset."); route(); } catch (ex) { toast(ex.message); }
    }));
    $$("[data-toggle]").forEach((b) => b.addEventListener("click", async () => {
      const u = byId[b.dataset.toggle];
      const disable = b.dataset.disabled === "0";
      if (disable && !confirm(`Disable ${u.name}? They're signed out immediately and can't sign in.`)) return;
      try { await api(`/superadmin/users/${u.id}`, { method: "PATCH", body: { disabled: disable } }); toast(disable ? "User disabled." : "User enabled."); route(); } catch (ex) { toast(ex.message); }
    }));
  }

  // ---------- Chrome ----------
  $("#sideToggle").addEventListener("click", () => $("#side").classList.toggle("is-open"));
  $("#themeToggle").addEventListener("click", () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch { /* ignore */ }
  });
  modal.addEventListener("click", (e) => { if (e.target === modal && mayClose()) closeModal(); });
  modal.addEventListener("cancel", (e) => { if (!mayClose()) e.preventDefault(); else delete modal.dataset.dirty; });

  boot();
})();
