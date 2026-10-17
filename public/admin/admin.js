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
  const CLINIC = { blr: "Bengaluru", del: "New Delhi", online: "Online" };
  const STATUS = { pending: "Pending", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled", no_show: "No-show" };
  const FU_TYPE = { checkin: "Check-in form", call: "Phone call", visit: "Review visit", whatsapp: "WhatsApp message" };
  const day = (d, opts = { weekday: "short", day: "numeric", month: "short" }) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", opts) : "");
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
    if (res.status === 401 && path !== "/login") { showLogin(); throw new Error(data.error || "Please sign in."); }
    if (!res.ok) throw new Error(data.error || "Request failed.");
    return data;
  }

  const openModal = (html) => { modalBody.innerHTML = html; modal.showModal(); };
  const closeModal = () => modal.close();

  // ---------- Auth ----------
  function showLogin() {
    $("#appView").hidden = true;
    $("#loginView").hidden = false;
    $("#loginEmail").focus();
  }

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#loginErr");
    err.hidden = true;
    try {
      await api("/login", { method: "POST", body: { email: $("#loginEmail").value, password: $("#loginPass").value } });
      $("#loginPass").value = "";
      boot();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });

  $("#logoutBtn").addEventListener("click", async () => {
    await api("/logout", { method: "POST" }).catch(() => {});
    showLogin();
  });

  async function boot() {
    try {
      const me = await api("/me");
      Object.assign(state, { admin: me.admin, clinics: me.clinics, today: me.today });
      state.apptFilter.from ??= me.today;
      $("#meName").textContent = me.admin.name;
      $("#meEmail").textContent = me.admin.email;
      $("#meAvatar").textContent = me.admin.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
      $("#loginView").hidden = true;
      $("#appView").hidden = false;
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
    payments: ["Payments", renderPayments],
    instagram: ["Instagram highlights", renderInstagram],
    settings: ["Settings", renderSettings],
  };

  async function route() {
    if (!state.admin) return;
    const [, name = "overview", param] = location.hash.split("/");
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
    btns.push(`<button class="btn btn--ghost btn--sm" data-act="open" data-id="${a.id}">Details</button>`);
    return btns.join("");
  }

  function apptItem(a) {
    return `<div class="item">
      <div class="item__time">${time12(a.time)}</div>
      <div class="item__main"><strong>${esc(a.patient_name)}</strong>
        <small>${esc(CLINIC[a.clinic])} · ${esc(phonePretty(a.patient_phone))} ${a.prefers_female ? "· prefers female clinician" : ""}</small>
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
      if (act === "fu-done") { await api(`/followups/${id}`, { method: "PATCH", body: { status: "done" } }); toast("Follow-up marked done."); route(); }
      if (act === "fu-skip") { await api(`/followups/${id}`, { method: "PATCH", body: { status: "skipped" } }); toast("Follow-up skipped."); route(); }
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
        <div class="kpi"><small>Next 7 days</small><strong>${s.upcoming7}</strong></div>
        <div class="kpi"><small>New patients (30 days)</small><strong>${s.newPatients30}</strong></div>
        <div class="kpi"><small>Visits completed (30 days)</small><strong>${s.completed30}</strong></div>
        <div class="kpi"><small>Avg check-in pain (7 days)</small><strong>${s.avgPain7 ?? "—"}</strong></div>
        <div class="kpi ${s.storiesPending ? "kpi--warn" : ""}"><small>Stories to review</small><strong>${s.storiesPending}</strong></div>
        <div class="kpi kpi--ok"><small>Collected (30 days, net)</small><strong>${esc(s.collected30Text)}</strong></div>
        <div class="kpi ${s.unread ? "kpi--warn" : ""}"><small>Patient changes to read</small><strong><a href="#/inbox">${s.unread}</a></strong></div>
        <div class="kpi ${s.toSend ? "kpi--warn" : ""}"><small>Messages waiting to send</small><strong><a href="#/inbox/patient">${s.toSend}</a></strong></div>
      </div>
      <div class="grid-2">
        <div class="stack">
          <section class="panel-card">
            <div class="panel-card__head"><h2>Today · ${esc(day(d.today, { weekday: "long", day: "numeric", month: "long" }))}</h2><a href="#/appointments">All appointments →</a></div>
            <div class="list">${d.schedule.map(apptItem).join("") || '<div class="empty">No appointments today.</div>'}</div>
          </section>
          <section class="panel-card">
            <div class="panel-card__head"><h2>Tomorrow: send reminders</h2></div>
            <div class="list">${d.tomorrow.map((a) => `<div class="item"><div class="item__time">${time12(a.time)}</div>
              <div class="item__main"><strong>${esc(a.patient_name)}</strong><small>${esc(CLINIC[a.clinic])}</small><div>${badge(a.status)}</div></div>
              <div class="item__actions"><a class="btn btn--wa-sm btn--sm" target="_blank" rel="noopener" href="${esc(a.links.reminder)}">Send reminder</a></div></div>`).join("") || '<div class="empty">Nothing booked for tomorrow.</div>'}</div>
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
          <div class="field" style="flex:1"><label>Search</label><input type="search" name="q" placeholder="Name, phone or ref" value="${esc(f.q)}"></div>
          <button class="btn btn--primary btn--sm" type="submit">Apply</button>
          <button class="btn btn--ghost btn--sm" type="button" id="clearFilters">Show all</button>
        </form>
      </section>
      <div class="table-wrap"><table>
        <thead><tr><th>When</th><th>Patient</th><th>Clinic</th><th>Status</th><th>Ref</th><th></th></tr></thead>
        <tbody>${appointments.map((a) => `<tr>
          <td class="nowrap"><strong>${esc(day(a.date))}</strong><br><span class="muted">${time12(a.time)}</span></td>
          <td><a href="#/patient/${a.patient_id}"><strong>${esc(a.patient_name)}</strong></a><br><span class="muted">${esc(phonePretty(a.patient_phone))}</span></td>
          <td>${esc(CLINIC[a.clinic])}</td>
          <td>${badge(a.status)}<br>${payBadge(a)}</td>
          <td class="nowrap muted">${esc(a.ref)}${a.fee ? `<br>${rupees(a.fee)}` : ""}</td>
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
        <dt>Ref</dt><dd>${esc(a.ref)} · booked via ${esc(a.source)}</dd>
        ${a.prefers_female ? "<dt>Preference</dt><dd>Female clinician</dd>" : ""}
        ${a.reason ? `<dt>Patient says</dt><dd>${esc(a.reason)}</dd>` : ""}
        ${a.fee ? `<dt>Payment</dt><dd>${rupees(a.fee)} · ${payBadge(a)}${a.amount_paid ? ` · paid ${rupees(a.amount_paid)}` : ""}${a.amount_refunded ? ` · refunded ${rupees(a.amount_refunded)}` : ""}${a.platform_fee ? `<br><span class="muted small">Split: doctor ${rupees(a.fee - a.platform_fee)} · platform ${rupees(a.platform_fee)}</span>` : ""}</dd>` : ""}
      </dl>
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
      <ol class="timeline">${events.map((e) => `<li><strong>${esc(EVENT[e.action] || e.action)}</strong> <span class="muted small">by ${esc(e.actor === "clinic" ? e.actor_name || "clinic" : e.actor === "patient" ? "patient" : "system")} · ${esc(new Date(e.created_at.replace(" ", "T") + "Z").toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }))}</span>${e.detail ? `<br><span class="small">${esc(e.detail)}</span>` : ""}</li>`).join("") || '<li class="muted">No history yet.</li>'}</ol>`);
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
      const amount = prompt(`Refund amount in ₹ (up to ${refundable / 100}):`, String(refundable / 100));
      if (!amount) return;
      const reason = prompt("Reason (shown in the records):", "Goodwill refund") || "";
      try {
        const res = await api(`/appointments/${id}/refund`, { method: "POST", body: { amount: Number(amount), reason } });
        toast(`Refund ${rupees(res.refund.amount)}: ${res.refund.status}${res.refund.error ? ` (${res.refund.error})` : ""}`);
        apptDialog(id);
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
      $$(".slot", form).forEach((x) => x.setAttribute("aria-selected", String(x === b)));
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
    const { patient: p, appointments, followups, checkins, storyInvite } = await api(`/patients/${Number(pid)}`);
    $("#viewTitle").textContent = p.name;
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
          <section class="panel-card">
            <h2>Appointments</h2>
            <div class="list">${appointments.map((a) => `<div class="item"><div class="item__time">${esc(day(a.date, { day: "numeric", month: "short", year: "2-digit" }))}</div>
              <div class="item__main"><strong>${time12(a.time)} · ${esc(CLINIC[a.clinic])}</strong><small>${esc(a.notes || a.reason)}</small><div>${badge(a.status)}</div></div>
              <div class="item__actions">${apptActions(a)}</div></div>`).join("") || '<div class="empty">No appointments.</div>'}</div>
          </section>
        </div>
      </div>`;
    $("#backBtn").addEventListener("click", () => history.back());
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
          <small>${esc(s.name)}${s.city ? `, ${esc(s.city)}` : ""}${s.duration ? ` · had pain for ${esc(s.duration)}` : ""}${s.phone ? ` · ${esc(phonePretty(s.phone))}` : ""} · ${esc(day(s.created_at))} · via ${esc(s.source)}</small>
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
      await api(`/stories/${b.dataset.storyDel}`, { method: "DELETE" });
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
    $$("[data-move]").forEach((b) => b.addEventListener("click", async () => { await api(`/media/${b.dataset.id}`, { method: "PATCH", body: { move: b.dataset.move } }); route(); }));
    $$("[data-vis]").forEach((c) => c.addEventListener("change", async () => { await api(`/media/${c.dataset.vis}`, { method: "PATCH", body: { visible: c.checked } }); toast(c.checked ? "Shown on site." : "Hidden."); }));
    $$("[data-mdel]").forEach((b) => b.addEventListener("click", async () => { await api(`/media/${b.dataset.mdel}`, { method: "DELETE" }); route(); }));
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
          <div class="item__main"><strong>${esc(n.body)}</strong><small>${esc(new Date(n.created_at.replace(" ", "T") + "Z").toLocaleString("en-IN"))}</small></div></div>`).join("") || '<div class="empty">Nothing yet.</div>'}</div>`
      : `
        <p class="muted small">${automatic
          ? "WhatsApp Business API is connected: messages are sent automatically. Failed ones can be re-sent by hand."
          : "Automatic WhatsApp isn't connected yet, so each message below is ready to send with one tap. It opens WhatsApp with the text filled in. Mark it sent afterwards."}</p>
        <div class="table-wrap"><table><thead><tr><th>Status</th><th>To</th><th>Message</th><th></th></tr></thead><tbody>
        ${notifications.map((n) => `<tr>
          <td>${n.status === "sent" ? badge("confirmed").replace("Confirmed", "Sent") : n.status === "failed" ? badge("cancelled").replace("Cancelled", "Failed") : badge("pending").replace("Pending", "To send")}</td>
          <td class="nowrap">${esc(phonePretty(n.recipient))}<br><span class="muted">${esc(n.ref || "")}</span></td>
          <td style="max-width:460px">${esc(n.body)}${n.error ? `<br><span class="muted small">${esc(n.error)}</span>` : ""}</td>
          <td><div class="item__actions">${n.status !== "sent" && n.sendUrl ? `<a class="btn btn--wa-sm btn--sm" target="_blank" rel="noopener" href="${esc(n.sendUrl)}" data-sent="${n.id}">Send on WhatsApp</a>` : ""}</div></td>
        </tr>`).join("") || '<tr><td colspan="4"><div class="empty">No messages yet.</div></td></tr>'}
        </tbody></table></div>`}`;
    const ra = $("#readAll");
    if (ra) ra.addEventListener("click", async () => { await api("/notifications/read-all", { method: "POST" }); route(); });
    // Opening the WhatsApp link counts as sending it.
    $$("[data-sent]").forEach((aEl) => aEl.addEventListener("click", () => {
      api(`/notifications/${aEl.dataset.sent}`, { method: "PATCH", body: { status: "sent" } }).then(() => setTimeout(route, 400)).catch(() => {});
    }));
    if (audience === "doctor" && notifications.some((n) => !n.read_at)) setTimeout(() => api("/notifications/read-all", { method: "POST" }).then(refreshBadges).catch(() => {}), 4000);
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
  async function renderSettings() {
    const { blocked } = await api("/blocked");
    const { policy: P, paymentsEnabled, whatsappApi } = await api("/settings/policy");
    content.innerHTML = `
      <section class="panel-card">
        <div class="panel-card__head"><h2>Fees, payments & policies</h2>
          <span class="small">${paymentsEnabled ? '<span class="badge badge--confirmed">Razorpay connected</span>' : '<span class="badge badge--pending">Razorpay not connected: pay at clinic</span>'}
          ${whatsappApi ? '<span class="badge badge--confirmed">WhatsApp API connected</span>' : '<span class="badge badge--pending">WhatsApp: one-tap manual sending</span>'}</span></div>
        <form class="form" id="policyForm">
          <h3>Consultation fees (₹)</h3>
          <div class="field-row">
            <div class="field"><label>Bengaluru</label><input type="number" min="0" name="fees.blr" value="${P.fees.blr}"></div>
            <div class="field"><label>New Delhi</label><input type="number" min="0" name="fees.del" value="${P.fees.del}"></div>
          </div>
          <div class="field-row">
            <div class="field"><label>Online</label><input type="number" min="0" name="fees.online" value="${P.fees.online}"></div>
            <div class="field"><label>Follow-up fee (₹) within N days</label><div class="field-row"><input type="number" min="0" name="followup.fee" value="${P.followup.fee}"><input type="number" min="0" max="365" name="followup.windowDays" value="${P.followup.windowDays}" title="days"></div></div>
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

          <h3>Platform commission (Razorpay Route)</h3>
          <p class="muted small">When on, each online payment is split automatically: the doctor's share goes to the doctor's Razorpay linked account and the platform fee stays with the platform account. Refunds reverse both shares proportionally.</p>
          <label class="check"><input type="checkbox" name="commission.enabled" ${P.commission.enabled ? "checked" : ""}> Split payments</label>
          <div class="field-row">
            <div class="field"><label>Type</label><select name="commission.type"><option value="fixed" ${P.commission.type === "fixed" ? "selected" : ""}>Fixed ₹ per booking</option><option value="percent" ${P.commission.type === "percent" ? "selected" : ""}>% of fee</option></select></div>
            <div class="field"><label>Value</label><input type="number" min="0" name="commission.value" value="${P.commission.value}"></div>
          </div>
          <div class="field"><label>Doctor's linked account id</label><input name="commission.doctorAccountId" placeholder="acc_XXXXXXXXXXXX" value="${esc(P.commission.doctorAccountId)}"></div>
          <p class="small" id="splitPreview"></p>
          <button class="btn btn--primary">Save fees & policies</button>
        </form>
      </section>
      <div class="grid-2">
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
        </section>
        <div class="stack">
          <section class="panel-card">
            <h2>Export</h2>
            <p class="muted small">Download every appointment as a spreadsheet (CSV opens in Excel and Google Sheets).</p>
            <a class="btn btn--ghost" href="/api/admin/export/appointments.csv">Download appointments.csv</a>
          </section>
          <section class="panel-card">
            <h2>Change password</h2>
            <form class="form" id="pwForm">
              <div class="field"><label>Current password</label><input type="password" name="current" autocomplete="current-password" required></div>
              <div class="field"><label>New password (10+ characters)</label><input type="password" name="next" autocomplete="new-password" minlength="10" required></div>
              <button class="btn btn--primary btn--sm">Update password</button>
            </form>
          </section>
        </div>
      </div>`;
    $("#blockForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const res = await api("/blocked", { method: "POST", body: Object.fromEntries(new FormData(e.target)) });
        toast(res.clashes ? `Blocked. ${res.clashes} existing booking(s) on that day need rescheduling.` : "Day blocked.");
        route();
      } catch (ex) { toast(ex.message); }
    });
    $$("[data-unblock]").forEach((b) => b.addEventListener("click", async () => { await api(`/blocked/${b.dataset.unblock}`, { method: "DELETE" }); route(); }));

    const pf = $("#policyForm");
    const readPolicy = () => {
      const fd = new FormData(pf);
      const n = (k) => Number(fd.get(k));
      return {
        fees: { blr: n("fees.blr"), del: n("fees.del"), online: n("fees.online") },
        followup: { fee: n("followup.fee"), windowDays: n("followup.windowDays") },
        payments: { mode: fd.get("payments.mode") },
        cancellation: P.cancellation.map((_, i) => ({ hoursBefore: n(`cancel.${i}.hoursBefore`), refundPercent: n(`cancel.${i}.refundPercent`) })),
        reschedule: { minHoursBefore: n("reschedule.minHoursBefore"), maxTimes: n("reschedule.maxTimes") },
        commission: { enabled: fd.get("commission.enabled") === "on", type: fd.get("commission.type"), value: n("commission.value"), doctorAccountId: fd.get("commission.doctorAccountId") },
      };
    };
    const preview = () => {
      const p = readPolicy();
      const fee = p.fees.blr;
      const cut = !p.commission.enabled ? 0 : Math.min(fee, p.commission.type === "percent" ? Math.round((fee * p.commission.value) / 100) : p.commission.value);
      $("#splitPreview").textContent = p.commission.enabled
        ? `Example: patient pays ₹${fee} → doctor receives ₹${fee - cut}, platform keeps ₹${cut} (before Razorpay's gateway charges).`
        : "Split is off: the full amount goes to the account that owns the Razorpay keys.";
    };
    pf.addEventListener("input", preview);
    preview();
    pf.addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await api("/settings/policy", { method: "PUT", body: readPolicy() }); toast("Fees and policies saved. They apply to new bookings."); route(); } catch (ex) { toast(ex.message); }
    });
    $("#pwForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await api("/password", { method: "POST", body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); toast("Password updated."); } catch (ex) { toast(ex.message); }
    });
  }

  // ---------- Chrome ----------
  $("#sideToggle").addEventListener("click", () => $("#side").classList.toggle("is-open"));
  $("#themeToggle").addEventListener("click", () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch { /* ignore */ }
  });
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

  boot();
})();
